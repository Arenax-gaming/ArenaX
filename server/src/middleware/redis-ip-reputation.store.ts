import { Redis } from 'ioredis';
import { logger } from '../services/logger.service';

/**
 * Redis-backed IP reputation store.
 *
 * Replaces the in-memory Map in adaptiveRateLimit.middleware.ts so reputation
 * scores persist across server restarts and are shared across instances.
 *
 * Each IP's score is a float ∈ [0, 1] stored as a Redis string with a
 * configurable TTL (default 24 hours) so stale entries are auto-expired.
 */
export class RedisIpReputationStore {
  private redis: Redis;
  private prefix: string;
  private ttlSeconds: number;

  constructor(redis: Redis, prefix = 'iprep:', ttlSeconds = 86400) {
    this.redis = redis;
    this.prefix = prefix;
    this.ttlSeconds = ttlSeconds;
  }

  private key(ip: string): string {
    return `${this.prefix}${ip}`;
  }

  /**
   * Get the reputation score for an IP. Returns 1.0 (fully trusted)
   * if the IP has no stored score.
   */
  async getReputation(ip: string): Promise<number> {
    try {
      const raw = await this.redis.get(this.key(ip));
      if (raw === null) return 1.0;
      const score = parseFloat(raw);
      return isNaN(score) ? 1.0 : Math.max(0, Math.min(1, score));
    } catch (error) {
      logger.error('Redis IP reputation get failed', { ip, error });
      return 1.0;
    }
  }

  /**
   * Set the reputation score for an IP, clamped to [0, 1].
   */
  async setReputation(ip: string, score: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, score));
    try {
      await this.redis.set(this.key(ip), String(clamped), 'EX', this.ttlSeconds);
    } catch (error) {
      logger.error('Redis IP reputation set failed', { ip, error });
    }
  }
}
