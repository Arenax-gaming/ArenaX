const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
    'test-secret-should-be-long-enough-for-hs256-validation-12345';
process.env.ACCESS_TOKEN_TTL = '15m';
process.env.REFRESH_TOKEN_TTL = '7d';
process.env.JWT_PRIVATE_KEY = '';
process.env.JWT_PUBLIC_KEY = '';
process.env.JWT_PRIVATE_KEY_FILE = '';
process.env.JWT_PUBLIC_KEY_FILE = '';

const { createApp } = require('../dist/app');
const {
    resetDatabaseClient,
    setDatabaseClientForTesting
} = require('../dist/services/database.service');

const hashToken = (token) =>
    crypto.createHash('sha256').update(token).digest('hex');

const pickSelectedFields = (record, select) => {
    if (!select) {
        return { ...record };
    }

    const selected = {};
    for (const [key, include] of Object.entries(select)) {
        if (include) {
            selected[key] = record[key];
        }
    }
    return selected;
};

const uniqueConstraintError = (field) => ({
    code: 'P2002',
    meta: { target: [field] }
});

const createMockDatabase = () => {
    const users = [];
    const refreshTokens = [];

    const userDelegate = {
        findUnique: async ({ where, select }) => {
            const user = users.find((candidate) => {
                if (where.id) {
                    return candidate.id === where.id;
                }
                if (where.email) {
                    return candidate.email === where.email;
                }
                if (where.username) {
                    return candidate.username === where.username;
                }
                return false;
            });

            if (!user) {
                return null;
            }

            return pickSelectedFields(user, select);
        },

        create: async ({ data }) => {
            if (users.some((user) => user.email === data.email)) {
                throw uniqueConstraintError('email');
            }

            if (users.some((user) => user.username === data.username)) {
                throw uniqueConstraintError('username');
            }

            const now = new Date();
            const user = {
                id: crypto.randomUUID(),
                email: data.email,
                username: data.username,
                passwordHash: data.passwordHash,
                role: data.role || 'USER',
                bio: data.bio ?? null,
                socials: data.socials ?? null,
                walletAddress: data.walletAddress ?? null,
                createdAt: now,
                updatedAt: now
            };

            users.push(user);
            return { ...user };
        },

        update: async ({ where, data, select }) => {
            const user = users.find((candidate) => candidate.id === where.id);
            if (!user) {
                throw new Error('User not found');
            }

            if (
                data.username &&
                users.some(
                    (candidate) =>
                        candidate.username === data.username &&
                        candidate.id !== where.id
                )
            ) {
                throw uniqueConstraintError('username');
            }

            if (
                data.email &&
                users.some(
                    (candidate) =>
                        candidate.email === data.email && candidate.id !== where.id
                )
            ) {
                throw uniqueConstraintError('email');
            }

            Object.assign(user, data);
            user.updatedAt = new Date();
            return pickSelectedFields(user, select);
        }
    };

    const refreshTokenDelegate = {
        findUnique: async ({ where, include }) => {
            const token = refreshTokens.find((candidate) => {
                if (where.id) {
                    return candidate.id === where.id;
                }
                if (where.tokenHash) {
                    return candidate.tokenHash === where.tokenHash;
                }
                return false;
            });

            if (!token) {
                return null;
            }

            const payload = { ...token };

            if (include && include.user) {
                payload.user = users.find((candidate) => candidate.id === token.userId);
            }

            return payload;
        },

        create: async ({ data }) => {
            if (
                refreshTokens.some(
                    (existingToken) => existingToken.tokenHash === data.tokenHash
                )
            ) {
                throw uniqueConstraintError('tokenHash');
            }

            const now = new Date();
            const refreshToken = {
                id: crypto.randomUUID(),
                userId: data.userId,
                familyId: data.familyId,
                tokenHash: data.tokenHash,
                expiresAt: new Date(data.expiresAt),
                revokedAt: data.revokedAt ?? null,
                parentTokenId: data.parentTokenId ?? null,
                replacedByTokenId: data.replacedByTokenId ?? null,
                createdAt: now,
                updatedAt: now
            };

            refreshTokens.push(refreshToken);
            return { ...refreshToken };
        },

        update: async ({ where, data }) => {
            const token = refreshTokens.find((candidate) => candidate.id === where.id);
            if (!token) {
                throw new Error('Refresh token not found');
            }

            Object.assign(token, data);
            token.updatedAt = new Date();
            return { ...token };
        },

        updateMany: async ({ where, data }) => {
            let count = 0;
            for (const token of refreshTokens) {
                const familyMatch =
                    where.familyId === undefined || token.familyId === where.familyId;
                const revokedAtMatch =
                    where.revokedAt === undefined || token.revokedAt === where.revokedAt;

                if (familyMatch && revokedAtMatch) {
                    Object.assign(token, data);
                    token.updatedAt = new Date();
                    count += 1;
                }
            }

            return { count };
        }
    };

    const database = {
        user: userDelegate,
        refreshToken: refreshTokenDelegate,
        $transaction: async (callback) => callback(database),
        _state: {
            users,
            refreshTokens
        }
    };

    return database;
};

const readResponse = async (response) => {
    const rawBody = await response.text();
    if (!rawBody) {
        return null;
    }

    return JSON.parse(rawBody);
};

let appServer;
let baseUrl;
let database;

before(async () => {
    const app = createApp();
    appServer = app.listen(0);

    await new Promise((resolve) => {
        appServer.once('listening', resolve);
    });

    const address = appServer.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
    database = createMockDatabase();
    setDatabaseClientForTesting(database);
});

after(async () => {
    resetDatabaseClient();
    await new Promise((resolve, reject) => {
        appServer.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
});

const request = async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
    }

    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers
    });

    return {
        status: response.status,
        body: await readResponse(response)
    };
};

test('registration normalizes email, hashes password, and auto-generates unique usernames', async () => {
    const firstResponse = await request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            email: 'PlayerOne@Example.COM',
            password: 'strongpassword123'
        })
    });

    assert.equal(firstResponse.status, 201);
    assert.equal(firstResponse.body.user.email, 'playerone@example.com');
    assert.ok(firstResponse.body.user.username);
    assert.equal(firstResponse.body.user.passwordHash, undefined);

    const firstStoredUser = database._state.users[0];
    assert.notEqual(firstStoredUser.passwordHash, 'strongpassword123');
    assert.equal(
        await bcrypt.compare('strongpassword123', firstStoredUser.passwordHash),
        true
    );

    const secondResponse = await request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            email: 'PlayerOne@another.com',
            password: 'strongpassword123'
        })
    });

    assert.equal(secondResponse.status, 201);
    assert.notEqual(
        secondResponse.body.user.username,
        firstResponse.body.user.username
    );
});

test('login issues access and refresh tokens with expected TTL', async () => {
    await request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            email: 'ttluser@example.com',
            password: 'strongpassword123',
            username: 'ttluser'
        })
    });

    const beforeLogin = Date.now();
    const loginResponse = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
            email: 'TTLUSER@example.com',
            password: 'strongpassword123'
        })
    });
    const afterLogin = Date.now();

    assert.equal(loginResponse.status, 200);
    const { accessToken, refreshToken } = loginResponse.body.tokens;
    assert.ok(accessToken);
    assert.ok(refreshToken);

    const decoded = jwt.decode(accessToken);
    assert.ok(decoded.exp);
    assert.ok(decoded.iat);
    assert.equal(decoded.exp - decoded.iat, 15 * 60);

    const storedRefreshToken = database._state.refreshTokens.find(
        (token) => token.tokenHash === hashToken(refreshToken)
    );
    assert.ok(storedRefreshToken);

    const expectedRefreshDurationMs = 7 * 24 * 60 * 60 * 1000;
    assert.ok(storedRefreshToken.expiresAt.getTime() >= beforeLogin + expectedRefreshDurationMs);
    assert.ok(storedRefreshToken.expiresAt.getTime() <= afterLogin + expectedRefreshDurationMs + 1000);
});

test('refresh rotation revokes reused token families', async () => {
    await request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            email: 'rotate@example.com',
            password: 'strongpassword123',
            username: 'rotator'
        })
    });

    const loginResponse = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
            email: 'rotate@example.com',
            password: 'strongpassword123'
        })
    });

    const initialRefreshToken = loginResponse.body.tokens.refreshToken;

    const rotationResponse = await request('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: initialRefreshToken })
    });

    assert.equal(rotationResponse.status, 200);
    const rotatedRefreshToken = rotationResponse.body.tokens.refreshToken;
    assert.notEqual(rotatedRefreshToken, initialRefreshToken);

    const oldTokenRecord = database._state.refreshTokens.find(
        (token) => token.tokenHash === hashToken(initialRefreshToken)
    );
    const newTokenRecord = database._state.refreshTokens.find(
        (token) => token.tokenHash === hashToken(rotatedRefreshToken)
    );

    assert.ok(oldTokenRecord.revokedAt);
    assert.equal(oldTokenRecord.replacedByTokenId, newTokenRecord.id);
    assert.equal(oldTokenRecord.familyId, newTokenRecord.familyId);

    const reuseAttempt = await request('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: initialRefreshToken })
    });

    assert.equal(reuseAttempt.status, 401);

    const familyTokens = database._state.refreshTokens.filter(
        (token) => token.familyId === oldTokenRecord.familyId
    );
    assert.ok(familyTokens.length >= 2);
    assert.equal(
        familyTokens.every((token) => token.revokedAt !== null),
        true
    );
});

test('rbac blocks non-admin users from admin and governance routes', async () => {
    await request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            email: 'roleuser@example.com',
            password: 'strongpassword123',
            username: 'roleuser'
        })
    });

    const loginResponse = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
            email: 'roleuser@example.com',
            password: 'strongpassword123'
        })
    });

    const accessToken = loginResponse.body.tokens.accessToken;

    const adminResponse = await request('/api/admin', {
        method: 'GET',
        headers: {
            authorization: `Bearer ${accessToken}`
        }
    });

    const governanceResponse = await request('/api/governance', {
        method: 'GET',
        headers: {
            authorization: `Bearer ${accessToken}`
        }
    });

    assert.equal(adminResponse.status, 403);
    assert.equal(governanceResponse.status, 403);
});

test('profiles endpoints return public profile and validate social URLs on patch', async () => {
    const registerResponse = await request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            email: 'profile@example.com',
            password: 'strongpassword123',
            username: 'profileuser'
        })
    });

    const accessToken = registerResponse.body.tokens.accessToken;

    const publicProfileResponse = await request('/api/profiles/profileuser', {
        method: 'GET'
    });
    assert.equal(publicProfileResponse.status, 200);
    assert.equal(publicProfileResponse.body.username, 'profileuser');

    const invalidPatchResponse = await request('/api/profiles/me', {
        method: 'PATCH',
        headers: {
            authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            socials: {
                twitter: 'not-a-url'
            }
        })
    });
    assert.equal(invalidPatchResponse.status, 400);

    const validPatchResponse = await request('/api/profiles/me', {
        method: 'PATCH',
        headers: {
            authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            bio: 'I play to win',
            socials: {
                twitter: 'https://twitter.com/profileuser'
            }
        })
    });

    assert.equal(validPatchResponse.status, 200);
    assert.equal(validPatchResponse.body.bio, 'I play to win');
    assert.equal(
        validPatchResponse.body.socials.twitter,
        'https://twitter.com/profileuser'
    );
});
