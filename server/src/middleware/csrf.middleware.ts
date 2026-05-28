import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * CSRF Protection Middleware
 * Generates and validates CSRF tokens for state-changing operations
 */

declare global {
    namespace Express {
        interface Request {
            sessionId?: string;
        }
    }
}

const CSRF_TOKEN_LENGTH = 32;
const CSRF_HEADER_NAME = 'x-csrf-token';

// Store CSRF tokens in memory (in production, use Redis)
const csrfTokens = new Map<string, { token: string; expiresAt: number }>();

// Clean up expired tokens every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of csrfTokens.entries()) {
        if (value.expiresAt < now) {
            csrfTokens.delete(key);
        }
    }
}, 5 * 60 * 1000);

/**
 * Generate a CSRF token for a session
 */
export const generateCsrfToken = (sessionId: string): string => {
    const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    
    csrfTokens.set(sessionId, { token, expiresAt });
    
    return token;
};

/**
 * Validate a CSRF token
 */
export const validateCsrfToken = (sessionId: string, token: string): boolean => {
    const stored = csrfTokens.get(sessionId);
    
    if (!stored) {
        return false;
    }
    
    if (stored.expiresAt < Date.now()) {
        csrfTokens.delete(sessionId);
        return false;
    }
    
    // Use constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
        Buffer.from(stored.token, 'hex'),
        Buffer.from(token, 'hex')
    );
};

/**
 * Middleware to require CSRF token for state-changing operations
 */
export const requireCsrfToken = (req: Request, res: Response, next: NextFunction): void => {
    // Skip CSRF for GET, HEAD, OPTIONS requests
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    
    const sessionId = req.sessionId || req.requestId || 'unknown';
    const csrfToken = req.header(CSRF_HEADER_NAME) || req.body._csrf;
    
    if (!csrfToken) {
        res.status(403).json({
            error: {
                code: 'CSRF_TOKEN_MISSING',
                message: 'CSRF token is required for this operation',
                status: 403
            }
        });
        return;
    }
    
    if (!validateCsrfToken(sessionId, csrfToken)) {
        res.status(403).json({
            error: {
                code: 'CSRF_TOKEN_INVALID',
                message: 'Invalid or expired CSRF token',
                status: 403
            }
        });
        return;
    }
    
    next();
};

/**
 * Middleware to add CSRF token to response headers
 */
export const addCsrfToken = (req: Request, res: Response, next: NextFunction): void => {
    const sessionId = req.sessionId || req.requestId || crypto.randomUUID();
    const token = generateCsrfToken(sessionId);
    
    res.setHeader('x-csrf-token', token);
    res.locals.csrfToken = token;
    
    next();
};

/**
 * Revoke a CSRF token
 */
export const revokeCsrfToken = (sessionId: string): void => {
    csrfTokens.delete(sessionId);
};
