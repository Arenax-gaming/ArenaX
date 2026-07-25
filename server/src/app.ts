import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import passport from 'passport';
import Redis from 'ioredis';
import { configurePassport } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.middleware';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import { correlationMiddleware } from './middleware/correlation.middleware';
import { requestLogger } from './middleware/request-logger.middleware';
import { metricsMiddleware } from './middleware/metrics.middleware';
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
import { setupSwagger } from './openapi/swagger';
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
    app.get('/api/compression/metrics', async (_req: Request, res: Response) => {
        try {
            const { metricsService } = await import('./services/metrics.service');
            const metrics = await client.register.metrics();
            
            // Parse compression-specific metrics
            const compressionMetrics = {
                brotli: {
                    enabled: process.env.COMPRESSION_ENABLE_BROTLI !== 'false',
                    quality: parseInt(process.env.COMPRESSION_BROTLI_QUALITY || '4', 10),
                    mode: parseInt(process.env.COMPRESSION_BROTLI_MODE || '0', 10),
                },
                gzip: {
                    level: parseInt(process.env.COMPRESSION_LEVEL || '6', 10),
                },
                threshold: parseInt(process.env.COMPRESSION_THRESHOLD_BYTES || '1024', 10),
                stats: {
                    // These would be extracted from prom-client metrics in a real implementation
                    // For now, we return the raw Prometheus metrics
                },
                prometheusMetrics: metrics,
            };
            
            res.json(compressionMetrics);
        } catch (error) {
            logger.error('Failed to fetch compression metrics', { error });
            res.status(500).json({
                error: 'Failed to fetch compression metrics',
            });
        }
    });

    app.use(requestIdMiddleware);
    app.use(correlationMiddleware);
    app.use(requestLogger());
    app.use(passport.initialize());
    app.use(metricsMiddleware);
    app.use('/api', routes);

    const graphql = getGraphQLExecutor();
    graphql.mount(app);

    // Mount Swagger UI
    setupSwagger(app);

    app.use(errorHandler);

    return app;
};

export default createApp();
