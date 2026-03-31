import {
    FeeBumpTransaction,
    Keypair,
    Transaction
} from '@stellar/stellar-sdk';
import stellarWalletService, {
    WalletAccessContext
} from './stellar-wallet.service';

export class StellarSigningService {
    async signForUser(
        userId: string,
        tx: Transaction | FeeBumpTransaction,
        context: WalletAccessContext = {}
    ): Promise<Transaction | FeeBumpTransaction> {
        const decrypted = await stellarWalletService.decryptSecretForUser(
            userId,
            'SIGN',
            {
                ...context,
                actorUserId: context.actorUserId ?? userId,
                reason: context.reason || 'User wallet retrieved for Stellar transaction signing'
            }
        );

        const keypair = Keypair.fromSecret(decrypted.secretKey);
        tx.sign(keypair);
        return tx;
    }

    async signAsFeePayer(tx: FeeBumpTransaction): Promise<FeeBumpTransaction> {
        const feePayerSecret = process.env.FEE_PAYER_SECRET_KEY;
        if (!feePayerSecret) {
            throw new Error('FEE_PAYER_SECRET_KEY is not configured.');
        }

        const keypair = Keypair.fromSecret(feePayerSecret);
        tx.sign(keypair);
        return tx;
    }
}

export default new StellarSigningService();
