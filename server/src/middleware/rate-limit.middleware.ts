import rateLimit, { MemoryStore, Store } from 'express-rate-limit';
import { Request, Response } from 'express';
import Redis from 'ioredis';
import { SlidingWindowRateLimitStore } from './sliding-window-rate-limit.store';
import { FailoverStore } from './rate-limit-failover';
import { logger } from '../services/logger.service';

// ---------------------------------------------------------------------------
// Redis connection for rate limiting (lazy singleton)
// ---------------------------------------------------------------------------

let _rateLimitRedis: Redis | null = null;
let _redisConnected = false;

function getRateLimitRedis(): Redis | null {
    if (_rateLimitRedis) return _rateLimitRedis;

    const url = process.env.REDIS_URL;
    if (!url) {
        logger.info('REDIS_URL not set — using in-memory rate limit store');
        return null;
    }

    try {
        _rateLimitRedis = new Redis(url, {
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
            lazyConnect: true,
            keyPrefix: '',
        });

        _rateLimitRedis.on('ready', () => {
            _redisConnected = true;
            logger.info('Redis rate limit store connected');
        });

        _rateLimitRedis.on('error', (err) => {
            _redisConnected = false;
            logger.warn('Redis rate limit error — using in-memory fallback', { error: err.message });
        });

        _rateLimitRedis.on('close', () => {
            _redisConnected = false;
        });

        _rateLimitRedis.connect().catch(() => {});
        return _rateLimitRedis;
    } catch (error) {
        logger.warn('Failed to create Redis rate limit connection', { error });
        return null;
    }
}

function createRateLimitStore(windowMs: number, prefix: string): Store {
    const redis = getRateLimitRedis();
    if (!redis) {
        // No Redis configured: fall back to express-rate-limit's in-process
        // fixed-window MemoryStore. Sliding-window accuracy requires the
        // shared Redis counters below.
        return new MemoryStore();
    }

    const redisStore = new SlidingWindowRateLimitStore({ redis, prefix, windowMs });
    const memoryStore = new MemoryStore();

    return new FailoverStore(redisStore, memoryStore, {
        healthCheckFn: async () => _redisConnected,
    }) as unknown as Store;
}

// ---------------------------------------------------------------------------
// Trusted IPs / accounts (unchanged)
// ---------------------------------------------------------------------------

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

const shouldSkipRateLimit = (req: Request): boolean => {
    if (req.ip && trustedIps.includes(req.ip)) return true;
    if (req.user && trustedAccounts.includes(req.user.id)) return true;
    if (req.user && req.user.role === 'ADMIN') return true;
    return false;
};

// ---------------------------------------------------------------------------
// Tiered rate limiters (Redis-backed with failover)
// ---------------------------------------------------------------------------

// 1. Auth: Strict (Prevent brute force)
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: shouldSkipRateLimit,
    store: createRateLimitStore(15 * 60 * 1000, 'rl:auth:'),
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
    windowMs: 1 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: shouldSkipRateLimit,
    store: createRateLimitStore(60_000, 'rl:payment:'),
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
    store: createRateLimitStore(60_000, 'rl:admin:'),
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
    store: createRateLimitStore(60_000, 'rl:public:'),
    message: {
        error: 'Global rate limit exceeded.',
        code: 'GLOBAL_RATE_LIMIT_EXCEEDED',
        retryAfter: 60
    }
});

// 5. API Key based rate limiter for public API endpoints
export const apiKeyRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 1000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req: Request) => {
        if (shouldSkipRateLimit(req)) return true;
        return !req.headers['x-api-key'];
    },
    store: createRateLimitStore(60_000, 'rl:apikey:'),
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

// ---------------------------------------------------------------------------
// Exports for monitoring
// ---------------------------------------------------------------------------

export function isRateLimitRedisConnected(): boolean {
    return _redisConnected;
}

export function getRateLimitRedisClient(): Redis | null {
    return _rateLimitRedis;
}
