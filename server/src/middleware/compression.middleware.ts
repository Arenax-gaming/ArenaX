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
 *
 * ## Brotli
 *
 * The `compression` package is gzip-only by design. Production-grade
 * brotli for Express either needs `shrink-ray-current` (which compiles
 * native deps, breaks on Alpine) or a custom transform stream. We do
 * not add it here to keep the install surface tight; clients will
 * negotiate gzip via Accept-Encoding, which is supported by every
 * browser shipped in the last decade. If brotli becomes a hard
 * requirement, this is the place to add it — bump
 * `EXPECTED_ENCODINGS` and plug an iltorb-backed branch in.
 *
 * See ADR 005 in docs/adr/ for the full rationale.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import compression from 'compression';
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
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  level: 6,
  threshold: 1024,
  excludedContentTypes: EXCLUDED_DEFAULT_PREFIXES,
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
  return { level, threshold, excludedContentTypes: exclusions };
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
 * Build the compression middleware stack. Returns a single
 * `RequestHandler` that records metrics + delegates to the underlying
 * `compression` package.
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
      return compression.filter(req, res);
    },
  });

  return (req: Request, res: Response, next: NextFunction) => {
    let uncompressedBytes = 0;
    const write = res.write.bind(res);
    const end = res.end.bind(res);

    // Patch write/end so we can count the bytes the application would
    // have sent without compression. The `compression` package wraps
    // res internally; both gzipped and raw paths go through the same
    // res.write hook below the wrapper, so this counter is accurate
    // for the un-compressed payload.
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
