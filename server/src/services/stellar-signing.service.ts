import { Transaction, Keypair, FeeBumpTransaction } from '@stellar/stellar-sdk';
import prisma from './database.service';
import encryptionService from './encryption.service';

/**
 * StellarSigningService
 * Specialized service for signing transactions and fee bumps.
 * Ensures secret keys are only decrypted in memory at the moment of signing.
 */
export class StellarSigningService {
    /**
     * Signs a transaction or fee bump transaction for a specific user.
     */
    async signForUser(userId: string, tx: Transaction | FeeBumpTransaction): Promise<Transaction | FeeBumpTransaction> {
        try {
            const wallet = await prisma.userWallet.findUnique({
                where: { userId }
            });

            if (!wallet) {
                throw new Error(`No wallet found for user: ${userId}`);
            }

            // Decrypt the secret key
            const secretKey = encryptionService.decrypt(wallet.encryptedSecretKey);
            const keypair = Keypair.fromSecret(secretKey);

            // Sign the transaction
            tx.sign(keypair);

            return tx;
        } catch (error: any) {
            console.error(`Signing failed for user ${userId}:`, this.maskSecret(error.message));
            throw new Error('Transaction signing failed securely.');
        }
    }

    /**
     * Signs a transaction with the system's fee payer account.
     * Uses FEE_PAYER_SECRET_KEY from environment variables.
     */
    async signAsFeePayer(tx: FeeBumpTransaction): Promise<FeeBumpTransaction> {
        try {
            const feePayerSecret = process.env.FEE_PAYER_SECRET_KEY;
            if (!feePayerSecret) {
                throw new Error('FEE_PAYER_SECRET_KEY is not configured.');
            }

            const keypair = Keypair.fromSecret(feePayerSecret);
            tx.sign(keypair);

            return tx;
        } catch (error: any) {
            console.error('Fee payer signing failed:', this.maskSecret(error.message));
            throw new Error('Fee payer signing failed.');
        }
    }

    /**
     * Helper to mask any accidentally logged secrets.
     */
    private maskSecret(errorMsg: string): string {
        return errorMsg.replace(/S[A-Z2-7]{55}/g, '[REDACTED_KEY]');
    }
}

export default new StellarSigningService();
