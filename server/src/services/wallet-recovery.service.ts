import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { HttpError } from '../utils/http-error';
import { getDatabaseClient } from './database.service';
import stellarWalletService, {
    WalletAccessContext
} from './stellar-wallet.service';
import walletAuditService from './wallet-audit.service';

const RECOVERY_CODE_DIGITS = 6;
const RECOVERY_CODE_TTL_MS = 10 * 60 * 1000;
const RECOVERY_CODE_MAX_ATTEMPTS = 5;

const hashRecoveryCode = (code: string): string =>
    crypto.createHash('sha256').update(code).digest('hex');

const timingSafeEqual = (left: string, right: string): boolean => {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const generateRecoveryCode = (): string =>
    `${crypto.randomInt(0, 10 ** RECOVERY_CODE_DIGITS)}`.padStart(
        RECOVERY_CODE_DIGITS,
        '0'
    );

export interface WalletRecoveryChallengeResult {
    challengeId: string;
    expiresAt: Date;
    deliveryChannel: 'email';
    verificationCode?: string;
}

export class WalletRecoveryService {
    async createRecoveryChallenge(
        userId: string,
        password: string,
        context: WalletAccessContext = {}
    ): Promise<WalletRecoveryChallengeResult> {
        const prisma = getDatabaseClient();
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            throw new HttpError(404, 'User not found');
        }

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) {
            throw new HttpError(401, 'Invalid credentials');
        }

        const walletSummary = await stellarWalletService.ensureUserWallet(userId);
        const wallet = await prisma.userWallet.findUnique({
            where: { id: walletSummary.id }
        });

        if (!wallet) {
            throw new HttpError(404, 'Wallet not found');
        }

        const verificationCode = generateRecoveryCode();
        const expiresAt = new Date(Date.now() + RECOVERY_CODE_TTL_MS);

        await prisma.$transaction(async (tx) => {
            await tx.walletRecoveryChallenge.updateMany({
                where: {
                    userId,
                    status: 'PENDING'
                },
                data: {
                    status: 'CANCELLED'
                }
            });

            await tx.walletRecoveryChallenge.create({
                data: {
                    userId,
                    walletId: wallet.id,
                    codeHash: hashRecoveryCode(verificationCode),
                    expiresAt,
                    maxAttempts: RECOVERY_CODE_MAX_ATTEMPTS,
                    requestId: context.requestId,
                    requestedFromIp: context.ipAddress,
                    requestedUserAgent: context.userAgent
                }
            });
        });

        const challenge = await prisma.walletRecoveryChallenge.findFirst({
            where: {
                userId,
                walletId: wallet.id,
                status: 'PENDING'
            },
            orderBy: { createdAt: 'desc' }
        });

        if (!challenge) {
            throw new HttpError(500, 'Unable to create wallet recovery challenge');
        }

        await walletAuditService.record({
            walletId: wallet.id,
            actorUserId: userId,
            action: 'RECOVERY_CHALLENGE_CREATED',
            success: true,
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            reason: 'User initiated wallet recovery export flow',
            metadata: {
                expiresAt: expiresAt.toISOString()
            }
        });

        const result: WalletRecoveryChallengeResult = {
            challengeId: challenge.id,
            expiresAt,
            deliveryChannel: 'email'
        };

        if (process.env.NODE_ENV !== 'production') {
            result.verificationCode = verificationCode;
        }

        return result;
    }

    async exportSecretKey(
        userId: string,
        password: string,
        challengeId: string,
        verificationCode: string,
        context: WalletAccessContext = {}
    ): Promise<{ publicKey: string; secretKey: string }> {
        const prisma = getDatabaseClient();
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            throw new HttpError(404, 'User not found');
        }

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) {
            throw new HttpError(401, 'Invalid credentials');
        }

        const challenge = await prisma.walletRecoveryChallenge.findUnique({
            where: { id: challengeId }
        });

        if (!challenge || challenge.userId !== userId) {
            throw new HttpError(404, 'Recovery challenge not found');
        }

        if (challenge.status !== 'PENDING') {
            throw new HttpError(400, 'Recovery challenge is no longer active');
        }

        if (challenge.expiresAt.getTime() <= Date.now()) {
            await prisma.walletRecoveryChallenge.update({
                where: { id: challenge.id },
                data: {
                    status: 'EXPIRED'
                }
            });
            throw new HttpError(400, 'Recovery challenge has expired');
        }

        if (challenge.attempts >= challenge.maxAttempts) {
            await prisma.walletRecoveryChallenge.update({
                where: { id: challenge.id },
                data: {
                    status: 'CANCELLED'
                }
            });
            throw new HttpError(429, 'Recovery challenge attempt limit reached');
        }

        const providedCodeHash = hashRecoveryCode(verificationCode);
        if (!timingSafeEqual(challenge.codeHash, providedCodeHash)) {
            const updatedChallenge = await prisma.walletRecoveryChallenge.update({
                where: { id: challenge.id },
                data: {
                    attempts: {
                        increment: 1
                    },
                    lastAttemptAt: new Date(),
                    status:
                        challenge.attempts + 1 >= challenge.maxAttempts
                            ? 'CANCELLED'
                            : 'PENDING'
                }
            });

            await walletAuditService.record({
                walletId: challenge.walletId,
                actorUserId: userId,
                action: 'RECOVERY_CHALLENGE_COMPLETED',
                success: false,
                requestId: context.requestId,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                reason: 'Invalid wallet recovery verification code submitted',
                metadata: {
                    challengeId,
                    attempts: updatedChallenge.attempts
                }
            });

            throw new HttpError(401, 'Invalid recovery verification code');
        }

        const decrypted = await stellarWalletService.decryptSecretForUser(userId, 'EXPORT', {
            ...context,
            actorUserId: userId,
            reason: 'User exported Stellar secret key after MFA verification',
            metadata: {
                ...(context.metadata ?? {}),
                challengeId
            }
        });

        await prisma.walletRecoveryChallenge.update({
            where: { id: challenge.id },
            data: {
                status: 'COMPLETED',
                completedAt: new Date(),
                attempts: {
                    increment: 1
                },
                lastAttemptAt: new Date()
            }
        });

        await walletAuditService.record({
            walletId: challenge.walletId,
            actorUserId: userId,
            action: 'RECOVERY_CHALLENGE_COMPLETED',
            success: true,
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            reason: 'Wallet recovery challenge satisfied and key export released',
            metadata: {
                challengeId
            }
        });

        return {
            publicKey: decrypted.wallet.publicKey,
            secretKey: decrypted.secretKey
        };
    }
}

export default new WalletRecoveryService();
