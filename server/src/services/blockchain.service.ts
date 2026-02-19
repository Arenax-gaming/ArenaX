import { Horizon, Networks, Asset } from '@stellar/stellar-sdk';

export class BlockchainService {
    private server: Horizon.Server;

    constructor() {
        const horizonUrl = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
        this.server = new Horizon.Server(horizonUrl);
    }

    // TODO: Implement native Stellar payment logic
    async getAccountBalance(address: string) {
        return this.server.accounts().accountId(address).call();
    }
}

export default new BlockchainService();
