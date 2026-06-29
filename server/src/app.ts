import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import passport from 'passport';
import { configurePassport } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.middleware';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import { correlationMiddleware } from './middleware/correlation.middleware';
import { metricsMiddleware } from './middleware/metrics.middleware';
import routes from './routes/index';
import { getEnv } from './config/env';
import { getGraphQLExecutor } from './graphql/server';
import rateLimit from 'express-rate-limit';
import xss from 'xss-clean';
import hpp from 'hpp';
import { setupSwagger } from './openapi/swagger';

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

    const apiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 100,
        message: 'Too many requests from this IP, please try again after 15 minutes',
        standardHeaders: 'draft-7',
        legacyHeaders: false,
    });
    app.use('/api', apiLimiter);

    app.use(requestIdMiddleware);
    app.use(correlationMiddleware);
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
