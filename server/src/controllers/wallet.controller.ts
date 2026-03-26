import { Request, Response, NextFunction } from 'express';
import { Decimal } from '@prisma/client/runtime/library';
import { Currency, TransactionType } from '@prisma/client';
import { walletService } from '../services/wallet.service';
import { HttpError } from '../utils/http-error';

export const getLedger = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) throw new HttpError(401, 'Unauthorized');
        const ledger = await walletService.getOrCreateLedger(userId);
        res.json(ledger);
    } catch (err) { next(err); }
};

export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) throw new HttpError(401, 'Unauthorized');
        const currency = req.query.currency as Currency | undefined;
        const txs = await walletService.getTransactionHistory(userId, currency);
        res.json(txs);
    } catch (err) { next(err); }
};

export const lockEscrow = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) throw new HttpError(401, 'Unauthorized');
        const { currency, amount, matchId, idempotencyKey } = req.body;
        const tx = await walletService.lockFundsToEscrow(
            userId, currency, new Decimal(amount), matchId, idempotencyKey,
        );
        res.status(201).json(tx);
    } catch (err) { next(err); }
};

export const releaseEscrow = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) throw new HttpError(401, 'Unauthorized');
        const { currency, amount, matchId, idempotencyKey } = req.body;
        const tx = await walletService.releaseEscrow(
            userId, currency, new Decimal(amount), matchId, idempotencyKey,
        );
        res.json(tx);
    } catch (err) { next(err); }
};

export const slashEscrow = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) throw new HttpError(401, 'Unauthorized');
        const { currency, amount, matchId, idempotencyKey, note } = req.body;
        const tx = await walletService.slashEscrow(
            userId, currency, new Decimal(amount), matchId, idempotencyKey, note,
        );
        res.json(tx);
    } catch (err) { next(err); }
};

export const internalTransfer = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { fromUserId, toUserId, currency, amount, type, idempotencyKey, note } = req.body;
        if (![TransactionType.PLATFORM_FEE, TransactionType.PRIZE_POOL_FUND].includes(type)) {
            throw new HttpError(400, 'Invalid transfer type');
        }
        const tx = await walletService.internalTransfer({
            fromUserId, toUserId, currency,
            amount: new Decimal(amount),
            type, idempotencyKey, note,
        });
        res.status(201).json(tx);
    } catch (err) { next(err); }
};
