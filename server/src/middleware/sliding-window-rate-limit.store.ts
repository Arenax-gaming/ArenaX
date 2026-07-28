import { Redis } from 'ioredis';
import type { Store, IncrementResponse } from 'express-rate-limit';
import { logger } from '../services/logger.service';

/**
 * Redis-backed sliding-window-counter store for express-rate-limit.
 *
 * The previous store (`RedisRateLimitStore`) used a fixed-window counter
 * (INCR + EXPIRE), which lets clients burst up to 2x the limit around a
 * window boundary (e.g. limit=100/min lets 100 requests at 0:59 and
 * another 100 at 1:01). This store approximates a true sliding window
 * without the memory cost of a sliding log (one Redis entry per request):
 * it keeps a counter for the current fixed window and the previous one,
 * and weights the previous window's count by how much of it still
 * overlaps the trailing `windowMs` interval.
 *
 * `estimatedCount = currentWindowCount + previousWindowCount * overlap`
 * where `overlap` is the fraction of the previous window still inside
 * the sliding lookback (1.0 right at the boundary, decaying to 0.0 as
 * the current window fills up). This is the same algorithm Cloudflare
 * and Kong document for their sliding-window limiters — O(1) per
 * request, two keys per window, and accurate to within the granularity
 * of the underlying fixed window.
 *
 * @example
 * ```ts
 * const store = new SlidingWindowRateLimitStore({ redis, windowMs: 60_000 });
 * const limiter = rateLimit({ store, windowMs: 60_000, limit: 100 });
 * ```
 */
export class SlidingWindowRateLimitStore implements Store {
  private redis: Redis;
  private keyPrefix: string;
  private windowMs: number;

  constructor(options: { redis: Redis; prefix?: string; windowMs: number }) {
    this.redis = options.redis;
    this.keyPrefix = options.prefix ?? 'rlsw:';
    this.windowMs = options.windowMs;
  }

  private windowKeys(now: number): { currentKey: string; previousKey: string; windowId: number } {
    const windowId = Math.floor(now / this.windowMs);
    return {
      windowId,
      currentKey: `w:${windowId}`,
      previousKey: `w:${windowId - 1}`,
    };
  }

  /**
   * Atomically increments the current window's counter and reads the
   * previous window's counter in a single round trip, so concurrent
   * requests can't race between the two reads.
   */
  private async incrementAndReadPrevious(
    currentRedisKey: string,
    previousRedisKey: string,
    ttlMs: number,
  ): Promise<{ current: number; previous: number }> {
    const script = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
      end
      local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
      return {current, previous}
    `;
    const result = (await this.redis.eval(
      script,
      2,
      currentRedisKey,
      previousRedisKey,
      ttlMs,
    )) as [number, number];

    return { current: result[0], previous: result[1] };
  }

  async increment(key: string): Promise<IncrementResponse> {
    const now = Date.now();
    const { currentKey, previousKey, windowId } = this.windowKeys(now);
    const currentRedisKey = `${this.keyPrefix}${key}:${currentKey}`;
    const previousRedisKey = `${this.keyPrefix}${key}:${previousKey}`;
    // Keep the "current" bucket alive for two windows so it can serve as
    // the "previous" bucket for the next window without a second write.
    const ttlMs = this.windowMs * 2;

    try {
      const { current, previous } = await this.incrementAndReadPrevious(
        currentRedisKey,
        previousRedisKey,
        ttlMs,
      );

      const elapsedInCurrentWindow = now - windowId * this.windowMs;
      const overlap = Math.max(0, (this.windowMs - elapsedInCurrentWindow) / this.windowMs);
      const totalHits = Math.ceil(current + previous * overlap);
      const resetTimeMs = (windowId + 1) * this.windowMs;

      return { totalHits, resetTime: new Date(resetTimeMs) };
    } catch (error) {
      logger.error('Sliding window rate limit store increment failed', { key, error });
      // On failure, treat as first hit so the request is allowed through.
      return { totalHits: 1, resetTime: new Date(now + this.windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    const now = Date.now();
    const { currentKey } = this.windowKeys(now);
    const currentRedisKey = `${this.keyPrefix}${key}:${currentKey}`;

    try {
      const count = await this.redis.decr(currentRedisKey);
      if (count <= 0) {
        await this.redis.del(currentRedisKey);
      }
    } catch (error) {
      logger.error('Sliding window rate limit store decrement failed', { key, error });
    }
  }

  async resetKey(key: string): Promise<void> {
    const now = Date.now();
    const { currentKey, previousKey } = this.windowKeys(now);

    try {
      await this.redis.del(`${this.keyPrefix}${key}:${currentKey}`, `${this.keyPrefix}${key}:${previousKey}`);
    } catch (error) {
      logger.error('Sliding window rate limit store resetKey failed', { key, error });
    }
  }

  async resetAll(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      logger.error('Sliding window rate limit store resetAll failed', { error });
    }
  }
}
