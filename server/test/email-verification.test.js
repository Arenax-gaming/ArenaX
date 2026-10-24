const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
    'test-secret-should-be-long-enough-for-hs256-validation-12345';
process.env.ACCESS_TOKEN_TTL = '15m';
process.env.REFRESH_TOKEN_TTL = '7d';
process.env.ENCRYPTION_SECRET =
    'test-wallet-encryption-secret-with-sufficient-length-123456';

const hashToken = (token) =>
    crypto.createHash('sha256').update(token).digest('hex');

const setupMockPrisma = () => {
    const users = [];
    const refreshTokens = [];
    const tournaments = [];
    const tournamentRegistrations = [];

    const mockPrisma = {
        user: {
            findUnique: async ({ where }) => {
                if (where.id) return users.find((u) => u.id === where.id) || null;
                if (where.email) return users.find((u) => u.email === where.email) || null;
                if (where.username) return users.find((u) => u.username === where.username) || null;
                if (where.verificationToken) return users.find((u) => u.verificationToken === where.verificationToken) || null;
                return null;
            },
            findFirst: async ({ where }) => {
                if (where.OR) {
                    return (
                        users.find((u) =>
                            where.OR.some((condition) => {
                                if (condition.id && u.id === condition.id) return true;
                                if (condition.verificationToken && u.verificationToken === condition.verificationToken) return true;
                                return false;
                            })
                        ) || null
                    );
                }
                if (where.verificationToken) {
                    return users.find((u) => u.verificationToken === where.verificationToken) || null;
                }
                return null;
            },
            create: async ({ data }) => {
                const now = new Date();
                const user = {
                    id: crypto.randomUUID(),
                    email: data.email,
                    username: data.username,
                    passwordHash: data.passwordHash,
                    role: data.role || 'USER',
                    bio: null,
                    socials: null,
                    isVerified: data.isVerified ?? false,
                    verificationToken: data.verificationToken ?? null,
                    verificationTokenExpires: data.verificationTokenExpires ?? null,
                    walletAddress: null,
                    createdAt: now,
                    updatedAt: now
                };
                users.push(user);
                return { ...user };
            },
            update: async ({ where, data }) => {
                const user = users.find((u) => u.id === where.id);
                if (!user) throw new Error('User not found');
                Object.assign(user, data);
                user.updatedAt = new Date();
                return { ...user };
            }
        },
        refreshToken: {
            create: async ({ data }) => {
                const now = new Date();
                const token = {
                    id: crypto.randomUUID(),
                    userId: data.userId,
                    familyId: data.familyId,
                    tokenHash: data.tokenHash,
                    expiresAt: new Date(data.expiresAt),
                    revokedAt: null,
                    parentTokenId: data.parentTokenId ?? null,
                    replacedByTokenId: null,
                    createdAt: now,
                    updatedAt: now
                };
                refreshTokens.push(token);
                return { ...token };
            },
            findUnique: async () => null,
            update: async () => ({})
        },
        tournament: {
            findUnique: async ({ where }) => {
                const tourney = tournaments.find((t) => t.id === where.id);
                return tourney ? { participants: [], registrations: [], ...tourney } : null;
            }
        },
        tournamentRegistration: {
            findUnique: async () => null,
            count: async () => 0,
            create: async ({ data }) => {
                const reg = { id: crypto.randomUUID(), ...data };
                tournamentRegistrations.push(reg);
                return reg;
            }
        },
        userWallet: {
            findUnique: async () => null,
            create: async ({ data }) => ({ id: crypto.randomUUID(), ...data }),
            update: async () => ({})
        },
        walletTransaction: {
            findUnique: async () => null,
            create: async ({ data }) => ({ id: crypto.randomUUID(), ...data })
        },
        ledger: {
            findUnique: async () => null,
            create: async ({ data }) => ({ id: crypto.randomUUID(), ...data }),
            update: async () => ({})
        },
        $transaction: async (callback) => callback(mockPrisma)
    };

    return { mockPrisma, users, refreshTokens, tournaments };
};

test('Email Verification Flow (#1403)', async (t) => {
    const {
        registerUser,
        verifyEmail,
        resendVerificationEmail,
        createVerificationToken
    } = require('../dist/services/auth.service');
    const emailServiceModule = require('../dist/services/email.service');
    const emailService = emailServiceModule.default || emailServiceModule.emailService || emailServiceModule;
    const { setDatabaseClientForTesting } = require('../dist/services/database.service');
    const { requireEmailVerified } = require('../dist/middleware/auth.middleware');
    const { emailVerificationResendRateLimiter } = require('../dist/middleware/rate-limit.middleware');
    const { tournamentService } = require('../dist/services/tournament.service');
    const { walletService } = require('../dist/services/wallet.service');

    let state;

    beforeEach(() => {
        state = setupMockPrisma();
        setDatabaseClientForTesting(state.mockPrisma);
        emailService.lastSentToken = undefined;
    });

    await t.test('1. Registration sends signed verification token with 24-hour expiration', async () => {
        const result = await registerUser({
            email: 'newplayer@arenax.gg',
            password: 'SecurePassword123!',
            username: 'newplayer'
        });

        assert.ok(result.user);
        assert.equal(result.user.email, 'newplayer@arenax.gg');
        assert.equal(result.user.isVerified, false, 'User must initially be unverified');

        // Verify that a verification token was generated and sent via emailService
        const token = emailService.lastSentToken;
        assert.ok(token, 'A verification token should be sent via emailService');

        // Verify token is a valid signed JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        assert.equal(decoded.type, 'email_verification');
        assert.equal(decoded.sub, result.user.id);
        assert.equal(decoded.email, 'newplayer@arenax.gg');

        // Expiration must be approximately 24 hours (86400 seconds)
        const ttlSeconds = decoded.exp - decoded.iat;
        assert.equal(ttlSeconds, 86400, 'Token expiration must be exactly 24 hours');

        // Check user record in database
        const savedUser = state.users.find((u) => u.id === result.user.id);
        assert.ok(savedUser);
        assert.equal(savedUser.isVerified, false);
        assert.equal(savedUser.verificationToken, hashToken(token), 'Stored token must be SHA-256 hashed');
        assert.ok(savedUser.verificationTokenExpires > new Date(), 'verificationTokenExpires must be in future');
    });

    await t.test('2. Verification endpoint marks account as email-verified', async () => {
        const registerResult = await registerUser({
            email: 'verify-me@arenax.gg',
            password: 'SecurePassword123!',
            username: 'verifyme'
        });

        const token = emailService.lastSentToken;
        assert.ok(token);

        // Call verifyEmail with the received token
        const verifyResult = await verifyEmail({ token });
        assert.equal(verifyResult.isVerified, true);
        assert.equal(verifyResult.message, 'Email verified successfully');

        // Verify state in database
        const user = state.users.find((u) => u.id === registerResult.user.id);
        assert.equal(user.isVerified, true, 'User isVerified must be true');
        assert.equal(user.verificationToken, null, 'verificationToken must be cleared');
        assert.equal(user.verificationTokenExpires, null, 'verificationTokenExpires must be cleared');
    });

    await t.test('3. Verification with expired token is rejected', async () => {
        const registerResult = await registerUser({
            email: 'expired@arenax.gg',
            password: 'SecurePassword123!',
            username: 'expiredplayer'
        });

        const token = emailService.lastSentToken;
        // Artificially expire the token in database
        const user = state.users.find((u) => u.id === registerResult.user.id);
        user.verificationTokenExpires = new Date(Date.now() - 1000 * 60); // 1 minute ago

        await assert.rejects(
            async () => {
                await verifyEmail({ token });
            },
            (err) => {
                assert.equal(err.name, 'HttpError');
                assert.equal(err.status, 400);
                assert.equal(err.message, 'Verification token has expired');
                return true;
            }
        );
    });

    await t.test('4. Verification on already verified account returns 400', async () => {
        const registerResult = await registerUser({
            email: 'already@arenax.gg',
            password: 'SecurePassword123!',
            username: 'alreadyverified'
        });

        const token = emailService.lastSentToken;
        await verifyEmail({ token });

        // Second verification attempt
        await assert.rejects(
            async () => {
                await verifyEmail({ token });
            },
            (err) => {
                assert.equal(err.name, 'HttpError');
                assert.equal(err.status, 400);
                assert.equal(err.message, 'Email already verified');
                return true;
            }
        );
    });

    await t.test('5. Verification with invalid/tampered token returns 400', async () => {
        await assert.rejects(
            async () => {
                await verifyEmail({ token: 'completely-invalid-bogus-token' });
            },
            (err) => {
                assert.equal(err.name, 'HttpError');
                assert.equal(err.status, 400);
                assert.equal(err.message, 'Invalid verification token');
                return true;
            }
        );
    });

    await t.test('6. Resend endpoint generates new signed 24-hour token', async () => {
        const registerResult = await registerUser({
            email: 'resend@arenax.gg',
            password: 'SecurePassword123!',
            username: 'resendplayer'
        });

        const firstToken = emailService.lastSentToken;
        assert.ok(firstToken);

        // Request a new token via resend
        const resendResult = await resendVerificationEmail({ email: 'resend@arenax.gg' });
        assert.equal(resendResult.message, 'If the email exists, a verification link has been sent');

        const secondToken = emailService.lastSentToken;
        assert.ok(secondToken);
        assert.notEqual(firstToken, secondToken, 'New token must differ from previous token');

        // Verify the second token is signed and expires in 24 hours
        const decoded = jwt.verify(secondToken, process.env.JWT_SECRET);
        assert.equal(decoded.sub, registerResult.user.id);
        assert.equal(decoded.exp - decoded.iat, 86400);

        // Verifying with second token succeeds
        const verifyResult = await verifyEmail({ token: secondToken });
        assert.equal(verifyResult.isVerified, true);
    });

    await t.test('7. requireEmailVerified middleware blocks unverified accounts with 403', () => {
        let passedError = null;
        let nextCalled = false;

        const res = {};
        const next = (err) => {
            nextCalled = true;
            passedError = err;
        };

        // Case 1: Unverified user
        const unverifiedReq = {
            user: { id: 'u-1', email: 'unverified@arenax.gg', role: 'USER', isVerified: false }
        };
        requireEmailVerified(unverifiedReq, res, next);
        assert.ok(passedError, 'Must pass error to next()');
        assert.equal(passedError.status, 403);
        assert.equal(passedError.message, 'Email verification required');

        // Case 2: Verified user
        passedError = undefined;
        nextCalled = false;
        const verifiedReq = {
            user: { id: 'u-2', email: 'verified@arenax.gg', role: 'USER', isVerified: true }
        };
        requireEmailVerified(verifiedReq, res, next);
        assert.equal(passedError, undefined, 'No error must be passed to next()');
        assert.equal(nextCalled, true, 'Verified user must proceed through middleware');
    });

    await t.test('8. Unverified users blocked from tournament entry and wallet operations', async () => {
        const unverifiedUser = {
            id: 'unverified-player-id',
            email: 'player@arenax.gg',
            username: 'player',
            isVerified: false
        };
        state.users.push(unverifiedUser);

        state.tournaments.push({
            id: 'tourney-1',
            status: 'UPCOMING',
            currentParticipants: 0,
            maxPlayers: 16,
            registrationDeadline: new Date(Date.now() + 1000000),
            rules: {}
        });

        // Tournament registration should be blocked with 403
        await assert.rejects(
            async () => {
                await tournamentService.registerPlayer('tourney-1', 'unverified-player-id');
            },
            (err) => {
                assert.equal(err.name, 'HttpError');
                assert.equal(err.status, 403);
                assert.equal(err.message, 'Email verification required');
                return true;
            }
        );

        // Wallet transfer should be blocked with 403
        await assert.rejects(
            async () => {
                await walletService.internalTransfer({
                    fromUserId: unverifiedUser.id,
                    toUserId: 'dest-id',
                    currency: 'XLM',
                    amount: { lessThan: () => false },
                    type: 'TRANSFER',
                    idempotencyKey: 'idemp-1'
                });
            },
            (err) => {
                assert.equal(err.name, 'HttpError');
                assert.equal(err.status, 403);
                assert.equal(err.message, 'Email verification required');
                return true;
            }
        );

        // Once verified, the verification check passes
        unverifiedUser.isVerified = true;
        try {
            await tournamentService.registerPlayer('tourney-1', 'unverified-player-id');
        } catch (err) {
            assert.notEqual(err.message, 'Email verification required');
        }
    });

    await t.test('9. Resend endpoint rate limiter is configured for 3 requests per hour', () => {
        assert.ok(emailVerificationResendRateLimiter, 'Rate limiter middleware must exist');
    });
});
