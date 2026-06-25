import Redis from 'ioredis';
import { logger } from './logger.service';

const CACHE_TTL = 300;
const CACHE_PREFIX = 'qcache:';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  }
  return redis;
}

export function buildCacheKey(model: string, query: string, params: unknown[]): string {
  return `${CACHE_PREFIX}${model}:${query}:${JSON.stringify(params)}`;
}

export async function getCachedResult<T>(key: string): Promise<T | null> {
  try {
    const r = getRedis();
    const raw = await r.get(key);
    if (raw) {
      logger.debug('Query cache hit', { key });
      return JSON.parse(raw) as T;
    }
    logger.debug('Query cache miss', { key });
    return null;
  } catch (err) {
    logger.warn('Query cache get error', { error: err });
    return null;
  }
}

export async function setCachedResult(key: string, value: unknown, ttl = CACHE_TTL): Promise<void> {
  try {
    const r = getRedis();
    await r.setex(key, ttl, JSON.stringify(value));
  } catch (err) {
    logger.warn('Query cache set error', { error: err });
  }
}

export async function invalidateCache(pattern: string): Promise<void> {
  try {
    const r = getRedis();
    const keys = await r.keys(`${CACHE_PREFIX}${pattern}*`);
    if (keys.length > 0) {
      await r.del(...keys);
      logger.debug('Query cache invalidated', { count: keys.length, pattern });
    }
  } catch (err) {
    logger.warn('Query cache invalidation error', { error: err });
  }
}

export async function clearAllCache(): Promise<void> {
  try {
    const r = getRedis();
    const keys = await r.keys(`${CACHE_PREFIX}*`);
    if (keys.length > 0) {
      await r.del(...keys);
      logger.info('Query cache cleared', { count: keys.length });
    }
  } catch (err) {
    logger.warn('Query cache clear error', { error: err });
  }
}

export async function getCacheStats(): Promise<{ keys: number; size: string } | null> {
    return null;
}
