import Redis from 'ioredis';
import { logger } from './logger.service';
import { metricsService } from './metrics.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InMemoryEntry {
  value: unknown;
  expiry: number;
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
// RedisBackend
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
  private redis: RedisBackend | null = null;
  private memory: InMemoryBackend;
  /** Default TTL in seconds (overridable per call). */
  readonly defaultTTL: number;

  constructor(redisUrl?: string, defaultTTL = 300) {
    this.defaultTTL = defaultTTL;
    this.memory = new InMemoryBackend();

    if (redisUrl) {
      this.redis = new RedisBackend(redisUrl);
    } else {
      logger.info('REDIS_URL not set — using in-memory cache');
    }

    // Evict stale in-memory entries every minute regardless of Redis status.
    setInterval(() => this.memory.evictExpired(), 60_000).unref();
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

  /** Whether Redis is currently connected. */
  get isRedisConnected(): boolean {
    return this.redis?.isAvailable() ?? false;
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

const _resolveConfig = (): { redisUrl?: string; ttl: number } => {
    try {
        const env = getEnv();
        return { redisUrl: env.REDIS_URL, ttl: env.PROFILE_CACHE_TTL_SECONDS };
    } catch {
        // Fallback before initEnv() runs (e.g. unit tests importing this module directly).
        return {
            redisUrl: process.env.REDIS_URL,
            ttl: Number(process.env.PROFILE_CACHE_TTL_SECONDS ?? 300),
        };
    }
};

const { redisUrl, ttl } = _resolveConfig();

export const cacheService = new CacheService(redisUrl, ttl);
