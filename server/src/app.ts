import cors from 'cors';
import dotenv from 'dotenv';
import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import passport from 'passport';
import { createServer as createHttpServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { configurePassport } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.middleware';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import routes from './routes/index';
import { registerAchievementIntegration } from './services/achievement.service';
import { logger } from './services/logger.service';
import { initializeTelemetry } from './services/telemetry.service';
import { setupMatchmakingWebSocket } from './websockets/matchmaking.socket';

dotenv.config();
initializeTelemetry();
registerAchievementIntegration();

const defaultArenaXOrigins = [
    'https://arenax.gg',
    'https://www.arenax.gg',
    'https://app.arenax.gg'
];

const buildAllowedOrigins = (isProduction: boolean): string[] => {
    const configuredOrigins = process.env.ARENAX_ALLOWED_ORIGINS
        ? process.env.ARENAX_ALLOWED_ORIGINS.split(',')
              .map((origin) => origin.trim())
              .filter(Boolean)
        : defaultArenaXOrigins;

    return isProduction
        ? configuredOrigins
        : [...configuredOrigins, 'http://localhost:3000', 'http://localhost:5173'];
};

// Build allowed origins for use in Socket.IO
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = buildAllowedOrigins(isProduction);

export const createApp = (): Express => {
    const app: Express = express();
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
                    upgradeInsecureRequests: isProduction ? [] : null
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
    app.use(requestIdMiddleware);
    app.use(passport.initialize());

    app.use('/api', routes);

    app.get('/health', (_req: Request, res: Response) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.use(errorHandler);

    return app;
};

const app = createApp();

if (process.env.NODE_ENV !== 'test') {
    const port = process.env.PORT || 3000;
    
    // Create HTTP server
    const httpServer = createHttpServer(app);
    
    // Initialize Socket.IO
    const io = new SocketIOServer(httpServer, {
        cors: {
            origin: (origin, callback) => {
                if (!origin || allowedOrigins.includes(origin)) {
                    callback(null, true);
                    return;
                }
                callback(new Error('CORS policy: origin not allowed'));
            },
            credentials: true
        },
        path: '/socket.io',
        pingTimeout: 60000,
        pingInterval: 25000
    });
    
    // Setup matchmaking WebSocket handlers
    setupMatchmakingWebSocket(io);
    
    // Store io instance for use in controllers
    (app as any).io = io;
    
    httpServer.listen(port, () => {
        logger.info('Server started', { url: `http://localhost:${port}` });
    });
}

export default app;
