import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const logDirectory = process.env.LOG_DIR ?? path.resolve(process.cwd(), 'logs');
const logLevel = process.env.LOG_LEVEL ?? 'info';
const maxSize = process.env.LOG_MAX_SIZE ?? '20m';
const maxFiles = process.env.LOG_MAX_FILES ?? '14d';

if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory, { recursive: true });
}

const baseFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

const transports: winston.transport[] = [
    new winston.transports.Console({
        level: logLevel,
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.printf(({ level, message, timestamp, ...metadata }) => {
                const metadataPayload = Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : '';
                return `${timestamp} ${level}: ${message}${metadataPayload}`;
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
        service: 'arenax-server'
    },
    transports
});
