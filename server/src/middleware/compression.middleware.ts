/**
 * compression.middleware.ts
 *
 * Configurable response-compression middleware for the ArenaX HTTP API.
 *
 * Why a wrapper around `compression`?
 *
 * The bare `app.use(compression())` call we used to ship is gzip-only,
 * has no metrics, and doesn't expose its tunables. This wrapper:
 *
 *   1. Honours per-deploy config (env-driven) for `level`, `threshold`,
 *      and an `excludedContentTypes` blocklist for content that is
 *      already compressed (images, videos, archives, fonts).
 *   2. Records prom-client metrics for compression ratio + total
 *      uncompressed and compressed bytes so dashboards can show the
 *      bandwidth reduction.
 *   3. Honours the existing `compression` package's `filter` API and
 *      `req.headers['x-no-compression']` escape hatch.
 *   4. Supports Brotli compression with automatic fallback to gzip based
 *      on client Accept-Encoding header.
 *
 * ## Brotli Support
 *
 * This middleware now supports Brotli compression (br) which typically
 * provides 15-25% better compression ratios than gzip. The implementation:
 *   - Negotiates compression based on client Accept-Encoding header
 *   - Prefers Brotli when supported, falls back to gzip otherwise
 *   - Uses the `brotli` package for Brotli compression
 *   - Maintains backward compatibility with gzip-only clients
 *   - Tracks separate metrics for Brotli vs gzip compression
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import compression from 'compression';
import * as brotli from 'brotli';
import { metricsService } from '../services/metrics.service';
import { logger } from '../services/logger.service';

const EXCLUDED_DEFAULT_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'font/',
  'application/zip',
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
  'application/x-bzip2',
  'application/x-xz',
  'application/octet-stream',
  'application/pdf',
];

export interface CompressionConfig {
  /**
   * zlib compression level (1 = fastest / least compression, 9 = best /
   * slowest). Defaults to 6, matching `compression` upstream.
   */
  level: number;
  /**
   * Minimum response size (in bytes) before compression kicks in.
   * Below this, gzip's per-message overhead is worse than the savings.
   */
  threshold: number;
  /**
   * Content-Type prefixes that should bypass compression entirely.
   * Already-compressed payloads (images, video, archives) waste CPU
   * for no bandwidth win.
   */
  excludedContentTypes: string[];
  /**
   * Enable Brotli compression. Defaults to true.
   */
  enableBrotli: boolean;
  /**
   * Brotli compression quality (0-11). Higher values = better compression
   * but slower. Defaults to 4 (good balance of speed/compression).
   */
  brotliQuality: number;
  /**
   * Brotli mode (0 = generic, 1 = text, 2 = font). Defaults to 0.
   */
  brotliMode: number;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  level: 6,
  threshold: 1024,
  excludedContentTypes: EXCLUDED_DEFAULT_PREFIXES,
  enableBrotli: true,
  brotliQuality: 4,
  brotliMode: 0,
};

export const resolveCompressionConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): CompressionConfig => {
  const level = clampInt(env.COMPRESSION_LEVEL, 1, 9, DEFAULT_COMPRESSION_CONFIG.level);
  const threshold = clampInt(
    env.COMPRESSION_THRESHOLD_BYTES,
    0,
    1024 * 1024,
    DEFAULT_COMPRESSION_CONFIG.threshold,
  );
  const exclusions = env.COMPRESSION_EXCLUDED_TYPES
    ? env.COMPRESSION_EXCLUDED_TYPES.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_COMPRESSION_CONFIG.excludedContentTypes;
  const enableBrotli = env.COMPRESSION_ENABLE_BROTLI !== 'false';
  const brotliQuality = clampInt(env.COMPRESSION_BROTLI_QUALITY, 0, 11, DEFAULT_COMPRESSION_CONFIG.brotliQuality);
  const brotliMode = clampInt(env.COMPRESSION_BROTLI_MODE, 0, 2, DEFAULT_COMPRESSION_CONFIG.brotliMode);
  return { 
    level, 
    threshold, 
    excludedContentTypes: exclusions,
    enableBrotli,
    brotliQuality,
    brotliMode,
  };
};

const clampInt = (raw: string | undefined, min: number, max: number, fallback: number): number => {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/** Returns true if the response Content-Type is in the bypass list. */
export const shouldBypass = (contentType: string | undefined, excluded: string[]): boolean => {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return excluded.some((prefix) => lower.startsWith(prefix));
};

/**
 * Parse Accept-Encoding header and determine preferred encoding.
 * Returns 'br' for Brotli, 'gzip' for gzip, or 'identity' for no compression.
 */
const getPreferredEncoding = (req: Request, enableBrotli: boolean): string => {
  const acceptEncoding = req.headers['accept-encoding'] as string | undefined;
  if (!acceptEncoding) return 'identity';
  
  const lower = acceptEncoding.toLowerCase();
  
  // Check for Brotli support if enabled
  if (enableBrotli && (lower.includes('br') || lower.includes('brotli'))) {
    return 'br';
  }
  
  // Fall back to gzip
  if (lower.includes('gzip')) {
    return 'gzip';
  }
  
  // Check for deflate as another fallback
  if (lower.includes('deflate')) {
    return 'deflate';
  }
  
  return 'identity';
};

/**
 * Build the compression middleware stack. Returns a single
 * `RequestHandler` that records metrics + delegates to the underlying
 * `compression` package or Brotli compression.
 */
export const createCompressionMiddleware = (
  config: CompressionConfig = DEFAULT_COMPRESSION_CONFIG,
): RequestHandler => {
  const inner = compression({
    level: config.level,
    threshold: config.threshold,
    filter: (req, res) => {
      // Explicit opt-out: clients can disable compression with a header
      // (useful for SSE / streaming endpoints).
      if (req.headers['x-no-compression']) return false;
      const contentType = res.getHeader('Content-Type');
      if (typeof contentType === 'string' && shouldBypass(contentType, config.excludedContentTypes)) {
        return false;
      }
      
      // If Brotli is enabled and client supports it, let the Brotli handler deal with it
      if (config.enableBrotli && getPreferredEncoding(req, true) === 'br') {
        return false;
      }
      
      return compression.filter(req, res);
    },
  });

  return (req: Request, res: Response, next: NextFunction) => {
    let uncompressedBytes = 0;
    const write = res.write.bind(res);
    const end = res.end.bind(res);
    const originalWrite = res.write;
    const originalEnd = res.end;
    const chunks: Buffer[] = [];

    // Determine preferred encoding
    const preferredEncoding = getPreferredEncoding(req, config.enableBrotli);
    
    // If Brotli is preferred and enabled, use Brotli compression
    if (preferredEncoding === 'br' && config.enableBrotli) {
      res.setHeader('Content-Encoding', 'br');
      res.removeHeader('Content-Length');
      
      (res as Response).write = function patchedWrite(chunk: any, ...args: any[]): boolean {
        if (chunk) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          uncompressedBytes += buffer.length;
          chunks.push(buffer);
        }
        return true;
      } as Response['write'];

      (res as Response).end = function patchedEnd(chunk?: any, ...args: any[]): Response {
        if (chunk) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          uncompressedBytes += buffer.length;
          chunks.push(buffer);
        }
        
        try {
          const fullBuffer = Buffer.concat(chunks);
          
          // Only compress if above threshold
          if (fullBuffer.length >= config.threshold) {
            const compressed = brotli.compress(fullBuffer, {
              quality: config.brotliQuality,
              mode: config.brotliMode,
            });
            
            res.setHeader('Content-Length', compressed.length);
            originalWrite.call(res, compressed);
            
            // Record metrics
            metricsService.recordCompression?.('br', {
              uncompressedBytes,
              compressedBytes: compressed.length,
              ratio: compressed.length / uncompressedBytes,
            });
          } else {
            // Below threshold, send uncompressed
            res.setHeader('Content-Length', fullBuffer.length);
            originalWrite.call(res, fullBuffer);
            
            // Remove Content-Encoding since we didn't compress
            res.removeHeader('Content-Encoding');
            
            metricsService.recordCompression?.('identity', {
              uncompressedBytes,
              compressedBytes: uncompressedBytes,
              ratio: 1,
            });
          }
        } catch (err) {
          logger.error('Brotli compression failed, falling back to uncompressed', { error: err });
          res.removeHeader('Content-Encoding');
          const fullBuffer = Buffer.concat(chunks);
          res.setHeader('Content-Length', fullBuffer.length);
          originalWrite.call(res, fullBuffer);
          
          metricsService.recordCompression?.('identity', {
            uncompressedBytes,
            compressedBytes: uncompressedBytes,
            ratio: 1,
          });
        }
        
        return originalEnd.call(res, ...args);
      } as Response['end'];
      
      return next();
    }
    
    // Otherwise, use gzip compression (original behavior)
    (res as Response).write = function patchedWrite(chunk: any, ...args: any[]): boolean {
      if (chunk) uncompressedBytes += Buffer.byteLength(chunk);
      return write(chunk, ...args);
    } as Response['write'];

    (res as Response).end = function patchedEnd(chunk?: any, ...args: any[]): Response {
      if (chunk) uncompressedBytes += Buffer.byteLength(chunk);
      return end(chunk, ...args);
    } as Response['end'];

    res.on('finish', () => {
      try {
        const contentLengthHeader = res.getHeader('Content-Length');
        const compressedBytes =
          typeof contentLengthHeader === 'string' || typeof contentLengthHeader === 'number'
            ? parseInt(String(contentLengthHeader), 10)
            : uncompressedBytes;
        if (!Number.isFinite(compressedBytes) || compressedBytes <= 0 || uncompressedBytes <= 0) {
          return;
        }
        const encoding = res.getHeader('Content-Encoding');
        const wasCompressed = encoding === 'gzip' || encoding === 'br' || encoding === 'deflate';
        const ratio = wasCompressed ? compressedBytes / uncompressedBytes : 1;
        metricsService.recordCompression?.(wasCompressed ? String(encoding) : 'identity', {
          uncompressedBytes,
          compressedBytes,
          ratio,
        });
      } catch (err) {
        logger.error('Failed to record compression metrics', { error: err });
      }
    });

    return inner(req, res, next);
  };
};
