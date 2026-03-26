import prisma from './database.service';
import sorobanRpcService from './soroban-rpc.service';
import { TxStatus } from '@prisma/client';

export class SorobanMonitorWorker {
    private readonly MAX_RETRIES = 12;
    private readonly INITIAL_BACKOFF_MS = 1000;

    /**
     * Polls for the status of a Soroban transaction until finality or timeout.
     */
    async monitor(txHash: string): Promise<void> {
        let retryCount = 0;
        let currentBackoff = this.INITIAL_BACKOFF_MS;

        console.info(`Starting monitor for tx: ${txHash}`);

        while (retryCount < this.MAX_RETRIES) {
            try {
                const response = await sorobanRpcService.getClient().getTransaction(txHash);

                if (response.status === 'SUCCESS') {
                    console.info(`Transaction confirmed: ${txHash}`);
                    await this.updateStatus(txHash, TxStatus.SUCCESS);
                    return;
                } else if (response.status === 'FAILED') {
                    const error = (response as any).resultErrorXdr?.toString() || 'Soroban execution failed.';
                    console.error(`Transaction failed: ${txHash}`, error);
                    await this.updateStatus(txHash, TxStatus.FAILED, error);
                    return;
                }
            } catch (error: any) {
                console.warn(`Polling error for ${txHash} (attempt ${retryCount + 1}):`, error.message);
            }

            await new Promise(resolve => setTimeout(resolve, currentBackoff));

            retryCount++;
            currentBackoff *= 2;
        }

        console.error(`Transaction monitoring timed out: ${txHash}`);
        await this.updateStatus(txHash, TxStatus.FAILED, 'Transaction finality timeout.');
    }

    private async updateStatus(txHash: string, status: TxStatus, error?: string) {
        try {
            await prisma.blockchainTransaction.update({
                where: { txHash },
                data: { status, error, updatedAt: new Date() }
            });
        } catch (dbError) {
            console.error('Failed to update monitored transaction in DB:', txHash, dbError);
        }
    }
}

export default new SorobanMonitorWorker();
