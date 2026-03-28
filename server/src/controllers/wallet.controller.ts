import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import stellarWalletService from '../services/stellar-wallet.service';
import walletRecoveryService from '../services/wallet-recovery.service';
import { HttpError } from '../utils/http-error';

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
