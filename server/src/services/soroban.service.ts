import {
    TransactionBuilder,
    Transaction,
    FeeBumpTransaction,
    SorobanRpc,
    Networks,
    Account,
    Keypair,
    BASE_FEE,
    xdr,
    Address,
    nativeToScVal,
} from '@stellar/stellar-sdk';
import prisma from './database.service';
import sorobanRpcService from './soroban-rpc.service';
import stellarSigningService from './stellar-signing.service';
import { TxStatus } from '@prisma/client';

const NETWORK_PASSPHRASE =
    process.env.STELLAR_NETWORK === 'MAINNET'
        ? Networks.PUBLIC
        : Networks.TESTNET;

const TX_TIMEOUT_SECONDS = 300;

export interface ContractCallParams {
    contractId: string;
    functionName: string;
    args?: any[];
    userId?: string;          // if set, user signs; otherwise fee payer signs alone
    sponsored?: boolean;      // wrap in FeeBump for gasless UX
    type?: string;            // label for BlockchainTransaction table
}

export interface SimulationResult {
    viable: boolean;
    error?: string;
    minResourceFee?: string;
}

/**
 * SorobanService
 * Generic orchestration layer: build → simulate → sign → submit → monitor.
 */
export class SorobanService {
    private rpc = sorobanRpcService.getClient();

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Simulate a contract call without submitting.
     * Returns viability + estimated resource fee.
     */
    async simulate(params: ContractCallParams): Promise<SimulationResult> {
        try {
            const tx = await this._buildUnsignedTx(params);
            const result = await this.rpc.simulateTransaction(tx);

            if (SorobanRpc.Api.isSimulationSuccess(result)) {
                return {
                    viable: true,
                    minResourceFee: result.minResourceFee,
                };
            }

            const error = (result as SorobanRpc.Api.SimulateTransactionErrorResponse).error;
            return { viable: false, error };
        } catch (err: any) {
            return { viable: false, error: err.message };
        }
    }

    /**
     * Full pipeline: simulate → sign → submit → monitor.
     * Throws if simulation fails (prevents guaranteed-fail submissions).
     */
    async invokeContract(params: ContractCallParams): Promise<{ txHash: string }> {
        // 1. Build unsigned tx
        const rawTx = await this._buildUnsignedTx(params);

        // 2. Simulate & assemble (adds resource fees, auth entries)
        const simulation = await this.rpc.simulateTransaction(rawTx);
        if (!SorobanRpc.Api.isSimulationSuccess(simulation)) {
            const errMsg = (simulation as SorobanRpc.Api.SimulateTransactionErrorResponse).error;
            throw new Error(`Simulation failed — aborting submission: ${errMsg}`);
        }
        const assembled = SorobanRpc.assembleTransaction(rawTx, simulation);
        let tx: Transaction = (assembled as any).build
            ? (assembled as any).build()
            : (assembled as unknown as Transaction);

        // 3. Sign with user key (if userId provided)
        if (params.userId) {
            tx = (await stellarSigningService.signForUser(params.userId, tx)) as Transaction;
        }

        // 4. Optionally wrap in FeeBump for gasless UX
        let finalTx: Transaction | FeeBumpTransaction = tx;
        if (params.sponsored) {
            finalTx = await this._wrapFeeBump(tx);
        }

        const txHash = (finalTx as any).hash().toString('hex');

        // 5. Log as PENDING
        await this._logTx(txHash, params.userId, params.type ?? 'CONTRACT_INVOKE', TxStatus.PENDING, finalTx.toXDR());

        // 6. Submit to Soroban RPC
        try {
            const sendResult = await this.rpc.sendTransaction(finalTx);
            if (sendResult.status === 'ERROR') {
                const errXdr = sendResult.errorResultXdr ?? 'unknown';
                await this._updateTx(txHash, TxStatus.FAILED, errXdr);
                throw new Error(`Soroban submission error: ${errXdr}`);
            }
        } catch (err: any) {
            await this._updateTx(txHash, TxStatus.FAILED, err.message);
            throw err;
        }

        // 7. Monitor asynchronously (non-blocking)
        sorobanMonitorWorker.monitor(txHash).catch(() => {/* logged inside worker */});

        return { txHash };
    }

    /**
     * Get the current status of a submitted transaction.
     */
    async getTransactionStatus(txHash: string) {
        return prisma.blockchainTransaction.findUnique({ where: { txHash } });
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async _buildUnsignedTx(params: ContractCallParams): Promise<Transaction> {
        const { contractId, functionName, args = [], userId, sponsored } = params;

        // Source account: fee payer for sponsored, else user's wallet
        let sourcePublicKey: string;
        if (sponsored || !userId) {
            sourcePublicKey = process.env.FEE_PAYER_PUBLIC_KEY ?? '';
            if (!sourcePublicKey) throw new Error('FEE_PAYER_PUBLIC_KEY not configured');
        } else {
            const wallet = await prisma.userWallet.findUnique({ where: { userId } });
            if (!wallet) throw new Error(`No wallet for user ${userId}`);
            sourcePublicKey = wallet.publicKey;
        }

        const accountData = await this.rpc.getAccount(sourcePublicKey);
        const account = new Account(accountData.accountId(), accountData.sequenceNumber());

        const scArgs = args.map((a) => this._toScVal(a));

        return new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: NETWORK_PASSPHRASE,
        })
            .addOperation(
                // @ts-ignore — stellar-sdk types vary by version
                require('@stellar/stellar-sdk').Operation.invokeContractFunction({
                    contract: contractId,
                    function: functionName,
                    args: scArgs,
                })
            )
            .setTimeout(TX_TIMEOUT_SECONDS)
            .build();
    }

    private _toScVal(value: any): xdr.ScVal {
        if (typeof value === 'string' && /^[GC][A-Z2-7]{55}$/.test(value)) {
            return nativeToScVal(Address.fromString(value));
        }
        return nativeToScVal(value);
    }

    private async _wrapFeeBump(inner: Transaction): Promise<FeeBumpTransaction> {
        const feePayerPublicKey = process.env.FEE_PAYER_PUBLIC_KEY ?? '';
        if (!feePayerPublicKey) throw new Error('FEE_PAYER_PUBLIC_KEY not configured');

        const feeBump = TransactionBuilder.buildFeeBumpTransaction(
            feePayerPublicKey,
            '1000000',
            inner,
            NETWORK_PASSPHRASE,
        );
        return stellarSigningService.signAsFeePayer(feeBump);
    }

    private async _logTx(
        txHash: string,
        userId: string | undefined,
        type: string,
        status: TxStatus,
        xdrPayload: string,
    ) {
        await prisma.blockchainTransaction.upsert({
            where: { txHash },
            update: { status, updatedAt: new Date() },
            create: {
                txHash, userId, type, status,
                payload: { xdr: xdrPayload },
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        });
    }

    private async _updateTx(txHash: string, status: TxStatus, error?: string) {
        await prisma.blockchainTransaction.update({
            where: { txHash },
            data: { status, error, updatedAt: new Date() },
        });
    }
}

export const sorobanService = new SorobanService();

// ── Monitor Worker (upgraded) ─────────────────────────────────────────────────

export class SorobanMonitorWorker {
    private readonly MAX_RETRIES = 15;
    private readonly INITIAL_BACKOFF_MS = 1_000;
    private readonly MAX_BACKOFF_MS = 30_000;

    async monitor(txHash: string): Promise<void> {
        let attempt = 0;
        let backoff = this.INITIAL_BACKOFF_MS;
        const rpc = sorobanRpcService.getClient();

        while (attempt < this.MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, backoff));
            backoff = Math.min(backoff * 2, this.MAX_BACKOFF_MS);
            attempt++;

            try {
                const response = await rpc.getTransaction(txHash);

                if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
                    await this._update(txHash, TxStatus.SUCCESS);
                    return;
                }

                if (response.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
                    // Extract Soroban-specific error code from result XDR
                    const errorDetail = this._extractSorobanError(response);
                    await this._update(txHash, TxStatus.FAILED, errorDetail);
                    return;
                }

                // status === NOT_FOUND or PENDING — keep polling
            } catch (err: any) {
                // RPC error — keep retrying with backoff
                console.warn(`[monitor] poll error for ${txHash} (attempt ${attempt}): ${err.message}`);
            }
        }

        await this._update(txHash, TxStatus.FAILED, 'Transaction finality timeout after max retries');
    }

    private _extractSorobanError(response: any): string {
        try {
            if (response.resultXdr) {
                const txResult = xdr.TransactionResult.fromXDR(response.resultXdr, 'base64');
                const code = txResult.result().switch().name;
                return `Soroban error code: ${code}`;
            }
            if (response.resultMetaXdr) {
                return `resultMetaXdr: ${response.resultMetaXdr}`;
            }
        } catch {/* fall through */}
        return 'Soroban execution failed (no error XDR)';
    }

    private async _update(txHash: string, status: TxStatus, error?: string) {
        try {
            await prisma.blockchainTransaction.update({
                where: { txHash },
                data: { status, error, updatedAt: new Date() },
            });
        } catch (err) {
            console.error(`[monitor] DB update failed for ${txHash}:`, err);
        }
    }
}

export const sorobanMonitorWorker = new SorobanMonitorWorker();
