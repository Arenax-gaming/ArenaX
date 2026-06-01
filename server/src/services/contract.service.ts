import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';

export class ContractService {
  private rpc: SorobanRpc.Server;
  private networkPassphrase: string;

  constructor() {
    const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
    this.rpc = new SorobanRpc.Server(rpcUrl);
    this.networkPassphrase =
      process.env.STELLAR_NETWORK === 'MAINNET'
        ? Networks.PUBLIC
        : Networks.TESTNET;
  }

  async readContractData(contractId: string, method: string, args: any[] = []): Promise<any> {
    const contract = new Contract(contractId);
    const scArgs = args.map(a => nativeToScVal(a));

    const result = await this.rpc.simulateTransaction(
      new TransactionBuilder(undefined as any, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call(method, ...scArgs))
        .setTimeout(0)
        .build(),
    );

    if (SorobanRpc.Api.isSimulationSuccess(result)) {
      return result.result ?? null;
    }
    throw new Error(`Contract simulation failed: ${(result as any).error}`);
  }

  async getEventsByContractId(contractId: string, startLedger: number, limit: number = 100) {
    return this.rpc.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: [contractId] }],
      limit,
    });
  }
}

export default new ContractService();
