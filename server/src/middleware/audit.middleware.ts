import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to enrich the request with audit-related metadata.
 */
export const auditMiddleware = (req: Request, _res: Response, next: NextFunction) => {
    // Audit context can be used by controllers to simplify logAction calls
    req.auditContext = {
        requestId: req.requestId || 'unknown',
        ipAddress: req.ip,
        userAgent: req.header('user-agent') || 'unknown'
    };
    next();
};

declare global {
    namespace Express {
        interface Request {
            auditContext?: {
                requestId: string;
                ipAddress: string;
                userAgent: string;
            };
        }
    }
}
