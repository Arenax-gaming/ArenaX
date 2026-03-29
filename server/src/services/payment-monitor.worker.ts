import { getDatabaseClient } from './database.service';
import { TxStatus } from '@prisma/client';
import stellarTxService from './stellar-tx.service';

export class PaymentMonitorWorker {
    private readonly MAX_RETRIES = 5;
    private readonly INITIAL_BACKOFF_MS = 60000; // 1 minute

    /**
     * Poll and process pending payments.
     */
    async processPendingPayments(): Promise<void> {
        const prisma = getDatabaseClient();
        const now = new Date();

        // Find payments that are PENDING and (nextRetryAt is null OR nextRetryAt <= now)
        const pendingPayments = await prisma.payment.findMany({
            where: {
                status: 'PENDING',
                OR: [
                    { nextRetryAt: null },
                    { nextRetryAt: { lte: now } }
                ]
            },
            take: 50
        });

        console.info(`Found ${pendingPayments.length} pending payments to reconcile.`);

        for (const payment of pendingPayments) {
            await this.reconcilePayment(payment);
        }
    }

    /**
     * Reconcile a single payment with external status.
     */
    private async reconcilePayment(payment: any): Promise<void> {
        const prisma = getDatabaseClient();
        
        try {
            // If no txHash, we can't reconcile
            if (!payment.txHash) {
                console.warn(`Payment ${payment.id} has no txHash. Marking as FAILED.`);
                await this.markAsFailed(payment.id, 'Missing transaction hash.');
                return;
            }

            // In a real scenario, we'd check the blockchain or payment provider
            // For this implementation, we simulate a check
            const status = await this.checkExternalStatus(payment.txHash);

            if (status === 'SUCCESS') {
                await prisma.payment.update({
                    where: { id: payment.id },
                    data: { status: 'COMPLETED', updatedAt: new Date() }
                });
                console.info(`Payment ${payment.id} marked as COMPLETED.`);
            } else if (status === 'FAILED') {
                await this.markAsFailed(payment.id, 'External transaction failed.');
            } else {
                // Still pending, increment retry
                await this.handleRetry(payment);
            }
        } catch (error: any) {
            console.error(`Error reconciling payment ${payment.id}:`, error.message);
            await this.handleRetry(payment, error.message);
        }
    }

    /**
     * Simulate an external status check.
     */
    private async checkExternalStatus(txHash: string): Promise<'SUCCESS' | 'FAILED' | 'PENDING'> {
        // Logic to check Stellar Horizon or other provider
        // For demonstration/tests, we can mock this or use stellarTxService (if it had a status check)
        return 'PENDING'; // Default to pending for simulation
    }

    private async handleRetry(payment: any, error?: string): Promise<void> {
        const prisma = getDatabaseClient();
        const retryCount = payment.retryCount + 1;

        if (retryCount >= this.MAX_RETRIES) {
            console.error(`Payment ${payment.id} exceeded max retries. Moving to DEAD_LETTER.`);
            await prisma.payment.update({
                where: { id: payment.id },
                data: {
                    status: 'DEAD_LETTER',
                    lastError: error || 'Max retries exceeded.',
                    updatedAt: new Date()
                }
            });
            return;
        }

        // Exponential backoff with jitter
        const backoffMs = this.INITIAL_BACKOFF_MS * Math.pow(2, retryCount - 1);
        const jitter = Math.random() * 5000;
        const nextRetryAt = new Date(Date.now() + backoffMs + jitter);

        await prisma.payment.update({
            where: { id: payment.id },
            data: {
                retryCount,
                nextRetryAt,
                lastError: error,
                updatedAt: new Date()
            }
        });

        console.info(`Payment ${payment.id} scheduled for retry at ${nextRetryAt.toISOString()} (Attempt ${retryCount}).`);
    }

    private async markAsFailed(id: string, reason: string): Promise<void> {
        const prisma = getDatabaseClient();
        await prisma.payment.update({
            where: { id: id },
            data: {
                status: 'FAILED',
                lastError: reason,
                updatedAt: new Date()
            }
        });
    }
}

export default new PaymentMonitorWorker();
