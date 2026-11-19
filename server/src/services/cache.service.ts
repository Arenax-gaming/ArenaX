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

/** Parse a `REDIS_SENTINEL_HOSTS` env value ("host1:port1,host2:port2") into ioredis sentinel descriptors. */
function parseSentinelHosts(value?: string): Array<{ host: string; port: number }> {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [host, port] = entry.split(':');
      return { host, port: Number(port) || 26379 };
    });
}

// ---------------------------------------------------------------------------
// CircuitBreaker — tracks consecutive Redis failures and "opens" (forcing
// callers to the in-memory fallback) for a cooldown period, rather than
// hammering a struggling Redis on every request (#1577 / #1567).
// ---------------------------------------------------------------------------

enum CircuitState {
  CLOSED,
  OPEN,
  HALF_OPEN,
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private nextAttemptAt = 0;

  constructor(
    private readonly failureThreshold = 3,
    private readonly resetTimeoutMs = 30_000
  ) {}

  /** Whether a Redis attempt should be allowed right now. */
  canAttempt(): boolean {
    if (this.state !== CircuitState.OPEN) return true;
    if (Date.now() >= this.nextAttemptAt) {
      this.state = CircuitState.HALF_OPEN;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  recordFailure(): void {
    this.failureCount += 1;
    if (this.state === CircuitState.HALF_OPEN || this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
    }
  }

  get isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }
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
// RedisSentinelBackend — single logical primary monitored by Redis Sentinel,
// with automatic failover to a newly-elected master (#1577 / #1567).
// ---------------------------------------------------------------------------

class RedisSentinelBackend implements ICacheBackend {
  private client: Redis;
  private ready = false;
  private lastKnownAddress: string | null = null;
  readonly masterName: string;

  constructor(sentinels: Array<{ host: string; port: number }>, masterName: string) {
    this.masterName = masterName;
    this.client = new Redis({
      sentinels,
      name: masterName,
      // Fail fast on connection errors rather than queuing commands forever.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      sentinelRetryStrategy: (times: number) => Math.min(times * 200, 2000),
    });

    this.client.on('ready', () => {
      this.ready = true;
      const address = this.currentAddress();

      if (this.lastKnownAddress && address && address !== this.lastKnownAddress) {
        // We were previously connected to a different primary — this is a
        // Sentinel-driven failover, not an initial connect.
        logger.warn('Redis Sentinel failover — new primary elected', {
          master: this.masterName,
          previousPrimary: this.lastKnownAddress,
          newPrimary: address,
        });
      } else {
        logger.info('Redis Sentinel connected', { master: this.masterName, primary: address });
      }

      this.lastKnownAddress = address ?? this.lastKnownAddress;
    });

    this.client.on('error', (err) => {
      this.ready = false;
      logger.warn('Redis Sentinel error — falling back to in-memory', {
        master: this.masterName,
        error: err.message,
      });
    });

    this.client.on('close', () => {
      this.ready = false;
    });

    // Initiate connection; errors are handled by the 'error' listener above.
    this.client.connect().catch(() => {
      // Swallow — the error listener already logged it.
    });
  }

  /** Best-effort address of the currently-connected master, for failover logging. */
  private currentAddress(): string | null {
    const stream = (this.client as unknown as {
      stream?: { remoteAddress?: string; remotePort?: number };
    }).stream;
    if (!stream?.remoteAddress) return null;
    return `${stream.remoteAddress}:${stream.remotePort}`;
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
  private redis: RedisBackend | RedisClusterBackend | RedisSentinelBackend | null = null;
  private memory: InMemoryBackend;
  /** Default TTL in seconds (overridable per call). */
  readonly defaultTTL: number;
  /** Circuit breaker guarding Redis so a flapping/unhealthy instance doesn't
   *  get hammered on every request (#1577 / #1567). */
  private readonly circuitBreaker = new CircuitBreaker();
  /** Tracks the previous availability of Redis so we can detect a
   *  down → up transition and clear stale in-memory fallback data. */
  private wasRedisAvailable = false;

  constructor(
    redisUrl?: string,
    defaultTTL = 300,
    clusterNodes?: string,
    sentinel?: { hosts?: string; masterName?: string }
  ) {
    this.defaultTTL = defaultTTL;
    this.memory = new InMemoryBackend();

    const parsedSentinels = parseSentinelHosts(sentinel?.hosts);
    const parsedNodes = parseClusterNodes(clusterNodes);

    if (parsedSentinels.length > 0) {
      this.redis = new RedisSentinelBackend(parsedSentinels, sentinel?.masterName ?? 'mymaster');
    } else if (parsedNodes.length > 0) {
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
   * Return the active backend: Redis when connected and the circuit breaker
   * is closed (or ready to probe again), in-memory otherwise. This makes
   * Redis the primary store and the in-memory LRU-style fallback automatic
   * during an outage or Sentinel failover (#1577 / #1567).
   */
  private backend(): ICacheBackend {
    const redisAvailable = this.redis?.isAvailable() ?? false;

    if (redisAvailable && !this.wasRedisAvailable) {
      // Redis just came back after being down — drop the in-memory fallback
      // so stale fallback data can't shadow fresh values from Redis.
      this.memory.clear();
      logger.info('Redis recovered — in-memory fallback cache cleared');
    }
    this.wasRedisAvailable = redisAvailable;

    if (redisAvailable && this.redis && this.circuitBreaker.canAttempt()) {
      return this.redis;
    }
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
    const activeBackend = this.backend();
    const usingRedis = activeBackend === this.redis;

    try {
      const raw = await activeBackend.get(key);
      if (usingRedis) this.circuitBreaker.recordSuccess();

      if (raw === null) {
        metricsService.recordCacheMiss(namespace);
        return null;
      }
      metricsService.recordCacheHit(namespace);
      return JSON.parse(raw) as T;
    } catch (error) {
      logger.error('Cache get error', { key, error });

      if (usingRedis) {
        // A single failed Redis command shouldn't surface as a miss when the
        // in-memory fallback might still have the value — count the failure
        // toward the circuit breaker and retry against memory.
        this.circuitBreaker.recordFailure();
        try {
          const fallbackRaw = await this.memory.get(key);
          if (fallbackRaw !== null) {
            metricsService.recordCacheHit(namespace);
            return JSON.parse(fallbackRaw) as T;
          }
        } catch {
          // Fall through to the miss below.
        }
      }

      metricsService.recordCacheMiss(namespace);
      return null;
    }
  }

  /**
   * Store a value. Silently swallows errors so a cache failure never breaks
   * the request path.
   */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const activeBackend = this.backend();
    const usingRedis = activeBackend === this.redis;
    const serialized = JSON.stringify(value);

    try {
      await activeBackend.set(key, serialized, ttl ?? this.defaultTTL);
      if (usingRedis) this.circuitBreaker.recordSuccess();
    } catch (error) {
      logger.error('Cache set error', { key, error });

      if (usingRedis) {
        this.circuitBreaker.recordFailure();
        // Best-effort fallback so the value is still cached despite the
        // Redis failure, instead of being silently dropped.
        try {
          await this.memory.set(key, serialized, ttl ?? this.defaultTTL);
        } catch {
          // Nothing more we can do.
        }
      }
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

  /** Whether Redis (single-instance, cluster, or Sentinel-monitored) is currently connected. */
  get isRedisConnected(): boolean {
    return this.redis?.isAvailable() ?? false;
  }

  /** Whether a Redis backend is configured at all (regardless of current health). */
  get isRedisConfigured(): boolean {
    return this.redis !== null;
  }

  /** Whether the cache is backed by a Redis Cluster (vs. a single instance). */
  get isClusterMode(): boolean {
    return this.redis instanceof RedisClusterBackend;
  }

  /** Whether the cache is backed by a Sentinel-monitored primary (#1577 / #1567). */
  get isSentinelMode(): boolean {
    return this.redis instanceof RedisSentinelBackend;
  }

  /** Whether the circuit breaker currently has Redis attempts blocked. */
  get isCircuitOpen(): boolean {
    return this.circuitBreaker.isOpen;
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

const _resolveConfig = (): {
    redisUrl?: string;
    ttl: number;
    clusterNodes?: string;
    sentinelHosts?: string;
    sentinelMasterName?: string;
} => {
    try {
        const env = getEnv();
        return {
            redisUrl: env.REDIS_URL,
            ttl: env.PROFILE_CACHE_TTL_SECONDS,
            clusterNodes: env.REDIS_CLUSTER_NODES,
            sentinelHosts: env.REDIS_SENTINEL_HOSTS,
            sentinelMasterName: env.REDIS_SENTINEL_MASTER_NAME,
        };
    } catch {
        // Fallback before initEnv() runs (e.g. unit tests importing this module directly).
        return {
            redisUrl: process.env.REDIS_URL,
            ttl: Number(process.env.PROFILE_CACHE_TTL_SECONDS ?? 300),
            clusterNodes: process.env.REDIS_CLUSTER_NODES,
            sentinelHosts: process.env.REDIS_SENTINEL_HOSTS,
            sentinelMasterName: process.env.REDIS_SENTINEL_MASTER_NAME ?? 'mymaster',
        };
    }
};

const { redisUrl, ttl, clusterNodes, sentinelHosts, sentinelMasterName } = _resolveConfig();

export const cacheService = new CacheService(redisUrl, ttl, clusterNodes, {
    hosts: sentinelHosts,
    masterName: sentinelMasterName,
});
