import { createHash } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { BaseError, InternalServerError, isBaseError } from '../errors';
import { logger } from '../services/logger.service';
import { captureException } from '../services/telemetry.service';
import { HttpError } from '../utils/http-error';
import { getEnv } from '../config/env';
import { sanitizeData, sanitizeHeaders } from './request-logger.middleware';

/**
 * Groups repeated occurrences of "the same" error together for log
 * search/aggregation, independent of the per-request correlation ID
 * (which only ties together logs from a single request). IDs and
 * numbers in the message are normalized out first so e.g. "User 123 not
 * found" and "User 456 not found" produce the same fingerprint.
 */
const ID_LIKE_PATTERN = /[0-9a-fA-F-]{6,}|\d+/g;

const buildErrorFingerprint = (route: string, code: string, message: string): string => {
    const normalizedMessage = message.replace(ID_LIKE_PATTERN, '#');
    return createHash('sha1').update(`${code}:${route}:${normalizedMessage}`).digest('hex').slice(0, 12);
};

const normalizeError = (err: unknown): BaseError => {
    if (isBaseError(err)) {
        return err;
    }

    if (err instanceof HttpError) {
        return new BaseError(
            err.message,
            err.status,
            err.status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'HTTP_ERROR',
            {
                httpStatus: err.status
            },
            err.status < 500,
            err.status < 500
        );
    }

    return new InternalServerError();
};

export const errorHandler = (
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const normalizedError = normalizeError(err);
    const { isProductionLike } = getEnv();
    const requestId = req.requestId ?? 'unknown';
    const requestLogger = req.log ?? logger;
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    const rawMessage = err instanceof Error ? err.message : String(err);

    requestLogger.error('Unhandled request error', {
        requestId,
        correlationId: req.correlationId ?? requestId,
        method: req.method,
        path: req.originalUrl,
        route,
        query: sanitizeData(req.query || {}),
        headers: sanitizeHeaders(req.headers || {}),
        ip: req.ip,
        userAgent: req.get('user-agent'),
        user: req.user ? { id: req.user.id, role: req.user.role } : undefined,
        status: normalizedError.statusCode,
        errorCode: normalizedError.code,
        errorFingerprint: buildErrorFingerprint(route, normalizedError.code, rawMessage),
        message: rawMessage,
        stack: err instanceof Error ? err.stack : undefined,
        details: isBaseError(err) ? err.details : undefined
    });

    captureException(err, {
        requestId,
        path: req.originalUrl,
        method: req.method,
        statusCode: normalizedError.statusCode,
        errorCode: normalizedError.code
    });

    // Improve error messaging: expose more details for client debugging while protecting sensitive info
    const shouldMask = isProductionLike && (!normalizedError.isOperational || !normalizedError.expose);
    const message = shouldMask ? 'Internal Server Error' : normalizedError.message;
    const code = shouldMask ? 'INTERNAL_SERVER_ERROR' : normalizedError.code;
    
    const details = shouldMask ? undefined : normalizedError.details;

    res.status(normalizedError.statusCode).json({
        error: {
            code,
            message,
            details,
            status: normalizedError.statusCode,
            timestamp: new Date().toISOString(),
            requestId,
            hint: isProductionLike && !shouldMask ? 'Check request details and try again' : undefined
        }
    });
};
