import cors from 'cors';
import express, { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import passport from 'passport';
import Redis from 'ioredis';
import { configurePassport } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.middleware';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import { localeMiddleware } from './middleware/locale.middleware';
import { correlationMiddleware } from './middleware/correlation.middleware';
import { requestLogger } from './middleware/request-logger.middleware';
import { metricsMiddleware } from './middleware/metrics.middleware';
import { apiVersionMiddleware } from './middleware/api-version.middleware';
import { apiVersionRegistry } from './config/api-versions';
import routes from './routes/index';
import { getEnv } from './config/env';
import { getGraphQLExecutor } from './graphql/server';
import rateLimit from 'express-rate-limit';
import { MemoryStore } from 'express-rate-limit';
import { RedisRateLimitStore } from './middleware/rate-limit-redis.store';
import { FailoverStore } from './middleware/rate-limit-failover';
import { createRateLimitHealthCheck, registerRateLimitMetricsProvider, getRateLimitMetrics } from './middleware/rate-limit-monitoring';
import { initAdaptiveRateLimitRedis } from './middleware/adaptiveRateLimit.middleware';
import { RateLimitAnalytics } from './services/rate-limit-analytics.service';
import { isRateLimitRedisConnected, getRateLimitRedisClient } from './middleware/rate-limit.middleware';
import xss from 'xss-clean';
// @ts-ignore
import hpp from 'hpp';
import { setupSwagger, setupRedoc } from './openapi/swagger';
import { logger } from './services/logger.service';

const defaultArenaXOrigins = [
    'https://arenax.gg',
    'https://www.arenax.gg',
    'https://app.arenax.gg'
];

const buildAllowedOrigins = (isProductionLike: boolean): string[] => {
    const env = getEnv();
    const configuredOrigins = env.ARENAX_ALLOWED_ORIGINS
        ? env.ARENAX_ALLOWED_ORIGINS.split(',')
              .map((origin) => origin.trim())
              .filter(Boolean)
        : defaultArenaXOrigins;

    return isProductionLike
        ? configuredOrigins
        : [...configuredOrigins, 'http://localhost:3000', 'http://localhost:5173'];
};

export const createApp = (): Express => {
    const app: Express = express();
    const env = getEnv();
    const { isProductionLike } = env;
    const allowedOrigins = buildAllowedOrigins(isProductionLike);
    const cspConnectSources = [...new Set(["'self'", ...allowedOrigins])];

    configurePassport(passport);

    app.use(
        helmet({
            contentSecurityPolicy: {
                useDefaults: false,
                directives: {
                    defaultSrc: ["'self'"],
                    baseUri: ["'self'"],
                    fontSrc: ["'self'"],
                    formAction: ["'self'"],
                    frameAncestors: ["'none'"],
                    imgSrc: ["'self'", 'data:'],
                    objectSrc: ["'none'"],
                    scriptSrc: ["'self'"],
                    scriptSrcAttr: ["'none'"],
                    styleSrc: ["'self'"],
                    connectSrc: cspConnectSources,
                    upgradeInsecureRequests: isProductionLike ? [] : null
                }
            },
            hsts: {
                maxAge: 63072000,
                includeSubDomains: true,
                preload: true
            }
        })
    );
    app.use(
        cors({
            origin: (origin, callback) => {
                if (!origin || allowedOrigins.includes(origin)) {
                    callback(null, true);
                    return;
                }

                callback(new Error('CORS policy: origin not allowed'));
            },
            credentials: true
        })
    );
    app.use(express.json());

    // OWASP Top 10 Protections
    app.use(xss()); // Prevent XSS attacks
    app.use(hpp()); // Prevent HTTP Parameter Pollution

    // Global API rate limiter with Redis-backed store and in-memory failover
    const globalRateLimitWindowMs = 15 * 60 * 1000;
    const redis = getRateLimitRedisClient();
    let apiLimiterStore: any;
    if (redis) {
        const redisStore = new RedisRateLimitStore({
            redis,
            prefix: 'rl:global:',
            windowMs: globalRateLimitWindowMs,
        });
        const memoryStore = new MemoryStore();
        apiLimiterStore = new FailoverStore(redisStore, memoryStore, {
            healthCheckFn: async () => isRateLimitRedisConnected(),
        });
    }
    const apiLimiter = rateLimit({
        windowMs: globalRateLimitWindowMs,
        limit: 100,
        message: 'Too many requests from this IP, please try again after 15 minutes',
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        ...(apiLimiterStore ? { store: apiLimiterStore } : {}),
    });
    app.use('/api', apiLimiter);

    // Rate limit health check endpoint
    app.get('/api/rate-limit/health', async (_req: Request, res: Response) => {
        const connected = isRateLimitRedisConnected();
        const metrics = await getRateLimitMetrics();
        res.json({
            status: connected ? 'ok' : 'degraded',
            redis: connected ? 'connected' : 'fallback-to-memory',
            metrics,
        });
    });

    // Compression metrics endpoint
    app.get('/api/compression/metrics', (_req: Request, res: Response) => {
        res.json({
            brotli: {
                enabled: process.env.COMPRESSION_ENABLE_BROTLI !== 'false',
                quality: parseInt(process.env.COMPRESSION_BROTLI_QUALITY || '4', 10),
                mode: parseInt(process.env.COMPRESSION_BROTLI_MODE || '0', 10),
            },
            gzip: {
                level: parseInt(process.env.COMPRESSION_LEVEL || '6', 10),
            },
            threshold: parseInt(process.env.COMPRESSION_THRESHOLD_BYTES || '1024', 10),
        });
    });

    app.use(requestIdMiddleware);
    app.use(correlationMiddleware);
    app.use(requestLogger());
    app.use(localeMiddleware);
    app.use(passport.initialize());
    app.use(metricsMiddleware);

    // Resolves the requested API version from the URL (`/api/v1/...`) or
    // `Accept` header, attaches it to `res.locals.apiVersion`, and sets
    // RFC 8594 Deprecation/Sunset headers once a version is deprecated.
    app.use(apiVersionMiddleware(apiVersionRegistry));
    app.use((req: Request, res: Response, next: NextFunction) => {
        const apiVersion = (res.locals as { apiVersion?: { name: string } }).apiVersion;
        if (apiVersion) res.setHeader('X-API-Version', apiVersion.name);
        next();
    });

    app.use('/api', routes);

    const graphql = getGraphQLExecutor();
    graphql.mount(app);

    // Mount Swagger UI
    setupSwagger(app);

    // Mount Redoc
    setupRedoc(app);

    app.use(errorHandler);

    return app;
};

export default createApp();
