import Redis, { Cluster } from 'ioredis';
import { logger } from './logger.service';
import { metricsService } from './metrics.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InMemoryEntry {
  value: unknown;
  expiry: number;
}

/** Parse a `REDIS_CLUSTER_NODES` env value ("host1:port1,host2:port2") into ioredis node descriptors. */
function parseClusterNodes(value?: string): Array<{ host: string; port: number }> {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [host, port] = entry.split(':');
      return { host, port: Number(port) || 6379 };
    });
}

// ---------------------------------------------------------------------------
// ICacheBackend — common interface for Redis and in-memory backends
// ---------------------------------------------------------------------------

interface ICacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  isAvailable(): boolean;
}

// ---------------------------------------------------------------------------
// RedisBackend — single-instance Redis
// ---------------------------------------------------------------------------

class RedisBackend implements ICacheBackend {
  private client: Redis;
  private ready = false;

  constructor(url: string) {
    this.client = new Redis(url, {
      // Fail fast on connection errors rather than queuing commands forever.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    this.client.on('ready', () => {
      this.ready = true;
      logger.info('Redis cache connected');
    });

    this.client.on('error', (err) => {
      this.ready = false;
      logger.warn('Redis cache error — falling back to in-memory', { error: err.message });
    });

    this.client.on('close', () => {
      this.ready = false;
    });

    // Initiate connection; errors are handled by the 'error' listener above.
    this.client.connect().catch(() => {
      // Swallow — the error listener already logged it.
    });
  }

  isAvailable(): boolean {
    return this.ready;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async clear(): Promise<void> {
    await this.client.flushdb();
  }
}

// ---------------------------------------------------------------------------
// RedisClusterBackend — sharded, highly-available Redis Cluster (#655)
//
// Built on ioredis's native `Cluster` client, which:
//   - shards keys across masters using CRC16 hash slots (no app-level
//     sharding logic needed — `MOVED`/`ASK` redirects are handled for us)
//   - fails over to a replica automatically when a master goes down
//     (`CLUSTERDOWN` is retried against the new topology once the cluster
//     itself completes failover)
// ---------------------------------------------------------------------------

class RedisClusterBackend implements ICacheBackend {
  private client: Cluster;
  private ready = false;
  readonly nodeCount: number;

  constructor(nodes: Array<{ host: string; port: number }>) {
    this.nodeCount = nodes.length;
    this.client = new Cluster(nodes, {
      enableOfflineQueue: false,
      // Retries a redirected/failed-over command against the refreshed
      // cluster topology before giving up on the request.
      clusterRetryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 2000)),
      redisOptions: {
        maxRetriesPerRequest: 1,
      },
    });

    this.client.on('ready', () => {
      this.ready = true;
      logger.info('Redis Cluster connected', { nodes: this.nodeCount });
    });

    this.client.on('error', (err: Error) => {
      this.ready = false;
      logger.warn('Redis Cluster error — falling back to in-memory', { error: err.message });
    });

    this.client.on('close', () => {
      this.ready = false;
    });

    this.client.on('node error', (err: Error, address: string) => {
      logger.warn('Redis Cluster node unreachable', { address, error: err.message });
    });
  }

  isAvailable(): boolean {
    return this.ready;
  }

  /** Number of nodes currently reporting `ready` in the cluster topology. */
  get readyNodeCount(): number {
    return this.client.nodes('all').filter((n: Redis) => n.status === 'ready').length;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async clear(): Promise<void> {
    // FLUSHDB must be issued per-master; the cluster client has no single
    // keyspace to flush in one call.
    const masters = this.client.nodes('master');
    await Promise.all(masters.map((node: Redis) => node.flushdb()));
  }
}

// ---------------------------------------------------------------------------
// InMemoryBackend
// ---------------------------------------------------------------------------

class InMemoryBackend implements ICacheBackend {
  private store: Map<string, InMemoryEntry> = new Map();

  isAvailable(): boolean {
    return true;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value as string;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiry: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  /** Remove expired entries — call periodically to avoid unbounded growth. */
  evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiry) this.store.delete(key);
    }
  }

  get size(): number {
    return this.store.size;
  }
}

// ---------------------------------------------------------------------------
// CacheService — public API
// ---------------------------------------------------------------------------

export class CacheService {
  private redis: RedisBackend | RedisClusterBackend | null = null;
  private memory: InMemoryBackend;
  /** Default TTL in seconds (overridable per call). */
  readonly defaultTTL: number;

  constructor(redisUrl?: string, defaultTTL = 300, clusterNodes?: string) {
    this.defaultTTL = defaultTTL;
    this.memory = new InMemoryBackend();

    const parsedNodes = parseClusterNodes(clusterNodes);
    if (parsedNodes.length > 0) {
      this.redis = new RedisClusterBackend(parsedNodes);
    } else if (redisUrl) {
      this.redis = new RedisBackend(redisUrl);
    } else {
      logger.info('REDIS_URL not set — using in-memory cache');
    }

    // Evict stale in-memory entries every minute regardless of Redis status.
    setInterval(() => this.memory.evictExpired(), 60_000).unref();

    // Surface cluster health on Prometheus every 15s so failovers/node
    // outages are visible without scraping ioredis internals directly.
    if (this.redis instanceof RedisClusterBackend) {
      const cluster = this.redis;
      setInterval(() => {
        metricsService.setRedisClusterHealth(cluster.nodeCount, cluster.readyNodeCount);
      }, 15_000).unref();
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Return the active backend: Redis when connected, in-memory otherwise.
   * This makes Redis the primary store and in-memory the automatic fallback.
   */
  private backend(): ICacheBackend {
    if (this.redis?.isAvailable()) return this.redis;
    return this.memory;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Retrieve a cached value. Returns `null` on miss or error.
   * Records a hit/miss counter in Prometheus with the given `namespace` label.
   */
  async get<T>(key: string, namespace = 'default'): Promise<T | null> {
    try {
      const raw = await this.backend().get(key);
      if (raw === null) {
        metricsService.recordCacheMiss(namespace);
        return null;
      }
      metricsService.recordCacheHit(namespace);
      return JSON.parse(raw) as T;
    } catch (error) {
      logger.error('Cache get error', { key, error });
      metricsService.recordCacheMiss(namespace);
      return null;
    }
  }

  /**
   * Store a value. Silently swallows errors so a cache failure never breaks
   * the request path.
   */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.backend().set(key, serialized, ttl ?? this.defaultTTL);
    } catch (error) {
      logger.error('Cache set error', { key, error });
    }
  }

  /** Remove a single key. */
  async delete(key: string): Promise<void> {
    try {
      // Invalidate from both stores so a Redis reconnect doesn't serve stale data.
      await Promise.all([
        this.redis?.isAvailable() ? this.redis.delete(key) : Promise.resolve(),
        this.memory.delete(key),
      ]);
    } catch (error) {
      logger.error('Cache delete error', { key, error });
    }
  }

  /** Flush all entries (use with care in production). */
  async clear(): Promise<void> {
    try {
      await Promise.all([
        this.redis?.isAvailable() ? this.redis.clear() : Promise.resolve(),
        this.memory.clear(),
      ]);
    } catch (error) {
      logger.error('Cache clear error', { error });
    }
  }

  /**
   * Cache-aside helper: return the cached value if present, otherwise call
   * `loader`, cache the result, and return it.
   */
  async getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    options: { ttl?: number; namespace?: string } = {}
  ): Promise<T> {
    const cached = await this.get<T>(key, options.namespace);
    if (cached !== null) return cached;

    const value = await loader();
    await this.set(key, value, options.ttl);
    return value;
  }

  /** Whether Redis (single-instance or cluster) is currently connected. */
  get isRedisConnected(): boolean {
    return this.redis?.isAvailable() ?? false;
  }

  /** Whether the cache is backed by a Redis Cluster (vs. a single instance). */
  get isClusterMode(): boolean {
    return this.redis instanceof RedisClusterBackend;
  }

  /** Number of entries in the in-memory fallback store. */
  get memorySize(): number {
    return this.memory.size;
  }
}

// ---------------------------------------------------------------------------
// Singleton — shared across the whole server process
// ---------------------------------------------------------------------------

import { getEnv } from '../config/env';

const _resolveConfig = (): { redisUrl?: string; ttl: number; clusterNodes?: string } => {
    try {
        const env = getEnv();
        return {
            redisUrl: env.REDIS_URL,
            ttl: env.PROFILE_CACHE_TTL_SECONDS,
            clusterNodes: env.REDIS_CLUSTER_NODES,
        };
    } catch {
        // Fallback before initEnv() runs (e.g. unit tests importing this module directly).
        return {
            redisUrl: process.env.REDIS_URL,
            ttl: Number(process.env.PROFILE_CACHE_TTL_SECONDS ?? 300),
            clusterNodes: process.env.REDIS_CLUSTER_NODES,
        };
    }
};

const { redisUrl, ttl, clusterNodes } = _resolveConfig();

export const cacheService = new CacheService(redisUrl, ttl, clusterNodes);
