import { Request, Response, NextFunction } from 'express';
import { BaseError, InternalServerError, isBaseError } from '../errors';
import { logger } from '../services/logger.service';
import { captureException } from '../services/telemetry.service';

export const errorHandler = (
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const normalizedError: BaseError = isBaseError(err) ? err : new InternalServerError();
    const isProduction = process.env.NODE_ENV === 'production';
    const requestId = req.requestId ?? 'unknown';
    const requestLogger = req.log ?? logger;

    requestLogger.error('Unhandled request error', {
        requestId,
        method: req.method,
        path: req.originalUrl,
        status: normalizedError.statusCode,
        errorCode: normalizedError.code,
        message: err instanceof Error ? err.message : String(err),
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

    const shouldMask = isProduction && (!normalizedError.isOperational || !normalizedError.expose);
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
            requestId
        }
    });
};
