import type { Store, IncrementResponse } from 'express-rate-limit';
import { logger } from '../services/logger.service';

/**
 * A Store wrapper that delegates to a primary store and falls back
 * to a secondary (in-memory) store when the primary fails.
 *
 * This ensures rate limiting always works even if Redis is down,
 * while preferring Redis for distributed counting when available.
 */
export class FailoverStore implements Store {
  private primary: Store;
  private fallback: Store;
  private isPrimaryHealthy = true;
  private lastHealthCheck = 0;
  private healthCheckIntervalMs: number;
  private healthCheckFn?: () => Promise<boolean>;

  constructor(
    primary: Store,
    fallback: Store,
    options?: {
      healthCheckIntervalMs?: number;
      healthCheckFn?: () => Promise<boolean>;
    }
  ) {
    this.primary = primary;
    this.fallback = fallback;
    this.healthCheckIntervalMs = options?.healthCheckIntervalMs ?? 30_000;
    this.healthCheckFn = options?.healthCheckFn;
  }

  /**
   * Check primary health at most once per interval.
   */
  private async ensurePrimaryHealthy(): Promise<void> {
    const now = Date.now();
    if (now - this.lastHealthCheck < this.healthCheckIntervalMs) return;
    this.lastHealthCheck = now;

    if (this.healthCheckFn) {
      try {
        this.isPrimaryHealthy = await this.healthCheckFn();
      } catch {
        this.isPrimaryHealthy = false;
      }
    }
  }

  private get activeStore(): Store {
    return this.isPrimaryHealthy ? this.primary : this.fallback;
  }

  async increment(key: string): Promise<IncrementResponse> {
    await this.ensurePrimaryHealthy();

    try {
      const result = await this.activeStore.increment(key);
      this.isPrimaryHealthy = true;
      return result;
    } catch (error) {
      if (this.isPrimaryHealthy) {
        logger.warn('Primary rate limit store failed, switching to fallback', { error });
        this.isPrimaryHealthy = false;
      }
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    await this.ensurePrimaryHealthy();

    try {
      await this.activeStore.decrement(key);
      this.isPrimaryHealthy = true;
    } catch (error) {
      if (this.isPrimaryHealthy) {
        this.isPrimaryHealthy = false;
      }
      await this.fallback.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.ensurePrimaryHealthy();

    try {
      await this.activeStore.resetKey(key);
      this.isPrimaryHealthy = true;
    } catch (error) {
      if (this.isPrimaryHealthy) {
        this.isPrimaryHealthy = false;
      }
      await this.fallback.resetKey(key);
    }
  }

  async resetAll(): Promise<void> {
    await this.ensurePrimaryHealthy();

    try {
      if (typeof this.activeStore.resetAll === 'function') {
        await this.activeStore.resetAll();
      }
      this.isPrimaryHealthy = true;
    } catch (error) {
      if (this.isPrimaryHealthy) {
        this.isPrimaryHealthy = false;
      }
      if (typeof this.fallback.resetAll === 'function') {
        await this.fallback.resetAll();
      }
    }
  }
}
