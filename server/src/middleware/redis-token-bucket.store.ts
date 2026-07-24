import { Redis } from 'ioredis';
import type { ITokenBucketStore, TokenBucketState } from './token-bucket-rate-limit.middleware';
import { logger } from '../services/logger.service';

/**
 * Redis-backed token bucket store.
 *
 * Stores each bucket as a Redis hash with `tokens` and `lastRefill` fields.
 * Keys are prefixed to isolate token bucket data from other Redis usage.
 */
export class RedisTokenBucketStore implements ITokenBucketStore {
  private redis: Redis;
  private prefix: string;

  constructor(redis: Redis, prefix = 'tb:') {
    this.redis = redis;
    this.prefix = prefix;
  }

  private key(identifier: string): string {
    return `${this.prefix}${identifier}`;
  }

  async get(identifier: string): Promise<TokenBucketState | undefined> {
    try {
      const data = await this.redis.hgetall(this.key(identifier));
      if (!data.tokens) return undefined;

      return {
        tokens: parseFloat(data.tokens),
        lastRefill: parseInt(data.lastRefill, 10),
      };
    } catch (error) {
      logger.error('Redis token bucket get failed', { identifier, error });
      return undefined;
    }
  }

  async set(identifier: string, state: TokenBucketState): Promise<void> {
    try {
      const key = this.key(identifier);
      await this.redis
        .multi()
        .hset(key, {
          tokens: String(state.tokens),
          lastRefill: String(state.lastRefill),
        })
        .expire(key, 3600)
        .exec();
    } catch (error) {
      logger.error('Redis token bucket set failed', { identifier, error });
    }
  }

  async delete(identifier: string): Promise<void> {
    try {
      await this.redis.del(this.key(identifier));
    } catch (error) {
      logger.error('Redis token bucket delete failed', { identifier, error });
    }
  }

  async cleanup(maxAge: number): Promise<void> {
    try {
      const cutoff = Date.now() - maxAge;
      const keys = await this.redis.keys(`${this.prefix}*`);
      if (keys.length === 0) return;

      const pipeline = this.redis.pipeline();
      for (const key of keys) {
        const lastRefill = await this.redis.hget(key, 'lastRefill');
        if (lastRefill && parseInt(lastRefill, 10) < cutoff) {
          pipeline.del(key);
        }
      }
      await pipeline.exec();
    } catch (error) {
      logger.error('Redis token bucket cleanup failed', { error });
    }
  }
}
