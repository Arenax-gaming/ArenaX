import { NextFunction, Request, Response } from 'express';
import { paymentWebhookService } from '../services/payment-webhook.service';
import { HttpError } from '../utils/http-error';

/**
 * Provider webhook controllers.
 *
 * Signature headers were already validated by the routes
 * (`verifyPaystackSignature` / `verifyFlutterwaveSignature`), so handlers here
 * only parse, de-duplicate, reconcile, and ack. Always return 200 for
 * successfully received payloads — providers retry on any error status.
 */

const dispatch = async (
    req: Request,
    res: Response,
    next: NextFunction,
    provider: 'paystack' | 'flutterwave'
): Promise<void> => {
    try {
        const payload = req.body;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new HttpError(400, 'Webhook payload must be a JSON object');
        }

        const event = typeof payload.event === 'string' ? payload.event : provider;
        const result = await paymentWebhookService.process({
            provider,
            event,
            payload,
            log: req.log,
        });

        res.status(200).json({ status: 'ok', ...result });
    } catch (error) {
        next(error);
    }
};

export const handlePaystackWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => dispatch(req, res, next, 'paystack');

export const handleFlutterwaveWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => dispatch(req, res, next, 'flutterwave');

/** GET responses for provider webhook endpoint verification. */
export const handleWebhookVerificationPing = (
    _req: Request,
    res: Response
): void => {
    res.status(200).send('OK');
};