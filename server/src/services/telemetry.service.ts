import * as Sentry from '@sentry/node';
import { logger } from './logger.service';
import { getEnv } from '../config/env';

export const isTelemetryEnabled = (): boolean => {
    try {
        return Boolean(getEnv().SENTRY_DSN);
    } catch {
        // getEnv() throws before initEnv() is called (e.g. in unit tests).
        return Boolean(process.env.SENTRY_DSN);
    }
};

export const initializeTelemetry = (): void => {
    const env = getEnv();

    if (!env.SENTRY_DSN) {
        logger.info('Telemetry disabled: SENTRY_DSN is not configured');
        return;
    }

    Sentry.init({
        // @ts-expect-error - dsn is valid but types are outdated
        dsn: env.SENTRY_DSN,
        environment: env.NODE_ENV,
        release: env.APP_VERSION,
        tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    });

    logger.info('Telemetry initialized', {
        provider: 'sentry',
        environment: env.NODE_ENV,
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

    Sentry.withScope((scope: any) => {
        if (context?.requestId) scope.setTag('request_id', context.requestId);
        if (context?.path) scope.setTag('http.path', context.path);
        if (context?.method) scope.setTag('http.method', context.method);
        if (context?.statusCode)
            scope.setTag('http.status_code', String(context.statusCode));
        if (context?.errorCode) scope.setTag('error.code', context.errorCode);

        Sentry.captureException(
            error instanceof Error ? error : new Error(String(error))
        );
    });
};
