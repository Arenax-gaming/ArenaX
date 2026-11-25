import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { getCorrelationId } from './correlation.service';

// Logger is initialised before initEnv() runs (it is imported by env.ts
// indirectly), so we fall back to process.env directly here. All other
// services should use getEnv() instead.
const logDirectory =
    process.env.LOG_DIR ?? path.resolve(process.cwd(), 'logs');
const logLevel = process.env.LOG_LEVEL ?? 'info';
const maxSize = process.env.LOG_MAX_SIZE ?? '20m';
const maxFiles = process.env.LOG_MAX_FILES ?? '14d';

if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory, { recursive: true });
}

/**
 * Winston format that injects the active `correlation_id` from the
 * AsyncLocalStorage context into every structured log entry.
 * Falls back gracefully when called outside a request context.
 */
const correlationFormat = winston.format((info) => {
    const id = getCorrelationId();
    if (id) info.correlation_id = id;
    return info;
});

const baseFormat = winston.format.combine(
    correlationFormat(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

const transports: winston.transport[] = [
    new winston.transports.Console({
        level: logLevel,
        format: winston.format.combine(
            correlationFormat(),
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.printf(({ level, message, timestamp, correlation_id, ...metadata }) => {
                const cid = correlation_id ? ` [${correlation_id}]` : '';
                const metadataPayload =
                    Object.keys(metadata).length > 0
                        ? ` ${JSON.stringify(metadata)}`
                        : '';
                return `${timestamp} ${level}${cid}: ${message}${metadataPayload}`;
            })
        )
    }),
    new DailyRotateFile({
        dirname: logDirectory,
        filename: 'application-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize,
        maxFiles,
        level: 'info',
        format: baseFormat
    }),
    new DailyRotateFile({
        dirname: logDirectory,
        filename: 'error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize,
        maxFiles,
        level: 'error',
        format: baseFormat
    })
];

export const logger = winston.createLogger({
    level: logLevel,
    format: baseFormat,
    defaultMeta: {
        service: 'arenax-server',
        environment: process.env.NODE_ENV ?? 'development'
    },
    transports
});

export const SLOW_QUERY_WARN_MS = 100;
export const SLOW_QUERY_ERROR_MS = 500;

/**
 * Logs a Prisma query whose duration exceeded the slow-query threshold.
 * Queries over 500ms are logged at `error`; queries over 100ms at `warn`.
 * The correlation_id is injected automatically by `correlationFormat`.
 */
export function logSlowQuery(params: {
    model: string;
    operation: string;
    durationMs: number;
}): void {
    const level = params.durationMs > SLOW_QUERY_ERROR_MS ? 'error' : 'warn';
    logger.log(level, 'Slow query detected', {
        model: params.model,
        operation: params.operation,
        duration_ms: params.durationMs
    });
}
