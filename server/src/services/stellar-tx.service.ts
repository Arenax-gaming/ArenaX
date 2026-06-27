import { Horizon, Transaction, FeeBumpTransaction, TransactionBuilder, Memo } from '@stellar/stellar-sdk';
import prisma from './database.service';
import { TxStatus } from '@prisma/client';
import stellarSigningService from './stellar-signing.service';
import { getCorrelationId } from './correlation.service';
import { logger } from './logger.service';

export class StellarTxService {
    private server: Horizon.Server;

    constructor() {
        const horizonUrl = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
        this.server = new Horizon.Server(horizonUrl);
    }

    /**
     * Submits a transaction to the Stellar network.
     * Supports sponsored transactions (Fee Payers).
     *
     * When a correlation ID is active, it is stored in the DB log record
     * as `metadata.correlationId` so cross-database auditing can link a
     * Stellar tx back to the originating HTTP request.
     *
     * Note: Stellar memos have a 28-byte limit (MEMO_TEXT). We store the
     * full correlation ID only in the DB metadata; a truncated tag is
     * added to MEMO_TEXT only if the transaction carries no existing memo.
     */
    async submitTransaction(
        tx: Transaction | FeeBumpTransaction,
        userId?: string,
        type: string = 'GENERIC_TX',
        options: { sponsored?: boolean } = {}
    ): Promise<any> {
        let finalTx = tx;
        let txHash: string = '';
        const correlationId = getCorrelationId();

        try {
            // 1. Inject correlation memo on plain Transactions (not FeeBump).
            if (correlationId && tx instanceof Transaction && tx.memo.type === 'none') {
                // MEMO_TEXT is capped at 28 bytes; use last 27 chars prefixed with 'c:'.
                const memoText = `c:${correlationId.slice(-26)}`;
                (tx as any).memo = Memo.text(memoText);
            }

            // 2. If sponsored, wrap in a FeeBumpTransaction
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

            // 3. Initial log as PENDING (includes correlationId in payload metadata)
            await this.logTransaction(txHash, userId, type, TxStatus.PENDING, finalTx.toXDR(), correlationId);

            // 4. Submit to Horizon
            const response = await this.server.submitTransaction(finalTx);

            // 5. Update to SUCCESS
            await this.updateTransactionStatus(txHash, TxStatus.SUCCESS);

            logger.info('Stellar transaction submitted', { txHash, type, userId, correlationId });

            return response;
        } catch (error: any) {
            const errorMsg = error.response?.data?.extras?.result_codes?.operations
                ? JSON.stringify(error.response.data.extras.result_codes)
                : error.message;

            logger.error(`Stellar transaction submission failed`, { txHash, errorMsg, correlationId });

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
        payloadXdr: string,
        correlationId?: string
    ) {
        await prisma.blockchainTransaction.upsert({
            where: { txHash },
            update: { status, updatedAt: new Date() },
            create: {
                txHash,
                userId,
                type,
                status,
                payload: { xdr: payloadXdr, ...(correlationId ? { correlationId } : {}) },
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
