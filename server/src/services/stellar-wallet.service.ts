import { Keypair } from '@stellar/stellar-sdk';
import encryptionService from './encryption.service';
import {
    DatabaseTransactionClient,
    getDatabaseClient
} from './database.service';
import walletAuditService, {
    WalletKeyAccessAction
} from './wallet-audit.service';

export interface WalletAccessContext {
    actorUserId?: string | null;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
}

export interface WalletSummary {
    id: string;
    publicKey: string;
    encryptionVersion: number;
    createdAt: Date;
    lastRotatedAt: Date | null;
}

type WalletPersistenceClient = Pick<DatabaseTransactionClient, 'user' | 'userWallet'>;

export class StellarWalletService {
    generateWallet(): Keypair {
        return Keypair.random();
    }

    async registerUserWallet(
        userId: string,
        client?: WalletPersistenceClient
    ): Promise<WalletSummary> {
        const db = client ?? getDatabaseClient();
        const existingWallet = await db.userWallet.findUnique({
            where: { userId }
        });

        if (existingWallet) {
            return this.toWalletSummary(existingWallet);
        }

        const keypair = this.generateWallet();
        const publicKey = keypair.publicKey();
        const secretKey = keypair.secret();
        const encryptedSecretKey = encryptionService.encrypt(secretKey);
        const activeKeyVersion = encryptionService.getActiveKeyVersion();

        const wallet = await db.userWallet.create({
            data: {
                userId,
                publicKey,
                encryptedSecretKey,
                encryptionVersion: activeKeyVersion,
                encryptedSecretKeyVersion: activeKeyVersion,
                lastRotatedAt: new Date()
            }
        });

        await db.user.update({
            where: { id: userId },
            data: { walletAddress: publicKey }
        });

        return this.toWalletSummary(wallet);
    }

    async ensureUserWallet(userId: string): Promise<WalletSummary> {
        const existingWallet = await this.getWalletByUserId(userId);
        if (existingWallet) {
            return this.toWalletSummary(existingWallet);
        }

        return this.registerUserWallet(userId);
    }

    async getPublicKey(userId: string): Promise<string | null> {
        const wallet = await this.getWalletByUserId(userId);
        return wallet?.publicKey ?? null;
    }

    async getWalletSummary(userId: string): Promise<WalletSummary | null> {
        const wallet = await this.getWalletByUserId(userId);
        return wallet ? this.toWalletSummary(wallet) : null;
    }

    async decryptSecretForUser(
        userId: string,
        action: WalletKeyAccessAction,
        context: WalletAccessContext = {}
    ): Promise<{ secretKey: string; wallet: { id: string; publicKey: string } }> {
        const prisma = getDatabaseClient();
        const wallet = await prisma.userWallet.findUnique({
            where: { userId }
        });

        if (!wallet) {
            throw new Error(`No wallet found for user ${userId}`);
        }

        try {
            const decryption = encryptionService.decryptWithMetadata(
                wallet.encryptedSecretKey
            );

            if (
                decryption.usedLegacyFormat ||
                decryption.keyVersion !== encryptionService.getActiveKeyVersion()
            ) {
                const rotation = encryptionService.rotate(wallet.encryptedSecretKey);
                await prisma.userWallet.update({
                    where: { id: wallet.id },
                    data: {
                        encryptedSecretKey: rotation.encrypted,
                        encryptionVersion: rotation.keyVersion,
                        encryptedSecretKeyVersion: rotation.keyVersion,
                        lastRotatedAt: new Date()
                    }
                });

                await walletAuditService.record({
                    walletId: wallet.id,
                    actorUserId: context.actorUserId ?? userId,
                    action: 'ROTATION',
                    success: true,
                    requestId: context.requestId,
                    ipAddress: context.ipAddress,
                    userAgent: context.userAgent,
                    reason: 'Lazy wallet master key rotation during secure access',
                    keyVersion: rotation.keyVersion,
                    metadata: {
                        previousVersion: rotation.previousVersion
                    }
                });
            }

            await walletAuditService.record({
                walletId: wallet.id,
                actorUserId: context.actorUserId ?? userId,
                action,
                success: true,
                requestId: context.requestId,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                reason: context.reason,
                keyVersion: encryptionService.getActiveKeyVersion(),
                metadata: context.metadata
            });

            return {
                secretKey: decryption.plainText,
                wallet: {
                    id: wallet.id,
                    publicKey: wallet.publicKey
                }
            };
        } catch (error) {
            await walletAuditService.record({
                walletId: wallet.id,
                actorUserId: context.actorUserId ?? userId,
                action,
                success: false,
                requestId: context.requestId,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                reason:
                    context.reason || 'Wallet secret access denied due to decryption failure',
                keyVersion: wallet.encryptionVersion,
                metadata: {
                    ...(context.metadata ?? {}),
                    error: error instanceof Error ? error.message : 'Unknown error'
                }
            });

            throw error;
        }
    }

    async rotateUserWallet(userId: string, context: WalletAccessContext = {}): Promise<WalletSummary> {
        const prisma = getDatabaseClient();
        const wallet = await prisma.userWallet.findUnique({
            where: { userId }
        });

        if (!wallet) {
            throw new Error(`No wallet found for user ${userId}`);
        }

        if (!encryptionService.needsRotation(wallet.encryptedSecretKey)) {
            return this.toWalletSummary(wallet);
        }

        const rotation = encryptionService.rotate(wallet.encryptedSecretKey);
        const updatedWallet = await prisma.userWallet.update({
            where: { id: wallet.id },
            data: {
                encryptedSecretKey: rotation.encrypted,
                encryptionVersion: rotation.keyVersion,
                encryptedSecretKeyVersion: rotation.keyVersion,
                lastRotatedAt: new Date()
            }
        });

        await walletAuditService.record({
            walletId: wallet.id,
            actorUserId: context.actorUserId ?? userId,
            action: 'ROTATION',
            success: true,
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            reason: context.reason || 'Manual wallet master key rotation',
            keyVersion: rotation.keyVersion,
            metadata: {
                ...(context.metadata ?? {}),
                previousVersion: rotation.previousVersion
            }
        });

        return this.toWalletSummary(updatedWallet);
    }

    private async getWalletByUserId(userId: string) {
        const prisma = getDatabaseClient();
        return prisma.userWallet.findUnique({
            where: { userId }
        });
    }

    private toWalletSummary(wallet: {
        id: string;
        publicKey: string;
        encryptionVersion: number;
        createdAt: Date;
        lastRotatedAt: Date | null;
    }): WalletSummary {
        return {
            id: wallet.id,
            publicKey: wallet.publicKey,
            encryptionVersion: wallet.encryptionVersion,
            createdAt: wallet.createdAt,
            lastRotatedAt: wallet.lastRotatedAt
        };
    }
}

export default new StellarWalletService();
