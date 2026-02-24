import { Transaction, FeeBumpTransaction, SorobanRpc } from '@stellar/stellar-sdk';
import sorobanRpcService from './soroban-rpc.service';

/**
 * SorobanSimulationService
 * Responsible for predicting resource consumption and suggesting resource fees.
 */
export class SorobanSimulationService {
    /**
     * Simulates a transaction and returns suggested resource adjustments.
     */
    async simulateAndAdjust(tx: Transaction | FeeBumpTransaction): Promise<Transaction | FeeBumpTransaction> {
        try {
            const client = sorobanRpcService.getClient();
            const simulation = await client.simulateTransaction(tx);

            if (SorobanRpc.Api.isSimulationSuccess(simulation)) {
                console.info('Simulation successful, adjusting resource fees...');

                // Construct adjusted transaction
                const response = SorobanRpc.assembleTransaction(tx, simulation);

                // assembleTransaction returns a TransactionBuilder or Transaction depending on the SDK version
                const finalTx = (response as any).build ? (response as any).build() : response;
                return finalTx as Transaction | FeeBumpTransaction;
            } else {
                const errorMsg = (simulation as any).error || 'Simulation failed without specific error.';
                throw new Error(`Transaction simulation failed: ${errorMsg}`);
            }
        } catch (error: any) {
            console.error('Simulation error:', error.message);
            throw new Error(`Reliability Layer: ${error.message}`);
        }
    }

    async isViable(tx: Transaction | FeeBumpTransaction): Promise<boolean> {
        try {
            const client = sorobanRpcService.getClient();
            const result = await client.simulateTransaction(tx);
            return SorobanRpc.Api.isSimulationSuccess(result);
        } catch {
            return false;
        }
    }
}

export default new SorobanSimulationService();
