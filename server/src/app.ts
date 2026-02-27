import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import passport from 'passport';
import routes from './routes/index';
import { configurePassport } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.middleware';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import { logger } from './services/logger.service';
import { initializeTelemetry } from './services/telemetry.service';

import Redis from "ioredis";
import { MatchMakingWorker } from './workers/matchmaking.worker';
import {ReaperWorker} from "./workers/reaper.worker";

const redis = new Redis();


dotenv.config();
initializeTelemetry();

const app: Express = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const defaultArenaXOrigins = [
    'https://arenax.gg',
    'https://www.arenax.gg',
    'https://app.arenax.gg'
];

const configuredOrigins = process.env.ARENAX_ALLOWED_ORIGINS
    ? process.env.ARENAX_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : defaultArenaXOrigins;

const allowedOrigins = isProduction
    ? configuredOrigins
    : [...configuredOrigins, 'http://localhost:3000', 'http://localhost:5173'];

const cspConnectSources = [...new Set(["'self'", ...allowedOrigins])];

// Middleware
app.use(helmet({
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
}));
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) {
            callback(null, true);
            return;
        }

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error('CORS policy: origin not allowed'));
    },
    credentials: true
}));
app.use(express.json());
app.use(requestIdMiddleware);
app.use(passport.initialize());

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
    logger.info('Server started', { url: `http://localhost:${port}` });
});

new MatchMakingWorker(redis).start();
new ReaperWorker().start();

export default app;
