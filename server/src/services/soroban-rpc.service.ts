import { SorobanRpc } from '@stellar/stellar-sdk';

export class SorobanRpcService {
    private client: SorobanRpc.Server;
    private readonly rpcUrls: string[];
    private currentRpcIndex: number = 0;

    constructor() {
        const primaryRpc = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
        // Allow comma-separated failover endpoints
        const failovers = process.env.SOROBAN_RPC_FAILOVERS?.split(',') || [];
        this.rpcUrls = [primaryRpc, ...failovers].filter(Boolean);

        this.client = new SorobanRpc.Server(this.rpcUrls[0]);
    }

    /**
     * Gets the current Soroban RPC client.
     */
    getClient(): SorobanRpc.Server {
        return this.client;
    }

    /**
     * Verifies connectivity to the Soroban RPC server.
     * Attempts to failover if primary is down.
     */
    async checkHealth(): Promise<{ status: string; url: string; ledger?: number }> {
        for (let i = 0; i < this.rpcUrls.length; i++) {
            const url = this.rpcUrls[this.currentRpcIndex];
            try {
                const health = await this.client.getHealth();
                if (health.status === 'healthy') {
                    const latestLedger = await this.client.getLatestLedger();
                    return {
                        status: 'healthy',
                        url,
                        ledger: latestLedger.sequence
                    };
                }
            } catch (error) {
                console.warn(`Soroban RPC Error [${url}]:`, error instanceof Error ? error.message : error);
                this.rotateRpc();
            }
        }

        throw new Error('All Soroban RPC endpoints are unreachable or unhealthy.');
    }

    /**
     * Rotates to the next available RPC endpoint.
     */
    private rotateRpc() {
        this.currentRpcIndex = (this.currentRpcIndex + 1) % this.rpcUrls.length;
        this.client = new SorobanRpc.Server(this.rpcUrls[this.currentRpcIndex]);
        console.info(`Rotated Soroban RPC to: ${this.rpcUrls[this.currentRpcIndex]}`);
    }
}

export default new SorobanRpcService();
