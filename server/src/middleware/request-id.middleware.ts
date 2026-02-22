import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { logger } from '../services/logger.service';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const incomingRequestId = req.header('x-request-id');
    const requestId = incomingRequestId && incomingRequestId.trim() ? incomingRequestId : randomUUID();

    req.requestId = requestId;
    req.log = logger.child({ requestId });
    res.setHeader('x-request-id', requestId);

    const startTime = Date.now();

    req.log.info('Request started', {
        method: req.method,
        path: req.originalUrl,
        ip: req.ip
    });

    res.on('finish', () => {
        req.log.info('Request completed', {
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startTime
        });
    });

    next();
};
