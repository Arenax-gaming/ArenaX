import * as Sentry from '@sentry/node';
import { logger } from './logger.service';

const dsn = process.env.SENTRY_DSN;

export const isTelemetryEnabled = (): boolean => Boolean(dsn);

export const initializeTelemetry = (): void => {
    if (!isTelemetryEnabled()) {
        logger.info('Telemetry disabled: SENTRY_DSN is not configured');
        return;
    }

    Sentry.init({
        dsn,
        environment: process.env.NODE_ENV ?? 'development',
        release: process.env.APP_VERSION,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0')
    });

    logger.info('Telemetry initialized', {
        provider: 'sentry',
        environment: process.env.NODE_ENV ?? 'development'
    });
};

export const captureException = (
    error: unknown,
    context?: {
        requestId?: string;
        path?: string;
        method?: string;
        statusCode?: number;
        errorCode?: string;
    }
): void => {
    if (!isTelemetryEnabled()) {
        return;
    }

    Sentry.withScope((scope) => {
        if (context?.requestId) {
            scope.setTag('request_id', context.requestId);
        }
        if (context?.path) {
            scope.setTag('http.path', context.path);
        }
        if (context?.method) {
            scope.setTag('http.method', context.method);
        }
        if (context?.statusCode) {
            scope.setTag('http.status_code', String(context.statusCode));
        }
        if (context?.errorCode) {
            scope.setTag('error.code', context.errorCode);
        }

        Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
    });
};