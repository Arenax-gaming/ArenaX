/**
 * Issue #1385 — Refresh token rotation + family tracking tests
 *
 * Key scenario: reuse a consumed refresh token and assert that
 * the ENTIRE family is invalidated (old AND new tokens rejected).
 */

import { refreshSession, logoutUser } from '../src/services/auth.service';
import { HttpError } from '../src/utils/http-error';

// ── Prisma mock ───────────────────────────────────────────────────────────────
// We model the RefreshToken table in memory to stay DB-free.

type MockToken = {
    id: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    parentTokenId: string | null;
    replacedByTokenId: string | null;
    revokedAt: Date | null;
    expiresAt: Date;
    user: { id: string; email: string; username: string; role: string;
            bio: null; socials: null; createdAt: Date; updatedAt: Date; isVerified: boolean };
};

const tokenStore = new Map<string, MockToken>();
let idSeq = 0;
const nextId = () => `tok-${++idSeq}`;

jest.mock('../src/services/database.service', () => ({
    getDatabaseClient: () => ({
        refreshToken: {
            findUnique: jest.fn(async ({ where }: any) => tokenStore.get(where.tokenHash) ?? null),
            create: jest.fn(async ({ data }: any) => {
                const record: MockToken = {
                    id: nextId(),
                    userId: data.userId,
                    familyId: data.familyId,
                    tokenHash: data.tokenHash,
                    parentTokenId: data.parentTokenId ?? null,
                    replacedByTokenId: null,
                    revokedAt: null,
                    expiresAt: data.expiresAt,
                    user: {
                        id: data.userId, email: 'u@test.gg', username: 'tester',
                        role: 'USER', bio: null, socials: null,
                        createdAt: new Date(), updatedAt: new Date(), isVerified: true,
                    },
                };
                tokenStore.set(record.tokenHash, record);
                return record;
            }),
            update: jest.fn(async ({ where, data }: any) => {
                // Find by id or tokenHash
                let record: MockToken | undefined;
                if (where.id) {
                    for (const t of tokenStore.values()) if (t.id === where.id) { record = t; break; }
                } else {
                    record = tokenStore.get(where.tokenHash);
                }
                if (!record) return null;
                Object.assign(record, data);
                return record;
            }),
            updateMany: jest.fn(async ({ where, data }: any) => {
                for (const t of tokenStore.values()) {
                    if (t.familyId === where.familyId && t.revokedAt === null) {
                        Object.assign(t, data);
                    }
                }
            }),
        },
        $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
            // Forward to the same mock client
            const mock = {
                refreshToken: {
                    create: jest.fn(async ({ data }: any) => {
                        const record: MockToken = {
                            id: nextId(),
                            userId: data.userId,
                            familyId: data.familyId,
                            tokenHash: data.tokenHash,
                            parentTokenId: data.parentTokenId ?? null,
                            replacedByTokenId: null,
                            revokedAt: null,
                            expiresAt: data.expiresAt,
                            user: {
                                id: data.userId, email: 'u@test.gg', username: 'tester',
                                role: 'USER', bio: null, socials: null,
                                createdAt: new Date(), updatedAt: new Date(), isVerified: true,
                            },
                        };
                        tokenStore.set(record.tokenHash, record);
                        return record;
                    }),
                    update: jest.fn(async ({ where, data }: any) => {
                        let record: MockToken | undefined;
                        if (where.id) {
                            for (const t of tokenStore.values()) if (t.id === where.id) { record = t; break; }
                        }
                        if (!record) return null;
                        Object.assign(record, data);
                        return record;
                    }),
                },
            };
            return fn(mock);
        }),
    }),
}));

jest.mock('../src/services/logger.service', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/config/auth.config', () => ({
    authConfig: {
        signingKey: 'test-signing-key-at-least-32-characters-long!!',
        verificationKey: 'test-signing-key-at-least-32-characters-long!!',
        jwtAlgorithm: 'HS256',
        accessTokenTtl: '15m',
        refreshTokenTtl: '7d',
        refreshTokenTtlMs: 7 * 24 * 60 * 60 * 1000,
    },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import crypto from 'crypto';
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

/** Directly plant a fresh token into the mock store (simulates login). */
function plantToken(overrides: Partial<MockToken> = {}): { raw: string; record: MockToken } {
    const raw = crypto.randomBytes(64).toString('hex');
    const record: MockToken = {
        id: nextId(),
        userId: 'user-test-1',
        familyId: crypto.randomUUID(),
        tokenHash: sha256(raw),
        parentTokenId: null,
        replacedByTokenId: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user: {
            id: 'user-test-1', email: 'u@test.gg', username: 'tester',
            role: 'USER', bio: null, socials: null,
            createdAt: new Date(), updatedAt: new Date(), isVerified: true,
        },
        ...overrides,
    };
    tokenStore.set(record.tokenHash, record);
    return { raw, record };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    tokenStore.clear();
    idSeq = 0;
});

describe('#1385 Refresh token rotation', () => {
    it('issues a new token pair on valid rotation', async () => {
        const { raw } = plantToken();
        const result = await refreshSession({ refreshToken: raw });
        expect(result.tokens.accessToken).toBeDefined();
        expect(result.tokens.refreshToken).toBeDefined();
        expect(result.tokens.refreshToken).not.toBe(raw);
    });

    it('original token is invalidated after rotation', async () => {
        const { raw } = plantToken();
        await refreshSession({ refreshToken: raw });

        // Presenting the consumed token must be rejected.
        await expect(refreshSession({ refreshToken: raw })).rejects.toMatchObject({
            statusCode: 401,
        });
    });

    it('detects token reuse and revokes the entire family', async () => {
        const { raw: original } = plantToken();
        const { tokens } = await refreshSession({ refreshToken: original });
        const rotated = tokens.refreshToken;

        // Replay the original (already consumed).
        await expect(refreshSession({ refreshToken: original }))
            .rejects.toMatchObject({ statusCode: 401 });

        // The freshly rotated token from the same family must also be dead now.
        await expect(refreshSession({ refreshToken: rotated }))
            .rejects.toMatchObject({ statusCode: 401 });
    });

    it('rejects an expired token', async () => {
        const { raw } = plantToken({ expiresAt: new Date(Date.now() - 1000) });
        await expect(refreshSession({ refreshToken: raw }))
            .rejects.toMatchObject({ statusCode: 401 });
    });

    it('rejects a completely unknown token', async () => {
        await expect(refreshSession({ refreshToken: crypto.randomBytes(64).toString('hex') }))
            .rejects.toMatchObject({ statusCode: 401 });
    });
});
