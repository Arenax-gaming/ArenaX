import { Redis } from 'ioredis';
import type { Store, IncrementResponse } from 'express-rate-limit';
import { logger } from '../services/logger.service';

/**
 * Redis-backed store for express-rate-limit.
 *
 * Uses atomic INCR + EXPIRE for a fixed-window counter per key.
 * Keys are prefixed to avoid collisions with other Redis data.
 *
 * @example
 * ```ts
 * const store = new RedisRateLimitStore({ redis, windowMs: 60_000 });
 * const limiter = rateLimit({ store, windowMs: 60_000, limit: 100 });
 * ```
 */
export class RedisRateLimitStore implements Store {
  private redis: Redis;
  private keyPrefix: string;
  private windowMs: number;

  constructor(options: { redis: Redis; prefix?: string; windowMs: number }) {
    this.redis = options.redis;
    this.keyPrefix = options.prefix ?? 'rl:';
    this.windowMs = options.windowMs;
  }

  /**
   * Increment the counter for a key. Returns the new count and the
   * time until the window resets.
   */
  async increment(key: string): Promise<IncrementResponse> {
    const redisKey = `${this.keyPrefix}${key}`;
    const ttlSeconds = Math.ceil(this.windowMs / 1000);

    try {
      const count = await this.redis.incr(redisKey);

      // Set expiry only on first request in the window.
      if (count === 1) {
        await this.redis.expire(redisKey, ttlSeconds);
      }

      // Compute remaining TTL to report reset time.
      const ttl = await this.redis.pttl(redisKey);
      const resetTimeMs = ttl > 0 ? Date.now() + ttl : Date.now() + this.windowMs;

      return { totalHits: count, resetTime: new Date(resetTimeMs) };
    } catch (error) {
      logger.error('Redis rate limit store increment failed', { key, error });
      // On failure, treat as first hit so the request is allowed through.
      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  /**
   * Decrement the counter for a key (used by sliding-window implementations).
   */
  async decrement(key: string): Promise<void> {
    const redisKey = `${this.keyPrefix}${key}`;

    try {
      const count = await this.redis.decr(redisKey);
      if (count <= 0) {
        await this.redis.del(redisKey);
      }
    } catch (error) {
      logger.error('Redis rate limit store decrement failed', { key, error });
    }
  }

  /**
   * Reset the counter for a single key.
   */
  async resetKey(key: string): Promise<void> {
    const redisKey = `${this.keyPrefix}${key}`;

    try {
      await this.redis.del(redisKey);
    } catch (error) {
      logger.error('Redis rate limit store resetKey failed', { key, error });
    }
  }

  /**
   * Reset all keys with this store's prefix.
   */
  async resetAll(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      logger.error('Redis rate limit store resetAll failed', { error });
    }
  }
}
