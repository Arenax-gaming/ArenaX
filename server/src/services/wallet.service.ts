import { PrismaClient, Prisma, $Enums } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createClient, RedisClientType } from 'redis';

export class WalletService {
    private prisma = new PrismaClient();
    private redis: RedisClientType | null = null;

    private balanceField(currency: $Enums.Currency) {
        if (currency === 'NGN') return 'balanceNGN' as const;
        if (currency === 'USDC') return 'balanceUSDC' as const;
        return 'balanceXLM' as const;
    }

    private escrowField(currency: $Enums.Currency) {
        if (currency === 'NGN') return 'escrowNGN' as const;
        if (currency === 'USDC') return 'escrowUSDC' as const;
        return 'escrowXLM' as const;
    }

    private async ensureRedis() {
        if (!this.redis) {
            const url = process.env.REDIS_URL || 'redis://localhost:6379';
            this.redis = createClient({ url });
            await this.redis.connect();
        }
        return this.redis!;
    }

    private async publishBalance(userId: string) {
        const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
        if (!wallet) return;
        const redis = await this.ensureRedis();
        const payload = {
            userId,
            balances: {
                NGN: wallet.balanceNGN.toString(),
                USDC: wallet.balanceUSDC.toString(),
                XLM: wallet.balanceXLM.toString(),
            },
            escrow: {
                NGN: wallet.escrowNGN.toString(),
                USDC: wallet.escrowUSDC.toString(),
                XLM: wallet.escrowXLM.toString(),
            },
            ts: Date.now(),
        };
        await redis.publish(`wallet:${userId}:update`, JSON.stringify(payload));
    }

    /**
     * Get or create a wallet for a user.
     */
    async getOrCreateWallet(userId: string) {
        const existing = await this.prisma.wallet.findUnique({ where: { userId } });
        if (existing) return existing;
        const created = await this.prisma.wallet.create({
            data: {
                userId,
                balanceNGN: new Decimal(0),
                balanceUSDC: new Decimal(0),
                balanceXLM: new Decimal(0),
                escrowNGN: new Decimal(0),
                escrowUSDC: new Decimal(0),
                escrowXLM: new Decimal(0),
            },
        });
        await this.publishBalance(userId);
        return created;
    }

    async addBalance(userId: string, currency: $Enums.Currency, amount: Decimal | number | string, reference?: string, metadata?: any) {
        const amt = new Decimal(amount as any);
        if (amt.lte(0)) throw new Error('amount must be positive');
        const field = this.balanceField(currency);
        const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const wallet = await tx.wallet.upsert({
                where: { userId },
                update: {},
                create: { userId },
            });
            const updated = await tx.wallet.update({
                where: { id: wallet.id },
                data: { [field]: { increment: amt } },
            });
            const txn = await tx.walletTransaction.create({
                data: {
                    walletId: updated.id,
                    userId,
                    currency,
                    type: 'CREDIT',
                    amount: amt,
                    status: 'SUCCESS',
                    reference,
                    metadata,
                },
            });
            return { updated, txn };
        });
        await this.publishBalance(userId);
        return result.txn;
    }

    async deductBalance(userId: string, currency: $Enums.Currency, amount: Decimal | number | string, reference?: string, metadata?: any) {
        const amt = new Decimal(amount as any);
        if (amt.lte(0)) throw new Error('amount must be positive');
        const field = this.balanceField(currency);
        const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const wallet = await tx.wallet.findUnique({ where: { userId } });
            if (!wallet) throw new Error('wallet not found');
            const current = new Decimal((wallet as any)[field] as any);
            if (current.lt(amt)) throw new Error('insufficient balance');
            const updated = await tx.wallet.update({
                where: { id: wallet.id },
                data: { [field]: { decrement: amt } },
            });
            const txn = await tx.walletTransaction.create({
                data: {
                    walletId: updated.id,
                    userId,
                    currency,
                    type: 'DEBIT',
                    amount: amt,
                    status: 'SUCCESS',
                    reference,
                    metadata,
                },
            });
            return { updated, txn };
        });
        await this.publishBalance(userId);
        return result.txn;
    }

    async lockFundsToEscrow(userId: string, currency: $Enums.Currency, amount: Decimal | number | string, matchId: string, reference?: string, metadata?: any) {
        const amt = new Decimal(amount as any);
        if (amt.lte(0)) throw new Error('amount must be positive');
        const balField = this.balanceField(currency);
        const escField = this.escrowField(currency);
        const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const wallet = await tx.wallet.findUnique({ where: { userId } });
            if (!wallet) throw new Error('wallet not found');
            const current = new Decimal((wallet as any)[balField] as any);
            if (current.lt(amt)) throw new Error('insufficient balance');
            const updated = await tx.wallet.update({
                where: { id: wallet.id },
                data: {
                    [balField]: { decrement: amt },
                    [escField]: { increment: amt },
                },
            });
            const esc = await tx.escrow.create({
                data: {
                    matchId,
                    userId,
                    walletId: updated.id,
                    currency,
                    amount: amt,
                    status: 'LOCKED',
                },
            });
            const txn = await tx.walletTransaction.create({
                data: {
                    walletId: updated.id,
                    userId,
                    currency,
                    type: 'LOCK',
                    amount: amt,
                    status: 'SUCCESS',
                    reference,
                    metadata,
                    matchId,
                },
            });
            return { esc, txn };
        });
        await this.publishBalance(userId);
        return result.esc;
    }

    async releaseEscrow(matchId: string) {
        const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const escrows = await tx.escrow.findMany({
                where: { matchId, status: 'LOCKED' },
                include: { wallet: true },
            });
            for (const e of escrows as any[]) {
                const balField = this.balanceField(e.currency);
                const escField = this.escrowField(e.currency);
                await tx.wallet.update({
                    where: { id: e.walletId },
                    data: {
                        [escField]: { decrement: e.amount },
                        [balField]: { increment: e.amount },
                    },
                });
                await tx.walletTransaction.create({
                    data: {
                        walletId: e.walletId,
                        userId: e.userId,
                        currency: e.currency,
                        type: 'RELEASE',
                        amount: e.amount,
                        status: 'SUCCESS',
                        matchId,
                    },
                });
                await tx.escrow.update({
                    where: { id: e.id },
                    data: { status: 'RELEASED', releasedAt: new Date() },
                });
            }
            return escrows.map((e: any) => e.userId);
        });
        const uniqueUsers = Array.from(new Set<string>(result as string[]));
        await Promise.all(uniqueUsers.map(u => this.publishBalance(u)));
        return true;
    }

    async slashEscrow(matchId: string) {
        const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const escrows = await tx.escrow.findMany({
                where: { matchId, status: 'LOCKED' },
            });
            for (const e of escrows as any[]) {
                const escField = this.escrowField(e.currency);
                await tx.wallet.update({
                    where: { id: e.walletId },
                    data: { [escField]: { decrement: e.amount } },
                });
                await tx.walletTransaction.create({
                    data: {
                        walletId: e.walletId,
                        userId: e.userId,
                        currency: e.currency,
                        type: 'SLASH',
                        amount: e.amount,
                        status: 'SUCCESS',
                        matchId,
                    },
                });
                await tx.escrow.update({
                    where: { id: e.id },
                    data: { status: 'SLASHED', releasedAt: new Date() },
                });
            }
            return escrows.map((e: any) => e.userId);
        });
        const uniqueUsers = Array.from(new Set<string>(result as string[]));
        await Promise.all(uniqueUsers.map(u => this.publishBalance(u)));
        return true;
    }
}
