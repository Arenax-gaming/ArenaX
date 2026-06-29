import dotenv from 'dotenv';
import path from 'node:path';
import os from 'node:os';
import express, { Express, Request, Response } from 'express';
import {
  createCompressionMiddleware,
  resolveCompressionConfigFromEnv,
} from './middleware/compression.middleware';
import { createApp } from './app';
import { logger } from './services/logger.service';
import { createAdminService, getAdminService } from './services/admin.service';
import { initEnv } from './config/env';
import { initializeTelemetry } from './services/telemetry.service';
import {
  initTracing,
  shutdownTracing,
  traceparentResponseMiddleware,
} from './services/tracing.service';
import { registerAchievementIntegration } from './services/achievement.service';
import { startHealthMonitor } from './services/health.service';
import { Server as SocketIOServer } from 'socket.io';
import { initGameSocket } from './websockets/game.socket';
import { MaintenanceService } from './services/maintenance.service';
import { getDatabaseClient, warmPool, startPoolHealthCheck, drainPool } from './services/database.service';
import eventMonitoringService from './services/event-monitoring.service';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const root = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, `.env.${nodeEnv}`) });
dotenv.config({ path: path.join(root, `.env.${nodeEnv}.local`) });

const env = initEnv();
// Tracing must initialise *before* createApp() so the OTel SDK can
// wrap the imported express/http modules before any routes are
// registered.
initTracing();
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
                diskUsagePercent: health.diskUsage,
                memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                eventMonitorRunning: eventMonitoringService.isRunning(),
                lastProcessedLedger: eventMonitoringService.getLastProcessedLedger(),
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

app.use(createCompressionMiddleware(resolveCompressionConfigFromEnv()));
app.use(traceparentResponseMiddleware());

let memoryWarningInterval: ReturnType<typeof setInterval> | null = null;

const startMemoryMonitor = (thresholdMB = 1500, intervalMs = 300000): void => {
    memoryWarningInterval = setInterval(() => {
        const mem = process.memoryUsage();
        const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        logger.debug('Memory usage', { heapMB, rssMB });
        if (heapMB > thresholdMB) {
            logger.warn('High memory usage detected', { heapMB, rssMB, thresholdMB });
        }
    }, intervalMs);
};

const stopMemoryMonitor = (): void => {
    if (memoryWarningInterval) {
        clearInterval(memoryWarningInterval);
        memoryWarningInterval = null;
    }
};

const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown`);

    stopMemoryMonitor();
    eventMonitoringService.stop();
    // Best-effort: flush in-flight spans before we exit.
    shutdownTracing().catch(() => {});

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

        drainPool().finally(() => {
            logger.info('Graceful shutdown completed');
            process.exit(0);
        });
    });

    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 30000).unref();
};

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
        .then(() => warmPool())
        .then(() => {
            startPoolHealthCheck({ healthCheckIntervalMs: env.HEALTH_CHECK_INTERVAL_MS });
            server = app.listen(port, () => {
                logger.info('Server started', {
                    url: `http://localhost:${port}`,
                    port,
                    environment: env.NODE_ENV
                });

                eventMonitoringService.configure({
                    intervalMs: 10_000,
                    maxLedgerBatch: 100,
                    contracts: (process.env.SOROBAN_CONTRACT_ADDRESSES ?? '').split(',').filter(Boolean),
                });
                eventMonitoringService.start().catch((err) => {
                    logger.error('Failed to start event monitoring', { error: err });
                });

                startMemoryMonitor();
            });

            const io = new SocketIOServer(server, {
                cors: {
                    origin: "*",
                    credentials: true
                }
            });
            initGameSocket(io);
            MaintenanceService.getInstance().setSocketServer(io);

            startHealthMonitor({ 
                intervalMs: env.HEALTH_CHECK_INTERVAL_MS 
            });
        });
    }

export default server;
