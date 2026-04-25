import { Request, Response, NextFunction } from 'express';
import { cacheService } from '../services/cache.service';

/**
 * Cache middleware for API responses
 * Caches GET requests with configurable TTL
 */
export const cacheMiddleware = (ttl: number = 300) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      next();
      return;
    }

    // Skip if cache disabled
    if (req.query.noCache === 'true') {
      next();
      return;
    }

    const cacheKey = `api:${req.originalUrl}`;

    try {
      const cached = await cacheService.get(cacheKey);
      
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.json(cached);
        return;
      }

      // Override res.json to cache the response
      const originalJson = res.json.bind(res);
      res.json = function(body: any) {
        // Cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          cacheService.set(cacheKey, body, ttl);
        }
        res.setHeader('X-Cache', 'MISS');
        return originalJson(body);
      };

      next();
    } catch (error) {
      // If cache fails, continue without caching
      next();
    }
  };
};

/**
 * Cache invalidation helper
 */
export const invalidateCache = async (pattern: string): Promise<void> => {
  // In a real implementation with Redis, this would use SCAN to find matching keys
  // For in-memory cache, we'd need to track keys separately
  await cacheService.delete(pattern);
};
