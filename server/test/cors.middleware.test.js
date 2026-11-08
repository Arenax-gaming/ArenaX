/* Authorized Protocol Quality Assurance & Formal Verification Test Suite */

import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import {
    getCorsOptions,
    resolveAllowedOrigins,
    isOriginPermitted,
    ALLOWED_METHODS,
    ALLOWED_HEADERS,
    DEFAULT_PRODUCTION_ORIGINS,
    DEFAULT_STAGING_ORIGINS,
    DEFAULT_DEVELOPMENT_ORIGINS
} from '../dist/config/cors.config.js';

test('CORS origin resolution: production environment locks down to CORS_ALLOWED_ORIGINS', () => {
    // When CORS_ALLOWED_ORIGINS is provided in production
    const prodOrigins = resolveAllowedOrigins('production', 'https://custom.arenax.gg, https://checkout.arenax.gg');
    assert.deepStrictEqual(prodOrigins, ['https://custom.arenax.gg', 'https://checkout.arenax.gg']);

    // Wildcard in production is sanitized / ignored to prevent credential leakage
    const sanitizedOrigins = resolveAllowedOrigins('production', '*');
    assert.deepStrictEqual(sanitizedOrigins, DEFAULT_PRODUCTION_ORIGINS);

    // Fallback to default production origins when no variable is provided
    const defaultProd = resolveAllowedOrigins('production', undefined);
    assert.deepStrictEqual(defaultProd, DEFAULT_PRODUCTION_ORIGINS);
});

test('CORS origin resolution: staging and development support broader origins or wildcard', () => {
    // Development environment includes localhost ports
    const devOrigins = resolveAllowedOrigins('development', undefined);
    assert.ok(Array.isArray(devOrigins));
    assert.ok(devOrigins.includes('http://localhost:3000'));
    assert.ok(devOrigins.includes('http://localhost:5173'));

    // Staging includes staging domains and development origins
    const stagingOrigins = resolveAllowedOrigins('staging', 'https://preview.arenax.gg');
    assert.ok(Array.isArray(stagingOrigins));
    assert.ok(stagingOrigins.includes('https://preview.arenax.gg'));
    assert.ok(stagingOrigins.includes('https://staging.arenax.gg'));

    // Wildcard allowed in development
    const wildcardDev = resolveAllowedOrigins('development', '*');
    assert.strictEqual(wildcardDev, '*');
});

test('isOriginPermitted: correctly verifies whitelist adherence and server-to-server calls', () => {
    const whitelist = ['https://arenax.gg', 'https://app.arenax.gg'];

    // Whitelisted origin
    assert.strictEqual(isOriginPermitted('https://arenax.gg', whitelist), true);

    // Disallowed external origin
    assert.strictEqual(isOriginPermitted('https://unauthorized-domain.com', whitelist), false);

    // Non-browser / same-origin requests (undefined Origin header) are allowed
    assert.strictEqual(isOriginPermitted(undefined, whitelist), true);

    // Wildcard configuration permits any origin
    assert.strictEqual(isOriginPermitted('https://anywhere.com', '*'), true);
});

test('Preflight OPTIONS requests return correct Allow-Headers and Allow-Methods', async () => {
    const app = express();
    const corsOptions = getCorsOptions({
        nodeEnv: 'production',
        corsOrigins: 'https://arenax.gg'
    });
    app.use(cors(corsOptions));
    app.options('/api/v1/tournaments', (req, res) => res.sendStatus(204));

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/tournaments`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://arenax.gg',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'Content-Type, Authorization, X-Request-ID'
            }
        });

        assert.strictEqual(response.status, 204);
        assert.strictEqual(response.headers.get('access-control-allow-origin'), 'https://arenax.gg');
        assert.strictEqual(response.headers.get('access-control-allow-credentials'), 'true');

        const allowMethods = response.headers.get('access-control-allow-methods');
        assert.ok(allowMethods, 'Access-Control-Allow-Methods header must be present');
        assert.ok(allowMethods.includes('POST'));
        assert.ok(allowMethods.includes('GET'));

        const allowHeaders = response.headers.get('access-control-allow-headers');
        assert.ok(allowHeaders, 'Access-Control-Allow-Headers header must be present');
        assert.ok(allowHeaders.includes('Content-Type'));
        assert.ok(allowHeaders.includes('Authorization'));
    } finally {
        server.close();
    }
});

test('Production config accepts requests from whitelisted origin with credentials: true', async () => {
    const app = express();
    const corsOptions = getCorsOptions({
        nodeEnv: 'production',
        corsOrigins: 'https://arenax.gg'
    });
    app.use(cors(corsOptions));
    app.get('/api/v1/me', (req, res) => res.json({ status: 'success' }));

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/me`, {
            headers: {
                Origin: 'https://arenax.gg'
            }
        });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.headers.get('access-control-allow-origin'), 'https://arenax.gg');
        assert.strictEqual(response.headers.get('access-control-allow-credentials'), 'true');
        const json = await response.json();
        assert.strictEqual(json.status, 'success');
    } finally {
        server.close();
    }
});

test('Production config rejects requests from disallowed origin with 403 Forbidden', async () => {
    const app = express();
    const corsOptions = getCorsOptions({
        nodeEnv: 'production',
        corsOrigins: 'https://arenax.gg'
    });
    app.use(cors(corsOptions));
    app.get('/api/v1/me', (req, res) => res.json({ status: 'success' }));
    // Express error middleware to handle rejection from cors callback
    app.use((err, req, res, next) => {
        const statusCode = err.status || 403;
        res.status(statusCode).json({
            error: {
                message: err.message,
                status: statusCode
            }
        });
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/me`, {
            headers: {
                Origin: 'https://unauthorized-domain.com'
            }
        });

        assert.strictEqual(response.status, 403);
        const json = await response.json();
        assert.ok(json.error.message.includes('CORS policy: origin not allowed'));
        assert.strictEqual(response.headers.get('access-control-allow-origin'), null);
    } finally {
        server.close();
    }
});
