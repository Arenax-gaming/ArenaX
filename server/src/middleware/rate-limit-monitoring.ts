import { Redis } from 'ioredis';
import { logger } from '../services/logger.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitMetrics {
  redisConnected: boolean;
  totalKeys: number;
  memoryUsageBytes: number;
  uptime: number;
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

/**
 * Create a health check function that pings Redis and returns true
 * if the connection is alive.
 */
export function createRateLimitHealthCheck(redis: Redis): () => Promise<boolean> {
  return async (): Promise<boolean> => {
    try {
      const pong = await redis.ping();
      return pong === 'PONG';
    } catch (error) {
      logger.warn('Rate limit Redis health check failed', { error });
      return false;
    }
  };
}

// ---------------------------------------------------------------------------
// Metrics Export
// ---------------------------------------------------------------------------

let _metricsProvider: (() => Promise<RateLimitMetrics>) | null = null;

/**
 * Register a metrics provider for the monitoring endpoint.
 */
export function registerRateLimitMetricsProvider(
  provider: () => Promise<RateLimitMetrics>
): void {
  _metricsProvider = provider;
}

/**
 * Get current rate limit metrics. Returns null if no provider is registered.
 */
export async function getRateLimitMetrics(): Promise<RateLimitMetrics | null> {
  if (!_metricsProvider) return null;
  try {
    return await _metricsProvider();
  } catch (error) {
    logger.error('Failed to get rate limit metrics', { error });
    return null;
  }
}
