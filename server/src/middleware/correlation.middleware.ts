/**
 * correlation.middleware.ts
 *
 * Ingress correlation-ID middleware.
 *
 * For every inbound HTTP request:
 *  1. Reads `X-Correlation-ID` or `traceparent` header; generates a
 *     UUIDv4 if neither is present.
 *  2. Binds the ID to the AsyncLocalStorage context so it flows through
 *     every downstream `await` / callback without manual passing.
 *  3. Attaches `req.correlationId` and a correlation-scoped child logger
 *     `req.log` for controller-level use.
 *  4. Echoes the ID back on the response as `X-Correlation-ID`.
 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../services/logger.service';
import { correlationStore } from '../services/correlation.service';

/** Header names accepted as incoming correlation carrier. */
const INCOMING_HEADERS = ['x-correlation-id', 'x-request-id', 'traceparent'] as const;

const extractIncoming = (req: Request): string | undefined => {
    for (const name of INCOMING_HEADERS) {
        const val = req.header(name);
        if (val?.trim()) return val.trim();
    }
    return undefined;
};

export const correlationMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const correlationId = extractIncoming(req) ?? randomUUID();

    // Echo back on response.
    res.setHeader('X-Correlation-ID', correlationId);

    // Attach to request object for backward compat with existing code that
    // already reads `req.requestId` / `req.log`.
    req.requestId = correlationId;
    req.correlationId = correlationId;
    req.log = logger.child({ correlation_id: correlationId });

    const startTime = Date.now();

    req.log.info('Request started', {
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
    });

    res.on('finish', () => {
        req.log.info('Request completed', {
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startTime,
        });
    });

    // Run the rest of the middleware / handler chain inside the async store
    // so getCorrelationId() returns the right value everywhere downstream.
    correlationStore.run({ correlationId }, next);
};
