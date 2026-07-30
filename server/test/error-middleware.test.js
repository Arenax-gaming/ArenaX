const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/arenax_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-characters-long-ok';

// Minimal req/res/next doubles — no supertest/express app needed since
// errorHandler only touches a handful of req/res members.
function makeReq(overrides = {}) {
    const logs = [];
    return {
        requestId: 'req-1',
        correlationId: 'corr-1',
        method: 'GET',
        originalUrl: '/api/v1/wallets/me?foo=bar',
        path: '/wallets/me',
        baseUrl: '',
        route: { path: '/wallets/me' },
        query: { foo: 'bar' },
        headers: { authorization: 'Bearer secret-token', 'user-agent': 'jest-test' },
        ip: '127.0.0.1',
        get(name) {
            return this.headers[name.toLowerCase()];
        },
        log: {
            error(message, meta) {
                logs.push({ message, meta });
            },
        },
        _logs: logs,
        ...overrides,
    };
}

function makeRes() {
    return {
        statusCode: undefined,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}

describe('errorHandler', () => {
    let errorHandler;

    before(async () => {
        const envModule = await import('../dist/config/env.js');
        envModule.initEnv();
        ({ errorHandler } = await import('../dist/middleware/error.middleware.js'));
    });

    it('logs request context, sanitized headers, and no user when unauthenticated', () => {
        const req = makeReq();
        const res = makeRes();

        errorHandler(new Error('User 123 not found'), req, res, () => {});

        assert.equal(req._logs.length, 1);
        const { meta } = req._logs[0];
        assert.equal(meta.method, 'GET');
        assert.equal(meta.route, '/wallets/me');
        assert.deepEqual(meta.query, { foo: 'bar' });
        assert.equal(meta.headers.authorization, '[REDACTED]');
        assert.equal(meta.headers['user-agent'], 'jest-test');
        assert.equal(meta.ip, '127.0.0.1');
        assert.equal(meta.correlationId, 'corr-1');
        assert.equal(meta.user, undefined);
        assert.ok(meta.stack, 'expected the full stack trace to be captured');
        assert.ok(meta.errorFingerprint);
    });

    it('includes user id and role when the request is authenticated', () => {
        const req = makeReq({ user: { id: 'user-42', role: 'ADMIN', email: 'a@b.com', username: 'a' } });
        const res = makeRes();

        errorHandler(new Error('boom'), req, res, () => {});

        const { meta } = req._logs[0];
        assert.deepEqual(meta.user, { id: 'user-42', role: 'ADMIN' });
    });

    it('produces the same fingerprint for the same error shape with different ids', () => {
        const resA = makeRes();
        const reqA = makeReq();
        errorHandler(new Error('User 123 not found'), reqA, resA, () => {});

        const resB = makeRes();
        const reqB = makeReq();
        errorHandler(new Error('User 987654 not found'), reqB, resB, () => {});

        assert.equal(reqA._logs[0].meta.errorFingerprint, reqB._logs[0].meta.errorFingerprint);
    });

    it('produces a different fingerprint for a different route', () => {
        const resA = makeRes();
        const reqA = makeReq();
        errorHandler(new Error('User 123 not found'), reqA, resA, () => {});

        const resB = makeRes();
        const reqB = makeReq({ path: '/matches/me', route: { path: '/matches/me' } });
        errorHandler(new Error('User 123 not found'), reqB, resB, () => {});

        assert.notEqual(reqA._logs[0].meta.errorFingerprint, reqB._logs[0].meta.errorFingerprint);
    });
});
