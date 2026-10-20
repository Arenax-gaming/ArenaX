import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
    handlePaystackWebhook,
    handleFlutterwaveWebhook,
    handleWebhookVerificationPing,
} from '../controllers/payment-webhook.controller';
import {
    verifyPaystackSignature,
    verifyFlutterwaveSignature,
} from '../middleware/webhook-signature.middleware';

const router: Router = Router();

// Providers re-send the same payload on failure, so keep the cap generous.
const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 1000 : 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: {
            code: 'WEBHOOK_RATE_LIMIT',
            message: 'Too many webhook requests. Please try again later.'
        }
    }
});

/**
 * Payment provider webhooks.
 *
 * Endpoints here are signed (HMAC over the raw body, verified by the
 * middleware above) and must stay unversioned + unauthenticated — providers
 * don't send bearer tokens. Exposed URLs:
 *   POST /api/webhooks/paystack
 *   POST /api/webhooks/flutterwave
 */
/**
 * @openapi
 * /webhooks/paystack:
 *   post:
 *     summary: Handle Paystack Webhook
 *     tags: [PaymentWebhook]
 *     security: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/paystack', webhookLimiter, verifyPaystackSignature, handlePaystackWebhook);
/**
 * @openapi
 * /webhooks/flutterwave:
 *   post:
 *     summary: Handle Flutterwave Webhook
 *     tags: [PaymentWebhook]
 *     security: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/flutterwave', webhookLimiter, verifyFlutterwaveSignature, handleFlutterwaveWebhook);

// Ping endpoints for dashboard/webhook setup verification.
/**
 * @openapi
 * /webhooks/paystack:
 *   get:
 *     summary: Ping endpoints for dashboard/webhook setup verification
 *     tags: [PaymentWebhook]
 *     security: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/paystack', handleWebhookVerificationPing);
/**
 * @openapi
 * /webhooks/flutterwave:
 *   get:
 *     summary: Handle Webhook Verification Ping
 *     tags: [PaymentWebhook]
 *     security: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/flutterwave', handleWebhookVerificationPing);

export default router;