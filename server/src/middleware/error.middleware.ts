import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.service';

export const errorHandler = (
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const requestLogger = req.log ?? logger;
    requestLogger.error('Unhandled request error', {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        status: err.status || 500,
        message: err.message,
        stack: err.stack
    });

    const status = err.status || 500;
    const message = err.message || 'Internal Server Error';

    res.status(status).json({
        error: {
            message,
            status,
            timestamp: new Date().toISOString(),
            requestId: req.requestId
        }
    });
};
