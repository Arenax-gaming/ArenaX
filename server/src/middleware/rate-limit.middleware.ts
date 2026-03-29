import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * Tiered rate limiting middleware based on endpoint risk.
 */

// 1. Auth: Strict (Prevent brute force)
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 5, // 5 requests per window
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' },
    keyGenerator: (req: Request) => {
        return `${req.ip}-${req.body.username || req.body.email || 'anon'}`;
    }
});

// 2. Payments: Medium with burst control
export const paymentRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Payment processing rate limit exceeded. Please wait a moment.' }
});

// 3. Admin: Protective
export const adminRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Admin API rate limit exceeded.' }
});

// 4. Public Reads: Relaxed
export const publicRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Global rate limit exceeded.' }
});
