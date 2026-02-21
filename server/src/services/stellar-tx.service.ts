import { Horizon, Transaction, FeeBumpTransaction, TransactionBuilder } from '@stellar/stellar-sdk';
import prisma from './database.service';
import { TxStatus } from '@prisma/client';
import stellarSigningService from './stellar-signing.service';

export class StellarTxService {
    private server: Horizon.Server;

    constructor() {
        const horizonUrl = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
        this.server = new Horizon.Server(horizonUrl);
    }

    /**
     * Submits a transaction to the Stellar network.
     * Supports sponsored transactions (Fee Payers).
     */
    async submitTransaction(
        tx: Transaction | FeeBumpTransaction,
        userId?: string,
        type: string = 'GENERIC_TX',
        options: { sponsored?: boolean } = {}
    ): Promise<any> {
        let finalTx = tx;
        let txHash: string = '';

        try {
            // 1. If sponsored, wrap in a FeeBumpTransaction
            if (options.sponsored && !(tx instanceof FeeBumpTransaction)) {
                finalTx = TransactionBuilder.buildFeeBumpTransaction(
                    process.env.FEE_PAYER_PUBLIC_KEY || '',
                    '1000000',
                    tx as Transaction,
                    process.env.STELLAR_NETWORK === 'TESTNET'
                        ? 'Test SDF Network ; September 2015'
                        : 'Public Global Stellar Network ; September 2015'
                );

                // Sign as fee payer
                finalTx = await stellarSigningService.signAsFeePayer(finalTx as FeeBumpTransaction);
            }

            txHash = (finalTx as any).hash().toString('hex');

            // 2. Initial log as PENDING
            await this.logTransaction(txHash, userId, type, TxStatus.PENDING, finalTx.toXDR());

            // 3. Submit to Horizon
            const response = await this.server.submitTransaction(finalTx);

            // 4. Update to SUCCESS
            await this.updateTransactionStatus(txHash, TxStatus.SUCCESS);

            return response;
        } catch (error: any) {
            const errorMsg = error.response?.data?.extras?.result_codes?.operations
                ? JSON.stringify(error.response.data.extras.result_codes)
                : error.message;

            console.error(`Transaction submission failed [${txHash}]:`, errorMsg);

            if (txHash) {
                await this.updateTransactionStatus(txHash, TxStatus.FAILED, errorMsg);
            }

            throw error;
        }
    }

    private async logTransaction(
        txHash: string,
        userId: string | undefined,
        type: string,
        status: TxStatus,
        payloadXdr: string
    ) {
        await prisma.blockchainTransaction.upsert({
            where: { txHash },
            update: { status, updatedAt: new Date() },
            create: {
                txHash,
                userId,
                type,
                status,
                payload: { xdr: payloadXdr },
                createdAt: new Date(),
                updatedAt: new Date()
            }
        });
    }

    private async updateTransactionStatus(txHash: string, status: TxStatus, error?: string) {
        await prisma.blockchainTransaction.update({
            where: { txHash },
            data: {
                status,
                error,
                updatedAt: new Date()
            }
        });
    }
}

export default new StellarTxService();
