import { Redis } from 'ioredis';
import { logger } from './logger.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitStats {
  totalHits: number;
  totalBlocks: number;
  hitsByTier: Record<string, number>;
  blocksByTier: Record<string, number>;
  windowMs: number;
}

// ---------------------------------------------------------------------------
// RateLimitAnalytics
// ---------------------------------------------------------------------------

/**
 * Tracks rate limiting metrics in Redis using sorted sets keyed by timestamp.
 *
 * This allows time-window queries without needing a dedicated analytics database.
 * Each hit/block is stored as a member of a sorted set with the timestamp as
 * the score, enabling efficient range queries.
 */
export class RateLimitAnalytics {
  private redis: Redis;
  private prefix: string;

  constructor(redis: Redis, prefix = 'rla:') {
    this.redis = redis;
    this.prefix = prefix;
  }

  /**
   * Record a rate limit hit (request that was counted but not blocked).
   */
  async recordHit(key: string, tier: string): Promise<void> {
    const timestamp = Date.now();
    try {
      const pipeline = this.redis.pipeline();
      // Global hit counter
      pipeline.zadd(`${this.prefix}hits`, timestamp, `${key}:${timestamp}`);
      // Per-tier hit counter
      pipeline.zadd(`${this.prefix}hits:${tier}`, timestamp, `${key}:${timestamp}`);
      // Expire after 24 hours to prevent unbounded growth
      pipeline.expire(`${this.prefix}hits`, 86400);
      pipeline.expire(`${this.prefix}hits:${tier}`, 86400);
      await pipeline.exec();
    } catch (error) {
      logger.error('Rate limit analytics recordHit failed', { key, tier, error });
    }
  }

  /**
   * Record a rate limit block (request that was rejected with 429).
   */
  async recordBlock(key: string, tier: string): Promise<void> {
    const timestamp = Date.now();
    try {
      const pipeline = this.redis.pipeline();
      pipeline.zadd(`${this.prefix}blocks`, timestamp, `${key}:${timestamp}`);
      pipeline.zadd(`${this.prefix}blocks:${tier}`, timestamp, `${key}:${timestamp}`);
      pipeline.expire(`${this.prefix}blocks`, 86400);
      pipeline.expire(`${this.prefix}blocks:${tier}`, 86400);
      await pipeline.exec();
    } catch (error) {
      logger.error('Rate limit analytics recordBlock failed', { key, tier, error });
    }
  }

  /**
   * Get aggregate stats for a time window.
   */
  async getStats(windowMs = 3600_000): Promise<RateLimitStats> {
    const minScore = Date.now() - windowMs;
    const maxScore = Date.now();

    try {
      const [hitsCount, blocksCount] = await Promise.all([
        this.redis.zcount(`${this.prefix}hits`, minScore, maxScore),
        this.redis.zcount(`${this.prefix}blocks`, minScore, maxScore),
      ]);

      const tiers = ['auth', 'payment', 'admin', 'public', 'api', 'adaptive', 'token-bucket'];
      const hitsByTier: Record<string, number> = {};
      const blocksByTier: Record<string, number> = {};

      for (const tier of tiers) {
        const [h, b] = await Promise.all([
          this.redis.zcount(`${this.prefix}hits:${tier}`, minScore, maxScore),
          this.redis.zcount(`${this.prefix}blocks:${tier}`, minScore, maxScore),
        ]);
        hitsByTier[tier] = h;
        blocksByTier[tier] = b;
      }

      return {
        totalHits: hitsCount,
        totalBlocks: blocksCount,
        hitsByTier,
        blocksByTier,
        windowMs,
      };
    } catch (error) {
      logger.error('Rate limit analytics getStats failed', { error });
      return {
        totalHits: 0,
        totalBlocks: 0,
        hitsByTier: {},
        blocksByTier: {},
        windowMs,
      };
    }
  }

  /**
   * Get the most frequently rate-limited keys in the given window.
   */
  async getTopLimitedKeys(limit = 20, windowMs = 3600_000): Promise<Array<{ key: string; count: number }>> {
    const minScore = Date.now() - windowMs;
    const maxScore = Date.now();

    try {
      const raw = await this.redis.zrevrangebyscore(
        `${this.prefix}blocks`,
        maxScore,
        minScore,
        'WITHSCORES',
        'LIMIT',
        0,
        limit * 2
      );

      const counts = new Map<string, number>();
      for (let i = 0; i < raw.length; i += 2) {
        const member = raw[i];
        const key = member.split(':').slice(0, -1).join(':');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      return Array.from(counts.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    } catch (error) {
      logger.error('Rate limit analytics getTopLimitedKeys failed', { error });
      return [];
    }
  }
}
