import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { HttpError } from '../utils/http-error';
import { getEnv } from '../config/env';
import { logger } from '../services/logger.service';

/**
 * Provider webhook signature verification (Paystack / Flutterwave).
 *
 * Providers sign the **raw** request body, so these middlewares rely on the
 * `rawBody` captured by `express.json({ verify })` in app.ts. Re-serialising
 * from `req.body` is NOT safe — header ordering / whitespace / escaping on the
 * provider side would break the HMAC.
 *
 * - Paystack:  `x-paystack-signature` = HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY)
 * - Flutterwave: `verif-hash`        = HMAC-SHA256(rawBody, FLUTTERWAVE_WEBHOOK_HASH ?? FLUTTERWAVE_SECRET_KEY)
 */

const safeEqual = (a: Buffer, b: Buffer): boolean => {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
};

const verifyRawBodySignature = (
    rawBody: Buffer | undefined,
    signature: string | undefined,
    secret: string,
    algorithm: 'sha256' | 'sha512'
): void => {
    if (!rawBody || rawBody.length === 0) {
        throw new HttpError(400, 'Webhook payload body is empty');
    }
    if (!signature) {
        throw new HttpError(401, 'Missing webhook signature header');
    }

    const expected = crypto
        .createHmac(algorithm, secret)
        .update(rawBody)
        .digest('hex');

    if (!safeEqual(Buffer.from(signature.trim(), 'hex'), Buffer.from(expected, 'hex'))) {
        throw new HttpError(401, 'Invalid webhook signature');
    }
};

/** Skip signature enforcement in non-production when the secret is missing (dev convenience only). */
const isVerificationDisabled = (secret: string): boolean =>
    !secret && getEnv().NODE_ENV !== 'production';

const requireSecret = (secret: string, name: string): void => {
    if (!secret && getEnv().NODE_ENV === 'production') {
        // Fail closed in production: signed webhooks must be configured.
        logger.error(`[webhooks] ${name} is not configured; refusing webhook traffic`);
        throw new HttpError(503, 'Webhook verification is not configured');
    }
};

/**
 * Paystack webhook signature verification.
 * Header: `x-paystack-signature` (HMAC-SHA512 of the raw body).
 */
export const verifyPaystackSignature = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        const secret = getEnv().PAYSTACK_SECRET_KEY ?? '';
        requireSecret(secret, 'PAYSTACK_SECRET_KEY');
        if (isVerificationDisabled(secret)) {
            req.log?.warn('Paystack signature verification disabled (missing PAYSTACK_SECRET_KEY in non-production)');
            next();
            return;
        }
        verifyRawBodySignature(
            req.rawBody,
            req.header('x-paystack-signature'),
            secret,
            'sha512'
        );
        next();
    } catch (error) {
        next(error);
    }
};

/**
 * Flutterwave webhook signature verification.
 * Header: `verif-hash` (HMAC-SHA256 of the raw body).
 * Prefers FLUTTERWAVE_WEBHOOK_HASH; falls back to FLUTTERWAVE_SECRET_KEY.
 */
export const verifyFlutterwaveSignature = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        const { FLUTTERWAVE_WEBHOOK_HASH, FLUTTERWAVE_SECRET_KEY } = getEnv();
        const secret = FLUTTERWAVE_WEBHOOK_HASH ?? FLUTTERWAVE_SECRET_KEY ?? '';
        requireSecret(secret, 'FLUTTERWAVE_WEBHOOK_HASH / FLUTTERWAVE_SECRET_KEY');
        if (isVerificationDisabled(secret)) {
            req.log?.warn('Flutterwave signature verification disabled (missing webhook hash in non-production)');
            next();
            return;
        }
        verifyRawBodySignature(
            req.rawBody,
            req.header('verif-hash'),
            secret,
            'sha256'
        );
        next();
    } catch (error) {
        next(error);
    }
};