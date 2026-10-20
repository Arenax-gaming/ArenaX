import {
    Asset,
    Horizon,
    Keypair,
    Networks,
    Operation,
    Transaction,
    TransactionBuilder,
    BASE_FEE,
} from '@stellar/stellar-sdk';
import { Prisma, PrizePayoutStatus } from '@prisma/client';
import prisma from './database.service';
import { logger } from './logger.service';

/**
 * Multi-signature policy for tournament prize pools (Issue #1214).
 *
 * The pool account's master key is disabled (weight 0) and two co-signers
 * — Admin and System — each carry weight 1. Every threshold is 2, so no
 * operation (payments, signer changes, merges) can be authorised without
 * both co-signers.
 */
export interface MultisigPolicy {
    masterWeight: number;
    adminWeight: number;
    systemWeight: number;
    lowThreshold: number;
    medThreshold: number;
    highThreshold: number;
}

export const PRIZE_POOL_MULTISIG_POLICY: MultisigPolicy = Object.freeze({
    masterWeight: 0,
    adminWeight: 1,
    systemWeight: 1,
    lowThreshold: 2,
    medThreshold: 2,
    highThreshold: 2,
});

export interface PayoutInstruction {
    destination: string;
    amount: string;
    assetCode?: string;
    assetIssuer?: string;
}

/** Returns the signer public keys (from `candidates`) that have validly signed `tx`. */
export function collectValidSigners(tx: Transaction, candidates: string[]): string[] {
    const hash = tx.hash();
    const signed = new Set<string>();
    for (const sig of tx.signatures) {
        const hint = sig.hint();
        const signature = sig.signature();
        for (const pk of candidates) {
            const kp = Keypair.fromPublicKey(pk);
            if (kp.signatureHint().equals(hint) && kp.verify(hash, signature)) {
                signed.add(pk);
            }
        }
    }
    return [...signed];
}

/** Sum of signer weights from the policy — must reach the medium threshold to pay out. */
export function meetsPayoutThreshold(
    signedBy: string[],
    adminSigner: string,
    systemSigner: string,
    policy: MultisigPolicy = PRIZE_POOL_MULTISIG_POLICY,
): boolean {
    let weight = 0;
    if (signedBy.includes(adminSigner)) weight += policy.adminWeight;
    if (signedBy.includes(systemSigner)) weight += policy.systemWeight;
    return weight >= policy.medThreshold;
}

export function validatePayouts(payouts: PayoutInstruction[]): void {
    if (!Array.isArray(payouts) || payouts.length === 0) {
        throw new Error('At least one payout is required');
    }
    if (payouts.length > 100) {
        throw new Error('A single payout transaction supports at most 100 recipients');
    }
    for (const p of payouts) {
        if (!p.destination || !/^G[A-Z2-7]{55}$/.test(p.destination)) {
            throw new Error(`Invalid destination: ${p.destination}`);
        }
        if (!/^\d+(\.\d{1,7})?$/.test(p.amount) || Number(p.amount) <= 0) {
            throw new Error(`Invalid amount: ${p.amount}`);
        }
        if (p.assetCode && p.assetCode !== 'XLM' && !p.assetIssuer) {
            throw new Error(`Asset ${p.assetCode} requires an issuer`);
        }
    }
}

function toAsset(code?: string, issuer?: string): Asset {
    return !code || code === 'XLM' ? Asset.native() : new Asset(code, issuer);
}

export class TournamentMultisigService {
    private server: Horizon.Server;
    private networkPassphrase: string;

    constructor(
        horizonUrl = process.env.STELLAR_HORIZON_URL || process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org',
        networkPassphrase = process.env.STELLAR_NETWORK === 'MAINNET' ? Networks.PUBLIC : Networks.TESTNET,
    ) {
        this.server = new Horizon.Server(horizonUrl);
        this.networkPassphrase = networkPassphrase;
    }

    private systemKeypair(): Keypair {
        const secret = process.env.STELLAR_PRIZE_SYSTEM_SECRET;
        if (!secret) throw new Error('STELLAR_PRIZE_SYSTEM_SECRET is not configured');
        return Keypair.fromSecret(secret);
    }

    private adminPublicKey(): string {
        const pk = process.env.STELLAR_PRIZE_ADMIN_PUBLIC_KEY;
        if (!pk) throw new Error('STELLAR_PRIZE_ADMIN_PUBLIC_KEY is not configured');
        return Keypair.fromPublicKey(pk).publicKey();
    }

    /**
     * Create and fund a fresh Stellar account for the tournament, then lock it
     * behind the Admin + System multisig policy in the same transaction.
     */
    async initializePrizePoolAccount(tournamentId: string) {
        const existing = await prisma.tournamentPrizeAccount.findUnique({ where: { tournamentId } });
        if (existing) return existing;

        const system = this.systemKeypair();
        const adminSigner = this.adminPublicKey();
        const pool = Keypair.random();
        const policy = PRIZE_POOL_MULTISIG_POLICY;

        const funder = await this.server.loadAccount(system.publicKey());
        const tx = new TransactionBuilder(funder, {
            fee: BASE_FEE,
            networkPassphrase: this.networkPassphrase,
        })
            .addOperation(
                Operation.createAccount({
                    destination: pool.publicKey(),
                    startingBalance: process.env.STELLAR_PRIZE_STARTING_BALANCE || '5',
                }),
            )
            .addOperation(
                Operation.setOptions({
                    source: pool.publicKey(),
                    signer: { ed25519PublicKey: adminSigner, weight: policy.adminWeight },
                }),
            )
            .addOperation(
                Operation.setOptions({
                    source: pool.publicKey(),
                    signer: { ed25519PublicKey: system.publicKey(), weight: policy.systemWeight },
                }),
            )
            .addOperation(
                Operation.setOptions({
                    source: pool.publicKey(),
                    masterWeight: policy.masterWeight,
                    lowThreshold: policy.lowThreshold,
                    medThreshold: policy.medThreshold,
                    highThreshold: policy.highThreshold,
                }),
            )
            .setTimeout(180)
            .build();

        // The pool's own master key signs once to configure itself; after this
        // transaction its weight is 0 and the secret is discarded.
        tx.sign(system, pool);
        const result = await this.server.submitTransaction(tx);

        const account = await prisma.tournamentPrizeAccount.create({
            data: {
                tournamentId,
                publicKey: pool.publicKey(),
                adminSigner,
                systemSigner: system.publicKey(),
                lowThreshold: policy.lowThreshold,
                medThreshold: policy.medThreshold,
                highThreshold: policy.highThreshold,
                creationTxHash: result.hash,
            },
        });

        logger.info('Tournament prize pool multisig account created', {
            tournamentId,
            publicKey: account.publicKey,
            txHash: result.hash,
        });
        return account;
    }

    async getPrizePool(tournamentId: string) {
        const account = await prisma.tournamentPrizeAccount.findUnique({
            where: { tournamentId },
            include: {
                deposits: { orderBy: { ledgerAt: 'desc' }, take: 50 },
                payouts: { orderBy: { createdAt: 'desc' }, take: 20 },
            },
        });
        if (!account) throw new Error('Prize pool account not found');

        const onChain = await this.server.loadAccount(account.publicKey);
        return { ...account, balances: onChain.balances, signers: onChain.signers, thresholds: onChain.thresholds };
    }

    /**
     * Pull incoming payments to the pool account from Horizon and record any
     * not yet seen. The Horizon paging cursor is persisted so repeated syncs
     * only fetch new operations.
     */
    async syncDeposits(tournamentId: string) {
        const account = await prisma.tournamentPrizeAccount.findUnique({ where: { tournamentId } });
        if (!account) throw new Error('Prize pool account not found');

        let cursor = account.depositCursor ?? undefined;
        let recorded = 0;
        let added = new Prisma.Decimal(0);

        for (;;) {
            let builder = this.server.payments().forAccount(account.publicKey).order('asc').limit(200);
            if (cursor) builder = builder.cursor(cursor);
            const page = await builder.call();
            if (page.records.length === 0) break;

            for (const op of page.records as any[]) {
                cursor = op.paging_token;
                if (op.type !== 'payment' || op.to !== account.publicKey) continue;

                const seen = await prisma.prizePoolDeposit.findUnique({ where: { operationId: op.id } });
                if (seen) continue;

                const amount = new Prisma.Decimal(op.amount);
                await prisma.prizePoolDeposit.create({
                    data: {
                        accountId: account.id,
                        operationId: op.id,
                        txHash: op.transaction_hash,
                        fromAccount: op.from,
                        amount,
                        assetCode: op.asset_type === 'native' ? 'XLM' : op.asset_code,
                        assetIssuer: op.asset_type === 'native' ? null : op.asset_issuer,
                        ledgerAt: new Date(op.created_at),
                    },
                });
                recorded += 1;
                added = added.plus(amount);
            }
            if (page.records.length < 200) break;
        }

        const updated = await prisma.tournamentPrizeAccount.update({
            where: { id: account.id },
            data: { depositCursor: cursor ?? null, totalDeposited: { increment: added } },
        });
        if (added.gt(0)) {
            await prisma.tournament.update({
                where: { id: tournamentId },
                data: { prizePool: { increment: added } },
            });
        }

        return { recorded, totalDeposited: updated.totalDeposited, cursor: updated.depositCursor };
    }

    /**
     * Build an unsigned payout transaction from the pool account, sign it with
     * the System co-signer and store it until the Admin co-signer approves.
     */
    async createPayoutRequest(tournamentId: string, payouts: PayoutInstruction[], requestedBy: string) {
        validatePayouts(payouts);
        const account = await prisma.tournamentPrizeAccount.findUnique({ where: { tournamentId } });
        if (!account) throw new Error('Prize pool account not found');

        const source = await this.server.loadAccount(account.publicKey);
        const builder = new TransactionBuilder(source, {
            fee: String(Number(BASE_FEE) * payouts.length),
            networkPassphrase: this.networkPassphrase,
        });
        for (const p of payouts) {
            builder.addOperation(
                Operation.payment({
                    destination: p.destination,
                    asset: toAsset(p.assetCode, p.assetIssuer),
                    amount: p.amount,
                }),
            );
        }
        // Long validity window so the admin has time to review and co-sign.
        const tx = builder.setTimeout(60 * 60 * 24).build();

        const system = this.systemKeypair();
        if (system.publicKey() !== account.systemSigner) {
            throw new Error('Configured system key does not match the pool system signer');
        }
        tx.sign(system);

        const request = await prisma.prizePayoutRequest.create({
            data: {
                accountId: account.id,
                envelopeXdr: tx.toXDR(),
                txHash: tx.hash().toString('hex'),
                payouts: payouts as unknown as Prisma.InputJsonValue,
                signedBy: [system.publicKey()],
                requestedBy,
            },
        });
        logger.info('Prize payout request created', { tournamentId, requestId: request.id, txHash: request.txHash });
        return request;
    }

    /**
     * Merge an Admin-signed envelope into the stored payout transaction. The
     * submitted envelope must be the identical transaction (same hash); only
     * signatures from the pool's registered co-signers are accepted. Once the
     * threshold is met the transaction is submitted to the network.
     */
    async addSignature(tournamentId: string, requestId: string, signedEnvelopeXdr: string) {
        const request = await prisma.prizePayoutRequest.findUnique({
            where: { id: requestId },
            include: { account: true },
        });
        if (!request || request.account.tournamentId !== tournamentId) {
            throw new Error('Payout request not found');
        }
        if (request.status === PrizePayoutStatus.SUBMITTED) {
            throw new Error('Payout already submitted');
        }

        const stored = TransactionBuilder.fromXDR(request.envelopeXdr, this.networkPassphrase) as Transaction;
        const incoming = TransactionBuilder.fromXDR(signedEnvelopeXdr, this.networkPassphrase) as Transaction;
        if (!stored.hash().equals(incoming.hash())) {
            throw new Error('Signed envelope does not match the payout transaction');
        }

        const candidates = [request.account.adminSigner, request.account.systemSigner];
        const newSigners = collectValidSigners(incoming, candidates);
        if (newSigners.length === 0) {
            throw new Error('Envelope carries no valid co-signer signature');
        }

        const existing = new Set(collectValidSigners(stored, candidates));
        for (const sig of incoming.signatures) {
            const hint = sig.hint();
            const fromCandidate = candidates.find((pk) => {
                const kp = Keypair.fromPublicKey(pk);
                return !existing.has(pk) && kp.signatureHint().equals(hint) && kp.verify(stored.hash(), sig.signature());
            });
            if (fromCandidate) {
                stored.signatures.push(sig);
                existing.add(fromCandidate);
            }
        }

        const signedBy = [...existing];
        const ready = meetsPayoutThreshold(signedBy, request.account.adminSigner, request.account.systemSigner);

        let updated = await prisma.prizePayoutRequest.update({
            where: { id: request.id },
            data: {
                envelopeXdr: stored.toXDR(),
                signedBy,
                status: ready ? PrizePayoutStatus.READY : PrizePayoutStatus.AWAITING_SIGNATURES,
            },
        });

        if (ready) {
            try {
                await this.server.submitTransaction(stored);
                updated = await prisma.prizePayoutRequest.update({
                    where: { id: request.id },
                    data: { status: PrizePayoutStatus.SUBMITTED, submittedAt: new Date(), error: null },
                });
                logger.info('Prize payout submitted', { tournamentId, requestId, txHash: request.txHash });
            } catch (error: any) {
                const message = error?.response?.data?.extras?.result_codes
                    ? JSON.stringify(error.response.data.extras.result_codes)
                    : String(error?.message ?? error);
                updated = await prisma.prizePayoutRequest.update({
                    where: { id: request.id },
                    data: { status: PrizePayoutStatus.FAILED, error: message },
                });
                logger.error('Prize payout submission failed', { tournamentId, requestId, error: message });
            }
        }

        return updated;
    }
}

export default new TournamentMultisigService();
