import { Request, Response, NextFunction } from 'express';
import { cdnCacheService } from '../services/cdn-cache.service';
import { cacheService } from '../services/cache.service';
import { getEnv } from '../config/env';

const BYPASS_HEADER = 'x-cache-bypass';
const DEBUG_HEADER = 'x-cache-debug';

export function cdnCacheMiddleware(options: { ttl?: number; tags?: string[] } = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'GET') {
      next();
      return;
    }

    if (req.headers[BYPASS_HEADER] === 'true' || req.query._noCache === 'true') {
      res.setHeader('X-Cache', 'BYPASS');
      next();
      return;
    }

    const env = getEnv();
    const cacheKey = cdnCacheService.buildCacheKey(['cdn', req.originalUrl]);
    const cacheTags = options.tags ?? [];

    try {
      const cached = await cacheService.get<{ body: unknown; status: number; headers: Record<string, string> }>(cacheKey, 'cdn');

      if (cached) {
        cdnCacheService.recordHit();
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Key', cacheKey);
        if (cacheTags.length > 0) {
          res.setHeader('Cache-Tag', cacheTags.join(','));
        }

        const cdnHeaders = cdnCacheService.buildCacheControlHeaders(options.ttl);
        Object.entries(cdnHeaders).forEach(([k, v]) => res.setHeader(k, v));

        res.status(cached.status).json(cached.body);
        return;
      }

      cdnCacheService.recordMiss();

      const originalJson = res.json.bind(res);
      res.json = function (body: unknown) {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          cacheService.set(cacheKey, { body, status: res.statusCode, headers: {} }, options.ttl).catch(() => {});
          cdnCacheService.queueForWarming(req.originalUrl);
        }

        const cdnHeaders = cdnCacheService.buildCacheControlHeaders(options.ttl);
        Object.entries(cdnHeaders).forEach(([k, v]) => res.setHeader(k, v));

        res.setHeader('X-Cache', 'MISS');
        res.setHeader('X-Cache-Key', cacheKey);
        if (cacheTags.length > 0) {
          res.setHeader('Cache-Tag', cacheTags.join(','));
        }

        return originalJson(body);
      };

      next();
    } catch {
      next();
    }
  };
}

export async function invalidateCdnCache(pattern: string, reason: string): Promise<boolean> {
  const cacheKey = `cdn:${pattern}`;
  await cacheService.delete(cacheKey);
  return cdnCacheService.purgeByPattern(pattern, reason);
}
