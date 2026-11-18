/* Authorized Protocol Quality Assurance & Formal Verification Test Suite */

import { CorsOptions } from 'cors';
import { getEnv } from './env';
import { HttpError } from '../utils/http-error';

export const DEFAULT_PRODUCTION_ORIGINS = [
    'https://arenax.gg',
    'https://www.arenax.gg',
    'https://app.arenax.gg'
];

export const DEFAULT_STAGING_ORIGINS = [
    'https://staging.arenax.gg',
    'https://app-staging.arenax.gg',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
];

export const DEFAULT_DEVELOPMENT_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5173'
];

export const ALLOWED_METHODS = [
    'GET',
    'HEAD',
    'PUT',
    'PATCH',
    'POST',
    'DELETE',
    'OPTIONS'
];

export const ALLOWED_HEADERS = [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-ID',
    'X-Correlation-ID',
    'X-API-Version',
    'sentry-trace',
    'baggage',
    'Accept',
    'Origin'
];

export const EXPOSED_HEADERS = [
    'X-Request-ID',
    'X-Correlation-ID',
    'X-API-Version',
    'RateLimit-Limit',
    'RateLimit-Remaining',
    'RateLimit-Reset',
    'Retry-After'
];

/**
 * Resolves allowed origins based on environment and environment variables.
 *
 * Rules:
 * - Production: Strictly resolves origins configured in CORS_ALLOWED_ORIGINS
 *   (or ARENAX_ALLOWED_ORIGINS fallback, or DEFAULT_PRODUCTION_ORIGINS). Wildcards are disallowed.
 * - Staging: Includes configured origins plus staging domains and local development origins.
 * - Development/Test: Permits configured origins or broad local origins. Supports wildcard '*' if configured.
 */
export const resolveAllowedOrigins = (
    nodeEnv: string = process.env.NODE_ENV || 'development',
    rawConfiguredOrigins?: string
): string[] | '*' => {
    const isProduction = nodeEnv === 'production';
    const isStaging = nodeEnv === 'staging';

    const configured = rawConfiguredOrigins
        ? rawConfiguredOrigins
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean)
        : [];

    if (isProduction) {
        if (configured.length > 0) {
            // In production, reject wildcard '*' to prevent unauthorized cross-origin credential leaks
            const sanitized = configured.filter((o) => o !== '*');
            return sanitized.length > 0 ? sanitized : DEFAULT_PRODUCTION_ORIGINS;
        }
        return DEFAULT_PRODUCTION_ORIGINS;
    }

    if (isStaging) {
        if (configured.includes('*')) {
            return '*';
        }
        return Array.from(new Set([...configured, ...DEFAULT_STAGING_ORIGINS]));
    }

    // development / test
    if (configured.includes('*')) {
        return '*';
    }
    return Array.from(
        new Set([...configured, ...DEFAULT_DEVELOPMENT_ORIGINS, 'http://localhost:3000', 'http://localhost:5173'])
    );
};

/**
 * Validates whether an origin is allowed by the given allowed origins specification.
 */
export const isOriginPermitted = (
    origin: string | undefined,
    allowedOrigins: string[] | '*'
): boolean => {
    // Non-browser or same-origin requests (e.g. mobile app, curl, server-to-server)
    if (!origin) {
        return true;
    }

    if (allowedOrigins === '*') {
        return true;
    }

    return allowedOrigins.includes(origin);
};

/**
 * Builds cors middleware options conforming to environment requirements.
 */
export const getCorsOptions = (
    overrideEnv?: { nodeEnv?: string; corsOrigins?: string }
): CorsOptions => {
    let nodeEnv = overrideEnv?.nodeEnv;
    let configuredOrigins = overrideEnv?.corsOrigins;

    if (!nodeEnv || configuredOrigins === undefined) {
        try {
            const env = getEnv();
            nodeEnv = nodeEnv || env.NODE_ENV;
            configuredOrigins =
                configuredOrigins !== undefined
                    ? configuredOrigins
                    : (env.CORS_ALLOWED_ORIGINS || env.ARENAX_ALLOWED_ORIGINS);
        } catch {
            nodeEnv = nodeEnv || process.env.NODE_ENV || 'development';
            configuredOrigins =
                configuredOrigins !== undefined
                    ? configuredOrigins
                    : (process.env.CORS_ALLOWED_ORIGINS || process.env.ARENAX_ALLOWED_ORIGINS);
        }
    }

    const allowed = resolveAllowedOrigins(nodeEnv, configuredOrigins);

    return {
        origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
            if (isOriginPermitted(origin, allowed)) {
                callback(null, true);
                return;
            }

            callback(new HttpError(403, 'CORS policy: origin not allowed'));
        },
        methods: ALLOWED_METHODS,
        allowedHeaders: ALLOWED_HEADERS,
        exposedHeaders: EXPOSED_HEADERS,
        credentials: true,
        optionsSuccessStatus: 204,
        maxAge: 86400
    };
};
