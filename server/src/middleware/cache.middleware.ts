import { Request, Response, NextFunction } from 'express';
import { cacheService } from '../services/cache.service';
import crypto from 'crypto';

/**
 * Generate ETag for response body
 */
const generateETag = (body: any): string => {
  const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto.createHash('md5').update(bodyString).digest('hex');
};

/**
 * Set HTTP caching headers
 */
const setCacheHeaders = (
  res: Response,
  options: {
    maxAge?: number;
    sMaxAge?: number;
    staleWhileRevalidate?: number;
    staleIfError?: number;
    public?: boolean;
    private?: boolean;
    noCache?: boolean;
    noStore?: boolean;
    mustRevalidate?: boolean;
    etag?: string;
    lastModified?: Date;
  } = {}
): void => {
  const {
    maxAge = 300,
    sMaxAge,
    staleWhileRevalidate = 86400,
    staleIfError = 86400,
    public: isPublic = true,
    private: isPrivate = false,
    noCache = false,
    noStore = false,
    mustRevalidate = false,
    etag,
    lastModified,
  } = options;

  // Build Cache-Control header
  const directives: string[] = [];

  if (noStore) {
    directives.push('no-store');
  } else if (noCache) {
    directives.push('no-cache');
  } else {
    if (isPublic) directives.push('public');
    if (isPrivate) directives.push('private');
    if (mustRevalidate) directives.push('must-revalidate');
    directives.push(`max-age=${maxAge}`);
    if (sMaxAge) directives.push(`s-maxage=${sMaxAge}`);
    if (staleWhileRevalidate) directives.push(`stale-while-revalidate=${staleWhileRevalidate}`);
    if (staleIfError) directives.push(`stale-if-error=${staleIfError}`);
  }

  res.setHeader('Cache-Control', directives.join(', '));

  // Set ETag if provided
  if (etag) {
    res.setHeader('ETag', `"${etag}"`);
  }

  // Set Last-Modified if provided
  if (lastModified) {
    res.setHeader('Last-Modified', lastModified.toUTCString());
  }
};

/**
 * Check if client has fresh cache (ETag or Last-Modified)
 */
const isFreshCache = (req: Request, etag?: string, lastModified?: Date): boolean => {
  const ifNoneMatch = req.get('If-None-Match');
  const ifModifiedSince = req.get('If-Modified-Since');

  // Check ETag
  if (ifNoneMatch && etag) {
    return ifNoneMatch === `"${etag}"`;
  }

  // Check Last-Modified
  if (ifModifiedSince && lastModified) {
    const clientDate = new Date(ifModifiedSince);
    return lastModified <= clientDate;
  }

  return false;
};

/**
 * Cache middleware for API responses with HTTP caching headers
 * Caches GET requests with configurable TTL and proper HTTP headers
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
      setCacheHeaders(res, { noCache: true, noStore: true });
      next();
      return;
    }

    const cacheKey = `api:${req.originalUrl}`;

    try {
      const cached = await cacheService.get(cacheKey);
      
      if (cached) {
        const etag = generateETag(cached);
        const lastModified = (cached as any)?.lastModified ? new Date((cached as any).lastModified) : undefined;

        // Check if client has fresh cache
        if (isFreshCache(req, etag, lastModified)) {
          res.setHeader('X-Cache', 'HIT');
          res.status(304).end();
          return;
        }

        setCacheHeaders(res, {
          maxAge: ttl,
          etag,
          lastModified,
        });
        res.setHeader('X-Cache', 'HIT');
        res.json(cached);
        return;
      }

      // Override res.json to cache the response and set headers
      const originalJson = res.json.bind(res);
      res.json = function(body: any) {
        // Cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const etag = generateETag(body);
          const lastModified = new Date();
          
          cacheService.set(cacheKey, { ...body, lastModified }, ttl);
          
          setCacheHeaders(res, {
            maxAge: ttl,
            etag,
            lastModified,
          });
        }
        res.setHeader('X-Cache', 'MISS');
        return originalJson(body);
      };

      next();
    } catch (error) {
      // If cache fails, continue without caching but set no-cache headers
      setCacheHeaders(res, { noCache: true, noStore: true });
      next();
    }
  };
};

/**
 * Static asset caching middleware
 * For CDN caching of static assets
 */
export const staticCacheMiddleware = (maxAge: number = 31536000) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    setCacheHeaders(res, {
      maxAge,
      sMaxAge: maxAge,
      staleWhileRevalidate: 86400,
      public: true,
    });
    next();
  };
};

/**
 * API response caching with CDN support
 * For API responses that can be cached by CDN
 */
export const apiCacheMiddleware = (options: {
  maxAge?: number;
  sMaxAge?: number;
  staleWhileRevalidate?: number;
} = {}) => {
  const { maxAge = 300, sMaxAge = 600, staleWhileRevalidate = 86400 } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'GET') {
      next();
      return;
    }

    const cacheKey = `api:cdn:${req.originalUrl}`;

    try {
      const cached = await cacheService.get(cacheKey);
      
      if (cached) {
        const etag = generateETag(cached);
        
        if (isFreshCache(req, etag)) {
          res.setHeader('X-Cache', 'HIT');
          res.status(304).end();
          return;
        }

        setCacheHeaders(res, {
          maxAge,
          sMaxAge,
          staleWhileRevalidate,
          public: true,
          etag,
        });
        res.setHeader('X-Cache', 'HIT');
        res.json(cached);
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = function(body: any) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const etag = generateETag(body);
          cacheService.set(cacheKey, body, maxAge);
          
          setCacheHeaders(res, {
            maxAge,
            sMaxAge,
            staleWhileRevalidate,
            public: true,
            etag,
          });
        }
        res.setHeader('X-Cache', 'MISS');
        return originalJson(body);
      };

      next();
    } catch (error) {
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
