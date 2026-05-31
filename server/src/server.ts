import dotenv from 'dotenv';
import os from 'node:os';
import express, { Express, Request, Response } from 'express';
import compression from 'compression';
import { createApp } from './app';
import { logger } from './services/logger.service';
import { createAdminService } from './services/admin.service';
import { validateEnv } from './config/env';
import { initializeTelemetry } from './services/telemetry.service';
import { registerAchievementIntegration } from './services/achievement.service';
import { startHealthMonitor } from './services/health.service';
import { Server as SocketIOServer } from 'socket.io';
import { initGameSocket } from './websockets/game.socket';
import { MaintenanceService } from './services/maintenance.service';

dotenv.config();
const env = validateEnv();
initializeTelemetry();
registerAchievementIntegration();

const app: Express = createApp();
const port = env.PORT;
const adminService = createAdminService();

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

if (env.NODE_ENV !== 'test') {
    server = app.listen(port, () => {
        logger.info('Server started', { 
            url: `http://localhost:${port}`, 
            port, 
            environment: env.NODE_ENV 
        });
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

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

export default server;
