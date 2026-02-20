import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { authConfig } from '../config/auth.config';
import {
    DatabaseTransactionClient,
    getDatabaseClient
} from './database.service';
import { HttpError } from '../utils/http-error';

const BCRYPT_ROUNDS = 12;
const MAX_USERNAME_LENGTH = 24;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_ATTEMPTS = 25;

const toTokenHash = (token: string): string =>
    crypto.createHash('sha256').update(token).digest('hex');

const constantTimeEquals = (left: string, right: string): boolean => {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const sanitizeUsername = (username: string): string =>
    username
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, MAX_USERNAME_LENGTH);

const buildUsernameBase = (email: string, username?: string): string => {
    if (username) {
        const sanitized = sanitizeUsername(username);
        if (sanitized.length < MIN_USERNAME_LENGTH) {
            throw new HttpError(
                400,
                `username must contain at least ${MIN_USERNAME_LENGTH} characters`
            );
        }
        return sanitized;
    }

    const localPart = email.split('@')[0] || 'player';
    const sanitizedLocalPart = sanitizeUsername(localPart);
    if (sanitizedLocalPart.length >= MIN_USERNAME_LENGTH) {
        return sanitizedLocalPart;
    }

    return `player${Math.floor(Math.random() * 9000 + 1000)}`;
};

const buildCandidateUsername = (base: string, attempt: number): string => {
    if (attempt === 0) {
        return base;
    }

    const suffix = `${Math.floor(Math.random() * 9000 + 1000)}`;
    const maxBaseLength = MAX_USERNAME_LENGTH - suffix.length;
    return `${base.slice(0, maxBaseLength)}${suffix}`;
};

const isUniqueConstraintError = (error: unknown, field?: string): boolean => {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const typedError = error as { code?: string; meta?: { target?: unknown } };
    if (typedError.code !== 'P2002') {
        return false;
    }

    if (!field) {
        return true;
    }

    const target = typedError.meta?.target;
    if (!Array.isArray(target)) {
        return false;
    }

    return target.includes(field);
};

const mapUserToSafeUser = (user: {
    id: string;
    email: string;
    username: string;
    role: string;
    bio: string | null;
    socials: unknown;
    createdAt: Date;
    updatedAt: Date;
}) => ({
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    bio: user.bio,
    socials: user.socials,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
});

const createAccessToken = (user: {
    id: string;
    email: string;
    username: string;
    role: string;
}): string =>
    jwt.sign(
        {
            email: user.email,
            username: user.username,
            role: user.role
        },
        authConfig.signingKey,
        {
            algorithm: authConfig.jwtAlgorithm,
            expiresIn:
                authConfig.accessTokenTtl as jwt.SignOptions['expiresIn'],
            subject: user.id
        }
    );

const generateRefreshToken = (): string => crypto.randomBytes(64).toString('hex');

const revokeTokenFamily = async (familyId: string): Promise<void> => {
    const prisma = getDatabaseClient();
    await prisma.refreshToken.updateMany({
        where: {
            familyId,
            revokedAt: null
        },
        data: {
            revokedAt: new Date()
        }
    });
};

const createRefreshTokenRecord = async (
    tx: DatabaseTransactionClient,
    params: {
        userId: string;
        familyId: string;
        parentTokenId?: string | null;
    }
): Promise<{ token: string; recordId: string }> => {
    const rawToken = generateRefreshToken();
    const tokenHash = toTokenHash(rawToken);
    const refreshTokenRecord = await tx.refreshToken.create({
        data: {
            userId: params.userId,
            familyId: params.familyId,
            parentTokenId: params.parentTokenId ?? null,
            tokenHash,
            expiresAt: new Date(Date.now() + authConfig.refreshTokenTtlMs)
        }
    });

    return { token: rawToken, recordId: refreshTokenRecord.id };
};

export interface RegisterInput {
    email: string;
    password: string;
    username?: string;
}

export interface LoginInput {
    email: string;
    password: string;
}

export interface RefreshInput {
    refreshToken: string;
}

export interface LogoutInput {
    refreshToken: string;
}

interface UserForSession {
    id: string;
    email: string;
    username: string;
    role: string;
    bio: string | null;
    socials: unknown;
    createdAt: Date;
    updatedAt: Date;
}

const issueSessionTokens = async (
    user: UserForSession,
    params?: {
        familyId?: string;
        parentTokenId?: string | null;
    }
): Promise<{
    accessToken: string;
    refreshToken: string;
}> => {
    const prisma = getDatabaseClient();
    const accessToken = createAccessToken(user);

    const refreshToken = await prisma.$transaction(async (tx) => {
        const { token, recordId } = await createRefreshTokenRecord(tx, {
            userId: user.id,
            familyId: params?.familyId || crypto.randomUUID(),
            parentTokenId: params?.parentTokenId
        });

        if (params?.parentTokenId) {
            await tx.refreshToken.update({
                where: { id: params.parentTokenId },
                data: {
                    revokedAt: new Date(),
                    replacedByTokenId: recordId
                }
            });
        }

        return token;
    });

    return { accessToken, refreshToken };
};

export const registerUser = async (input: RegisterInput) => {
    const prisma = getDatabaseClient();
    const normalizedEmail = normalizeEmail(input.email);

    const existingByEmail = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true }
    });

    if (existingByEmail) {
        throw new HttpError(409, 'Email already in use');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const usernameBase = buildUsernameBase(normalizedEmail, input.username);

    for (let attempt = 0; attempt < MAX_USERNAME_ATTEMPTS; attempt += 1) {
        const candidate = buildCandidateUsername(usernameBase, attempt);
        try {
            const createdUser = await prisma.user.create({
                data: {
                    email: normalizedEmail,
                    username: candidate,
                    passwordHash
                }
            });

            const tokens = await issueSessionTokens(createdUser);

            return {
                user: mapUserToSafeUser(createdUser),
                tokens: {
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    accessTokenTtl: authConfig.accessTokenTtl,
                    refreshTokenTtl: authConfig.refreshTokenTtl
                }
            };
        } catch (error) {
            if (isUniqueConstraintError(error, 'email')) {
                throw new HttpError(409, 'Email already in use');
            }

            if (isUniqueConstraintError(error, 'username')) {
                continue;
            }

            throw error;
        }
    }

    throw new HttpError(500, 'Unable to generate a unique username');
};

export const loginUser = async (input: LoginInput) => {
    const prisma = getDatabaseClient();
    const normalizedEmail = normalizeEmail(input.email);
    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail }
    });

    if (!user) {
        throw new HttpError(401, 'Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
        throw new HttpError(401, 'Invalid credentials');
    }

    const tokens = await issueSessionTokens(user);

    return {
        user: mapUserToSafeUser(user),
        tokens: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            accessTokenTtl: authConfig.accessTokenTtl,
            refreshTokenTtl: authConfig.refreshTokenTtl
        }
    };
};

export const refreshSession = async (input: RefreshInput) => {
    const prisma = getDatabaseClient();
    const incomingTokenHash = toTokenHash(input.refreshToken);
    const storedToken = await prisma.refreshToken.findUnique({
        where: { tokenHash: incomingTokenHash },
        include: {
            user: true
        }
    });

    if (!storedToken) {
        throw new HttpError(401, 'Invalid refresh token');
    }

    if (!constantTimeEquals(storedToken.tokenHash, incomingTokenHash)) {
        throw new HttpError(401, 'Invalid refresh token');
    }

    if (storedToken.revokedAt) {
        if (storedToken.replacedByTokenId) {
            await revokeTokenFamily(storedToken.familyId);
            throw new HttpError(
                401,
                'Refresh token reuse detected, please login again'
            );
        }
        throw new HttpError(401, 'Invalid refresh token');
    }

    if (storedToken.expiresAt.getTime() <= Date.now()) {
        await prisma.refreshToken.update({
            where: { id: storedToken.id },
            data: { revokedAt: new Date() }
        });
        throw new HttpError(401, 'Refresh token expired');
    }

    const tokens = await issueSessionTokens(storedToken.user, {
        familyId: storedToken.familyId,
        parentTokenId: storedToken.id
    });

    return {
        user: mapUserToSafeUser(storedToken.user),
        tokens: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            accessTokenTtl: authConfig.accessTokenTtl,
            refreshTokenTtl: authConfig.refreshTokenTtl
        }
    };
};

export const logoutUser = async (input: LogoutInput): Promise<void> => {
    const prisma = getDatabaseClient();
    const incomingTokenHash = toTokenHash(input.refreshToken);
    const storedToken = await prisma.refreshToken.findUnique({
        where: { tokenHash: incomingTokenHash }
    });

    if (!storedToken) {
        return;
    }

    if (!constantTimeEquals(storedToken.tokenHash, incomingTokenHash)) {
        return;
    }

    if (!storedToken.revokedAt) {
        await prisma.refreshToken.update({
            where: { id: storedToken.id },
            data: { revokedAt: new Date() }
        });
    }
};
