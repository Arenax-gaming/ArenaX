import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * Parse trusted IPs and accounts from environment variables
 */
const getTrustedIps = (): string[] => {
    const envIps = process.env.RATE_LIMIT_TRUSTED_IPS;
    if (!envIps) return [];
    return envIps.split(',').map(ip => ip.trim()).filter(Boolean);
};

const getTrustedAccounts = (): string[] => {
    const envAccounts = process.env.RATE_LIMIT_TRUSTED_ACCOUNTS;
    if (!envAccounts) return [];
    return envAccounts.split(',').map(acc => acc.trim()).filter(Boolean);
};

const trustedIps = getTrustedIps();
const trustedAccounts = getTrustedAccounts();

/**
 * Check if request should skip rate limiting
 */
const shouldSkipRateLimit = (req: Request): boolean => {
    // Skip if IP is in trusted list
    if (req.ip && trustedIps.includes(req.ip)) {
        return true;
    }

    // Skip if user account is in trusted list
    if (req.user && trustedAccounts.includes(req.user.id)) {
        return true;
    }

    // Skip if user is admin
    if (req.user && req.user.role === 'ADMIN') {
        return true;
    }

    return false;
};

/**
 * Tiered rate limiting middleware based on endpoint risk.
 */

// 1. Auth: Strict (Prevent brute force)
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 5, // 5 requests per window
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: shouldSkipRateLimit,
    message: { 
        error: 'Too many authentication attempts. Please try again after 15 minutes.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: 900
    },
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
    skip: shouldSkipRateLimit,
    message: { 
        error: 'Payment processing rate limit exceeded. Please wait a moment.',
        code: 'PAYMENT_RATE_LIMIT_EXCEEDED',
        retryAfter: 60
    }
});

// 3. Admin: Protective
export const adminRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: shouldSkipRateLimit,
    message: { 
        error: 'Admin API rate limit exceeded.',
        code: 'ADMIN_RATE_LIMIT_EXCEEDED',
        retryAfter: 60
    }
});

// 4. Public Reads: Relaxed
export const publicRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: shouldSkipRateLimit,
    message: { 
        error: 'Global rate limit exceeded.',
        code: 'GLOBAL_RATE_LIMIT_EXCEEDED',
        retryAfter: 60
    }
});

// 5. API Key based rate limiter for public API endpoints
export const apiKeyRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 1000, // Higher limit for API key users
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req: Request) => {
        // Skip if trusted
        if (shouldSkipRateLimit(req)) return true;
        // Apply stricter limits if no API key
        return !req.headers['x-api-key'];
    },
    keyGenerator: (req: Request) => {
        const apiKey = req.headers['x-api-key'] as string;
        return apiKey ? `api-${apiKey}` : (req.ip || 'unknown');
    },
    message: { 
        error: 'API rate limit exceeded.',
        code: 'API_RATE_LIMIT_EXCEEDED',
        retryAfter: 60
    }
});
