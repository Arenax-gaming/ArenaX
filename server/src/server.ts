import dotenv from 'dotenv';
import path from 'node:path';
import os from 'node:os';
import express, { Express, Request, Response } from 'express';
import compression from 'compression';
import { createApp } from './app';
import { logger } from './services/logger.service';
import { createAdminService, getAdminService } from './services/admin.service';
import { initEnv } from './config/env';
import { initializeTelemetry } from './services/telemetry.service';
import { registerAchievementIntegration } from './services/achievement.service';
import { startHealthMonitor } from './services/health.service';
import { getDatabaseClient } from './services/database.service';

// ---------------------------------------------------------------------------
// 1. Load environment files in priority order before any other module reads
//    process.env. The NODE_ENV shell variable determines which file is loaded.
//
//    Priority (highest → lowest):
//      .env.<NODE_ENV>.local   machine-local overrides (git-ignored)
//      .env.<NODE_ENV>         environment-specific committed defaults
//      .env.local              cross-env local overrides (git-ignored)
//      .env                    base defaults
// ---------------------------------------------------------------------------
const nodeEnv = process.env.NODE_ENV ?? 'development';
const root = path.resolve(__dirname, '..');

// Load in reverse priority so higher-priority files win (dotenv skips already-
// set variables when `override` is false, which is the default).
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, `.env.${nodeEnv}`) });
dotenv.config({ path: path.join(root, `.env.${nodeEnv}.local`) });

// ---------------------------------------------------------------------------
// 2. Validate and freeze the environment. All code after this point should
//    import `getEnv()` rather than reading process.env directly.
// ---------------------------------------------------------------------------
const env = initEnv();
initializeTelemetry();
registerAchievementIntegration();

const app: Express = createApp();
const port = env.PORT;
const adminService = getAdminService();

let server: any;

app.get('/health', async (_req: Request, res: Response) => {
    try {
        const health = await adminService.getSystemHealth();
        res.json({
            status: health.status,
            timestamp: new Date().toISOString(),
            uptime: health.uptime,
            hostname: os.hostname(),
            service: 'arenax-server',
            version: process.env.npm_package_version ?? '0.1.0',
            metrics: {
                dbLatency: health.dbLatency,
                activeUsers: health.activeUsers,
                activeMatches: health.activeMatches,
                memoryUsagePercent: health.memoryUsage,
                diskUsagePercent: health.diskUsage
            }
        });
    } catch (error) {
        logger.error('Health check failed', { error });
        res.status(503).json({
            status: 'down',
            timestamp: new Date().toISOString(),
            error: 'Health check failed'
        });
    }
});

app.use(compression());

const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown`);

    if (!server) {
        logger.info('No server running, exiting');
        process.exit(0);
        return;
    }

    server.close((err: Error) => {
        if (err) {
            logger.error('Error during graceful shutdown', { error: err });
            process.exit(1);
        }

        logger.info('Graceful shutdown completed');
        process.exit(0);
    });
};

/** Probe the database with retries before accepting traffic. */
const waitForDatabase = async (
    maxAttempts = 10,
    delayMs = 1000
): Promise<void> => {
    const prisma = getDatabaseClient();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await prisma.$queryRaw`SELECT 1`;
            logger.info('Database ready', { attempt });
            return;
        } catch (err) {
            logger.warn('Database not ready, retrying…', { attempt, maxAttempts, error: err });
            if (attempt === maxAttempts) {
                throw new Error(`Database unavailable after ${maxAttempts} attempts`);
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
};

if (env.NODE_ENV !== 'test') {
    waitForDatabase()
        .then(() => {
            server = app.listen(port, () => {
                logger.info('Server started', {
                    url: `http://localhost:${port}`,
                    port,
                    environment: env.NODE_ENV
                });
            });

            startHealthMonitor({
                intervalMs: env.HEALTH_CHECK_INTERVAL_MS
            });
        })
        .catch((err) => {
            logger.error('Server failed to start — database not ready', { error: err });
            process.exit(1);
        });

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

export default server;
