import { NextFunction, Request, Response } from 'express';
import { $Enums, Currency } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { z } from 'zod';
import stellarWalletService from '../services/stellar-wallet.service';
import walletRecoveryService from '../services/wallet-recovery.service';
import { walletService } from '../services/wallet.service';
import { HttpError } from '../utils/http-error';

const TransactionType = $Enums.TransactionType;

const parseBody = <T>(schema: z.ZodSchema<T>, body: unknown): T => {
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid request');
    }

    return parsed.data;
};

const createRecoveryChallengeSchema = z.object({
    password: z.string().min(8).max(128)
});

const exportWalletSchema = z.object({
    password: z.string().min(8).max(128),
    challengeId: z.string().uuid(),
    verificationCode: z.string().regex(/^\d{6}$/)
});

const rotationSchema = z.object({
    userId: z.string().uuid().optional()
});

const getRequestContext = (req: Request) => ({
    actorUserId: req.user?.id ?? null,
    requestId: req.requestId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined
});

export const getMyWallet = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.user) {
            throw new HttpError(401, 'Unauthorized');
        }

        const wallet = await stellarWalletService.ensureUserWallet(req.user.id);
        res.status(200).json({ wallet });
    } catch (error) {
        next(error);
    }
};

export const createRecoveryChallenge = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.user) {
            throw new HttpError(401, 'Unauthorized');
        }

        const payload = parseBody(createRecoveryChallengeSchema, req.body);
        const challenge = await walletRecoveryService.createRecoveryChallenge(
            req.user.id,
            payload.password,
            getRequestContext(req)
        );

        res.status(201).json({ challenge });
    } catch (error) {
        next(error);
    }
};

export const exportMyWallet = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.user) {
            throw new HttpError(401, 'Unauthorized');
        }

        const payload = parseBody(exportWalletSchema, req.body);
        const walletExport = await walletRecoveryService.exportSecretKey(
            req.user.id,
            payload.password,
            payload.challengeId,
            payload.verificationCode,
            getRequestContext(req)
        );

        res.status(200).json({ wallet: walletExport });
    } catch (error) {
        next(error);
    }
};

export const rotateWalletEncryption = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.user) {
            throw new HttpError(401, 'Unauthorized');
        }

        const payload = parseBody(rotationSchema, req.body);
        const targetUserId = payload.userId ?? req.user.id;
        const wallet = await stellarWalletService.rotateUserWallet(targetUserId, {
            ...getRequestContext(req),
            reason: 'Wallet master key rotation requested via API'
        });

        res.status(200).json({ wallet });
    } catch (error) {
        next(error);
    }
};

export const getLedger = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            throw new HttpError(401, 'Unauthorized');
        }

        const ledger = await walletService.getOrCreateLedger(userId);
        res.json(ledger);
    } catch (error) {
        next(error);
    }
};

export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            throw new HttpError(401, 'Unauthorized');
        }

        const currency = req.query.currency as Currency | undefined;
        const txs = await walletService.getTransactionHistory(userId, currency);
        res.json(txs);
    } catch (error) {
        next(error);
    }
};

export const lockEscrow = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            throw new HttpError(401, 'Unauthorized');
        }

        const { currency, amount, matchId, idempotencyKey } = req.body;
        const tx = await walletService.lockFundsToEscrow(
            userId,
            currency,
            new Decimal(amount),
            matchId,
            idempotencyKey
        );

        res.status(201).json(tx);
    } catch (error) {
        next(error);
    }
};

export const releaseEscrow = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            throw new HttpError(401, 'Unauthorized');
        }

        const { currency, amount, matchId, idempotencyKey } = req.body;
        const tx = await walletService.releaseEscrow(
            userId,
            currency,
            new Decimal(amount),
            matchId,
            idempotencyKey
        );

        res.json(tx);
    } catch (error) {
        next(error);
    }
};

export const slashEscrow = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            throw new HttpError(401, 'Unauthorized');
        }

        const { currency, amount, matchId, idempotencyKey, note } = req.body;
        const tx = await walletService.slashEscrow(
            userId,
            currency,
            new Decimal(amount),
            matchId,
            idempotencyKey,
            note
        );

        res.json(tx);
    } catch (error) {
        next(error);
    }
};

export const internalTransfer = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { fromUserId, toUserId, currency, amount, type, idempotencyKey, note } = req.body;
        if (![TransactionType.PLATFORM_FEE, TransactionType.PRIZE_POOL_FUND].includes(type)) {
            throw new HttpError(400, 'Invalid transfer type');
        }

        const tx = await walletService.internalTransfer({
            fromUserId,
            toUserId,
            currency,
            amount: new Decimal(amount),
            type,
            idempotencyKey,
            note
        });

        res.status(201).json(tx);
    } catch (error) {
        next(error);
    }
};
