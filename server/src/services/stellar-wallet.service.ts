import { Keypair } from '@stellar/stellar-sdk';
import prisma from './database.service';
import encryptionService from './encryption.service';

export class StellarWalletService {
    /**
     * Generates a random Ed25519 Keypair.
     */
    generateWallet() {
        return Keypair.random();
    }

    /**
     * Registers a new Stellar wallet for a user.
     * Generates, encrypts, and stores the keys in UserWallet table.
     */
    async registerUserWallet(userId: string) {
        try {
            // Check if user already has a wallet
            const existingWallet = await prisma.userWallet.findUnique({
                where: { userId }
            });

            if (existingWallet) {
                throw new Error('User already has a registered wallet.');
            }

            const keypair = this.generateWallet();
            const publicKey = keypair.publicKey();
            const secretKey = keypair.secret();

            // Encrypt secret key
            const encryptedSecretKey = encryptionService.encrypt(secretKey);

            // Store in database
            const wallet = await prisma.userWallet.create({
                data: {
                    userId,
                    publicKey,
                    encryptedSecretKey,
                    encryptionVersion: 1 // Initial version
                }
            });

            // Update user with primary wallet address if not set
            await prisma.user.update({
                where: { id: userId },
                data: { walletAddress: publicKey }
            });

            return {
                id: wallet.id,
                publicKey: wallet.publicKey,
                createdAt: wallet.createdAt
            };
        } catch (error: any) {
            console.error('Wallet registration failed:', error.message);
            throw new Error('Failed to register user wallet safely.');
        }
    }

    /**
     * Retrieves the public key for a user.
     */
    async getPublicKey(userId: string): Promise<string | null> {
        const wallet = await prisma.userWallet.findUnique({
            where: { userId },
            select: { publicKey: true }
        });
        return wallet?.publicKey || null;
    }
}

export default new StellarWalletService();
