import { Decimal } from '@prisma/client/runtime/library';
import { Currency, TransactionType } from '@prisma/client';
import { getDatabaseClient } from './database.service';
import { HttpError } from '../utils/http-error';

type LedgerBalanceKey = 'xlmBalance' | 'usdcBalance' | 'axBalance';
type LedgerEscrowKey  = 'xlmEscrowed' | 'usdcEscrowed' | 'axEscrowed';

function balanceKey(currency: Currency): LedgerBalanceKey {
    return `${currency.toLowerCase()}Balance` as LedgerBalanceKey;
}

function escrowKey(currency: Currency): LedgerEscrowKey {
    return `${currency.toLowerCase()}Escrowed` as LedgerEscrowKey;
}

export class WalletService {
    private db = getDatabaseClient();

    /** Get or create the ledger row for a user. */
    async getOrCreateLedger(userId: string) {
        return this.db.$transaction(async (tx) => {
            const existing = await (tx as any).ledger.findUnique({ where: { userId } });
            if (existing) return existing;
            return (tx as any).ledger.create({ data: { userId } });
        });
    }

    /**
     * Credit a user's balance (e.g. deposit, prize).
     * Idempotent: duplicate idempotencyKey is a no-op returning the original tx.
     */
    async credit(
        userId: string,
        currency: Currency,
        amount: Decimal,
        idempotencyKey: string,
        note?: string,
    ) {
        return this._applyTransaction(userId, currency, amount, idempotencyKey, TransactionType.CREDIT, note);
    }

    /**
     * Debit a user's available balance (e.g. withdrawal).
     * Idempotent: duplicate idempotencyKey is a no-op.
     */
    async debit(
        userId: string,
        currency: Currency,
        amount: Decimal,
        idempotencyKey: string,
        note?: string,
    ) {
        return this._applyTransaction(userId, currency, amount, idempotencyKey, TransactionType.DEBIT, note);
    }

    /**
     * Lock funds into escrow for a match.
     * Moves `amount` from available balance → escrowed balance atomically.
     */
    async lockFundsToEscrow(
        userId: string,
        currency: Currency,
        amount: Decimal,
        matchId: string,
        idempotencyKey: string,
    ) {
        return this.db.$transaction(async (tx) => {
            const existing = await (tx as any).walletTransaction.findUnique({ where: { idempotencyKey } });
            if (existing) return existing;

            const ledger = await this._getOrCreateLedgerTx(tx, userId);
            const bKey = balanceKey(currency);
            const eKey = escrowKey(currency);
            const available: Decimal = ledger[bKey];
            const escrowed: Decimal  = ledger[eKey];

            if (available.lessThan(amount)) {
                throw new HttpError(400, `Insufficient ${currency} balance for escrow`);
            }

            const newBalance = available.minus(amount);
            const newEscrow  = escrowed.plus(amount);

            await (tx as any).ledger.update({
                where: { userId },
                data: { [bKey]: newBalance, [eKey]: newEscrow },
            });

            return (tx as any).walletTransaction.create({
                data: {
                    userId,
                    idempotencyKey,
                    type: TransactionType.ESCROW_LOCK,
                    currency,
                    amount,
                    balanceBefore: available,
                    balanceAfter:  newBalance,
                    escrowBefore:  escrowed,
                    escrowAfter:   newEscrow,
                    matchId,
                },
            });
        });
    }

    /**
     * Release escrowed funds back to available balance (match cancelled / refund).
     */
    async releaseEscrow(
        userId: string,
        currency: Currency,
        amount: Decimal,
        matchId: string,
        idempotencyKey: string,
    ) {
        return this.db.$transaction(async (tx) => {
            const existing = await (tx as any).walletTransaction.findUnique({ where: { idempotencyKey } });
            if (existing) return existing;

            const ledger = await this._getOrCreateLedgerTx(tx, userId);
            const bKey = balanceKey(currency);
            const eKey = escrowKey(currency);
            const available: Decimal = ledger[bKey];
            const escrowed: Decimal  = ledger[eKey];

            if (escrowed.lessThan(amount)) {
                throw new HttpError(400, `Insufficient ${currency} escrowed funds to release`);
            }

            const newBalance = available.plus(amount);
            const newEscrow  = escrowed.minus(amount);

            await (tx as any).ledger.update({
                where: { userId },
                data: { [bKey]: newBalance, [eKey]: newEscrow },
            });

            return (tx as any).walletTransaction.create({
                data: {
                    userId,
                    idempotencyKey,
                    type: TransactionType.ESCROW_RELEASE,
                    currency,
                    amount,
                    balanceBefore: available,
                    balanceAfter:  newBalance,
                    escrowBefore:  escrowed,
                    escrowAfter:   newEscrow,
                    matchId,
                },
            });
        });
    }

    /**
     * Slash escrowed funds (penalty / forfeit). Funds are removed from escrow entirely.
     */
    async slashEscrow(
        userId: string,
        currency: Currency,
        amount: Decimal,
        matchId: string,
        idempotencyKey: string,
        note?: string,
    ) {
        return this.db.$transaction(async (tx) => {
            const existing = await (tx as any).walletTransaction.findUnique({ where: { idempotencyKey } });
            if (existing) return existing;

            const ledger = await this._getOrCreateLedgerTx(tx, userId);
            const bKey = balanceKey(currency);
            const eKey = escrowKey(currency);
            const available: Decimal = ledger[bKey];
            const escrowed: Decimal  = ledger[eKey];

            if (escrowed.lessThan(amount)) {
                throw new HttpError(400, `Insufficient ${currency} escrowed funds to slash`);
            }

            const newEscrow = escrowed.minus(amount);

            await (tx as any).ledger.update({
                where: { userId },
                data: { [eKey]: newEscrow },
            });

            return (tx as any).walletTransaction.create({
                data: {
                    userId,
                    idempotencyKey,
                    type: TransactionType.ESCROW_SLASH,
                    currency,
                    amount,
                    balanceBefore: available,
                    balanceAfter:  available,
                    escrowBefore:  escrowed,
                    escrowAfter:   newEscrow,
                    matchId,
                    note,
                },
            });
        });
    }

    /**
     * Internal transfer: debit from one user, credit another (platform fee / prize pool).
     * Both sides are recorded atomically with linked idempotency keys.
     */
    async internalTransfer(params: {
        fromUserId: string;
        toUserId: string;
        currency: Currency;
        amount: Decimal;
        type: TransactionType.PLATFORM_FEE | TransactionType.PRIZE_POOL_FUND;
        idempotencyKey: string;
        note?: string;
    }) {
        const { fromUserId, toUserId, currency, amount, type, idempotencyKey, note } = params;

        return this.db.$transaction(async (tx) => {
            // Idempotency: check if debit side already recorded
            const existing = await (tx as any).walletTransaction.findUnique({
                where: { idempotencyKey: `${idempotencyKey}:debit` },
            });
            if (existing) return existing;

            const bKey = balanceKey(currency);
            const eKey = escrowKey(currency);

            const fromLedger = await this._getOrCreateLedgerTx(tx, fromUserId);
            const toLedger   = await this._getOrCreateLedgerTx(tx, toUserId);

            const fromAvailable: Decimal = fromLedger[bKey];
            if (fromAvailable.lessThan(amount)) {
                throw new HttpError(400, `Insufficient ${currency} balance for transfer`);
            }

            const fromNewBalance = fromAvailable.minus(amount);
            const toAvailable: Decimal = toLedger[bKey];
            const toNewBalance = toAvailable.plus(amount);

            await (tx as any).ledger.update({
                where: { userId: fromUserId },
                data: { [bKey]: fromNewBalance },
            });
            await (tx as any).ledger.update({
                where: { userId: toUserId },
                data: { [bKey]: toNewBalance },
            });

            await (tx as any).walletTransaction.create({
                data: {
                    userId: fromUserId,
                    idempotencyKey: `${idempotencyKey}:debit`,
                    type,
                    currency,
                    amount,
                    balanceBefore: fromAvailable,
                    balanceAfter:  fromNewBalance,
                    escrowBefore:  fromLedger[eKey],
                    escrowAfter:   fromLedger[eKey],
                    note,
                },
            });

            return (tx as any).walletTransaction.create({
                data: {
                    userId: toUserId,
                    idempotencyKey: `${idempotencyKey}:credit`,
                    type: TransactionType.CREDIT,
                    currency,
                    amount,
                    balanceBefore: toAvailable,
                    balanceAfter:  toNewBalance,
                    escrowBefore:  toLedger[eKey],
                    escrowAfter:   toLedger[eKey],
                    note,
                },
            });
        });
    }

    /** Get full transaction history for a user. */
    async getTransactionHistory(userId: string, currency?: Currency) {
        return (this.db as any).walletTransaction.findMany({
            where: { userId, ...(currency ? { currency } : {}) },
            orderBy: { createdAt: 'desc' },
        });
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private async _getOrCreateLedgerTx(tx: any, userId: string) {
        const existing = await tx.ledger.findUnique({ where: { userId } });
        if (existing) return existing;
        return tx.ledger.create({ data: { userId } });
    }

    private async _applyTransaction(
        userId: string,
        currency: Currency,
        amount: Decimal,
        idempotencyKey: string,
        type: TransactionType.CREDIT | TransactionType.DEBIT,
        note?: string,
    ) {
        return this.db.$transaction(async (tx) => {
            const existing = await (tx as any).walletTransaction.findUnique({ where: { idempotencyKey } });
            if (existing) return existing;

            const ledger = await this._getOrCreateLedgerTx(tx, userId);
            const bKey = balanceKey(currency);
            const eKey = escrowKey(currency);
            const available: Decimal = ledger[bKey];
            const escrowed: Decimal  = ledger[eKey];

            if (type === TransactionType.DEBIT && available.lessThan(amount)) {
                throw new HttpError(400, `Insufficient ${currency} balance`);
            }

            const newBalance = type === TransactionType.CREDIT
                ? available.plus(amount)
                : available.minus(amount);

            await (tx as any).ledger.update({
                where: { userId },
                data: { [bKey]: newBalance },
            });

            return (tx as any).walletTransaction.create({
                data: {
                    userId,
                    idempotencyKey,
                    type,
                    currency,
                    amount,
                    balanceBefore: available,
                    balanceAfter:  newBalance,
                    escrowBefore:  escrowed,
                    escrowAfter:   escrowed,
                    note,
                },
            });
        });
    }
}

export const walletService = new WalletService();
