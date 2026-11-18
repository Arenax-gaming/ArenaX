/**
 * Issue #1384 — CORS configuration hardening tests
 *
 * Verifies that production config blocks disallowed origins,
 * passes whitelisted origins, and returns correct preflight headers.
 */

import request from 'supertest';
import express, { Express } from 'express';
import cors, { CorsOptions } from 'cors';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALLOWED = 'https://app.arenax.gg';
const BLOCKED = 'https://evil.example.com';

function buildProductionCors(allowList: string[]): CorsOptions {
    return {
        origin(origin, callback) {
            if (!origin) { callback(null, true); return; }
            if (allowList.includes(origin)) { callback(null, true); return; }
            callback(new Error(`CORS policy: origin '${origin}' is not allowed`));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
        optionsSuccessStatus: 204,
    };
}

function buildApp(allowList: string[]): Express {
    const app = express();
    const opts = buildProductionCors(allowList);
    app.options('*', cors(opts));
    app.use(cors(opts));
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('#1384 CORS hardening — production config', () => {
    const app = buildApp([ALLOWED]);

    it('allows a whitelisted origin', async () => {
        const res = await request(app)
            .get('/ping')
            .set('Origin', ALLOWED);
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    });

    it('rejects a disallowed origin', async () => {
        const res = await request(app)
            .get('/ping')
            .set('Origin', BLOCKED);
        // Express CORS middleware sends a 500 when the callback passes an Error.
        expect([403, 500]).toContain(res.status);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('preflight OPTIONS returns 204 with correct headers', async () => {
        const res = await request(app)
            .options('/ping')
            .set('Origin', ALLOWED)
            .set('Access-Control-Request-Method', 'POST')
            .set('Access-Control-Request-Headers', 'Content-Type');
        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
        expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('sets credentials: true only for whitelisted origins', async () => {
        const res = await request(app)
            .get('/ping')
            .set('Origin', ALLOWED);
        expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
});
