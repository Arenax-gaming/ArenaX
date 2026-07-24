import type { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.service';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'proxy-authorization',
  'x-auth-token',
  'api-key',
]);

const SENSITIVE_FIELDS = new Set([
  'password',
  'pass',
  'newpassword',
  'currentpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'secretkey',
  'privatekey',
  'creditcard',
  'cardnumber',
  'cvv',
  'ssn',
  'verificationtoken',
  'resettoken',
]);

/**
 * Recursively redacts sensitive values from an object, array, or string.
 */
export function sanitizeData(data: any): any {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeData(item));
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_FIELDS.has(lowerKey)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeData(val);
      }
    }
    return sanitized;
  }

  return data;
}

/**
 * Redacts sensitive headers.
 */
export function sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, val] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

export interface RequestLoggerOptions {
  debugEndpoints?: string[];
  skipEndpoints?: string[];
}

const DEFAULT_DEBUG_ENDPOINTS = ['/health', '/metrics', '/api/rate-limit/health'];

/**
 * Express middleware that logs structured request and response details,
 * tracking execution duration, response payload size, and masking sensitive data.
 */
export function requestLogger(options: RequestLoggerOptions = {}) {
  const debugEndpoints = new Set(options.debugEndpoints ?? DEFAULT_DEBUG_ENDPOINTS);
  const skipEndpoints = new Set(options.skipEndpoints ?? []);

  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    const path = req.path || req.originalUrl || '';

    if (skipEndpoints.has(path)) {
      return next();
    }

    const correlationId = (req as any).correlationId || (req as any).requestId || req.header('x-correlation-id');
    const isDebugPath = debugEndpoints.has(path);
    const sanitizedQueryParams = sanitizeData(req.query || {});
    const sanitizedHeaders = sanitizeHeaders(req.headers || {});
    const sanitizedBody = req.body ? sanitizeData(req.body) : undefined;

    // Log incoming request
    const incomingLevel = isDebugPath ? 'debug' : 'info';
    logger.log(incomingLevel, `Incoming ${req.method} ${req.originalUrl || req.url}`, {
      correlation_id: correlationId,
      httpMethod: req.method,
      endpoint: path,
      url: req.originalUrl || req.url,
      queryParameters: sanitizedQueryParams,
      headers: sanitizedHeaders,
      body: sanitizedBody,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    let payloadSizeBytes = 0;

    // Intercept res.write and res.end to calculate payload size
    const originalWrite = res.write;
    const originalEnd = res.end;

    res.write = function (chunk: any, ...args: any[]): boolean {
      if (chunk) {
        payloadSizeBytes += Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(String(chunk));
      }
      return originalWrite.apply(res, [chunk, ...args] as any);
    };

    res.end = function (chunk?: any, ...args: any[]): Response {
      if (chunk) {
        payloadSizeBytes += Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(String(chunk));
      }
      return originalEnd.apply(res, [chunk, ...args] as any);
    };

    res.on('finish', () => {
      const responseTimeMs = Date.now() - startTime;
      const contentLengthHeader = res.getHeader('content-length');
      const finalPayloadSize = contentLengthHeader
        ? parseInt(String(contentLengthHeader), 10) || payloadSizeBytes
        : payloadSizeBytes;

      let logLevel = isDebugPath ? 'debug' : 'info';
      if (res.statusCode >= 500) {
        logLevel = 'error';
      } else if (res.statusCode >= 400) {
        logLevel = 'warn';
      }

      logger.log(logLevel, `Outgoing ${req.method} ${req.originalUrl || req.url} ${res.statusCode}`, {
        correlation_id: correlationId,
        httpMethod: req.method,
        endpoint: path,
        url: req.originalUrl || req.url,
        statusCode: res.statusCode,
        responseTimeMs,
        payloadSizeBytes: finalPayloadSize,
        metrics: {
          latencyMs: responseTimeMs,
          throughputBytes: finalPayloadSize,
        },
      });
    });

    next();
  };
}
