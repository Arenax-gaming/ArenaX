import { Logger } from 'winston';
import { getDatabaseClient } from './database.service';
import { walletProducer } from './kafka/producers';
import { HttpError } from '../utils/http-error';

/**
 * Payment provider webhook processing (Paystack / Flutterwave).
 *
 * Signature verification happens upstream in
 * `middleware/webhook-signature.middleware.ts`, so reaching this service means
 * the payload was signed by the provider.
 *
 * Responsibilities here:
 *  - Normalise provider payloads into one internal shape.
 *  - De-duplicate replayed webhooks (in-memory idempotency key).
 *  - Reconcile the internal `Payment` record (best effort, by reference).
 *  - Emit a `wallet.credited` domain event so the wallet layer can credit.
 *  - Audit-log every accepted webhook.
 */

export type WebhookProvider = 'paystack' | 'flutterwave';

export type WebhookPaymentStatus = 'completed' | 'failed' | 'pending' | 'unknown';

export interface NormalizedWebhookPayment {
    provider: WebhookProvider;
    /** Provider event name, e.g. `charge.success`. */
    event: string;
    /** Provider reference — used to reconcile the internal Payment record. */
    reference: string;
    /** Provider transaction id (when the event carries one). */
    transactionId?: string;
    /** Amount in the provider's major unit (NGN dollars, not kobo/coins). */
    amount: number;
    currency: string;
    status: WebhookPaymentStatus;
    /** Arbitrary metadata echoed back from our checkout (e.g. userId). */
    metadata?: Record<string, unknown>;
}

export interface ProcessWebhookInput {
    provider: WebhookProvider;
    event: string;
    payload: Record<string, unknown>;
    log?: Logger;
}

export interface ProcessWebhookResult {
    status: 'processed' | 'duplicate' | 'ignored';
    event: string;
    reference: string;
}

const SUCCESS_EVENTS: Record<WebhookProvider, readonly string[]> = {
    paystack: ['charge.success'],
    flutterwave: ['charge.completed'],
};

const IGNORED_EVENTS: Record<WebhookProvider, readonly string[]> = {
    paystack: ['charge.pending', 'transfer.pending', 'transfer.success', 'transfer.failed', 'invoice.payment_failed'],
    flutterwave: ['charge.pending', 'charge.failed', 'transfer.completed', 'transfer.failed'],
};

// ── Idempotency (in-memory, process-scoped) ──────────────────────────────────
// A real deployment behind multiple instances should use a shared store
// (Redis) with the same key scheme: `webhook:<provider>:<transactionId>`.

const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const processedKeys = new Map<string, number>();

const isDuplicate = (key: string): boolean => {
    const now = Date.now();
    // Opportunistic cleanup of expired keys.
    if (processedKeys.size > 5000) {
        for (const [k, ts] of processedKeys) {
            if (now - ts > DEDUPE_TTL_MS) processedKeys.delete(k);
        }
    }
    if (processedKeys.has(key)) return true;
    processedKeys.set(key, now + DEDUPE_TTL_MS);
    return false;
};

// ── Normalizers ──────────────────────────────────────────────────────────────

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const normalizePaystack = (
    event: string,
    payload: Record<string, unknown>
): NormalizedWebhookPayment => {
    const data = asRecord(payload.data);
    const reference = (data?.reference ?? payload.reference) as string | undefined;
    if (!reference) {
        throw new HttpError(400, 'Paystack webhook is missing data.reference');
    }

    // Paystack `amount` is in the smallest currency unit (kobo).
    const amountMinor = Number(data?.amount ?? 0);
    const metadata = asRecord(data?.metadata);

    return {
        provider: 'paystack',
        event,
        reference,
        transactionId: data?.id != null ? String(data.id) : undefined,
        amount: Math.floor(amountMinor) / 100,
        currency: typeof data?.currency === 'string' ? data.currency : 'NGN',
        status: SUCCESS_EVENTS.paystack.includes(event)
            ? 'completed'
            : IGNORED_EVENTS.paystack.includes(event)
              ? 'unknown'
              : 'unknown',
        metadata,
    };
};

const normalizeFlutterwave = (
    event: string,
    payload: Record<string, unknown>
): NormalizedWebhookPayment => {
    const data = asRecord(payload.data);
    const reference = (data?.tx_ref ?? data?.reference) as string | undefined;
    if (!reference) {
        throw new HttpError(400, 'Flutterwave webhook is missing data.tx_ref');
    }

    return {
        provider: 'flutterwave',
        event,
        reference,
        transactionId: data?.id != null ? String(data.id) : undefined,
        amount: Number(data?.amount ?? 0),
        currency: typeof data?.currency === 'string' ? data.currency : 'NGN',
        status: SUCCESS_EVENTS.flutterwave.includes(event)
            ? 'completed'
            : IGNORED_EVENTS.flutterwave.includes(event)
              ? 'unknown'
              : 'unknown',
        metadata: asRecord(data?.meta),
    };
};

const normalize = (
    provider: WebhookProvider,
    event: string,
    payload: Record<string, unknown>
): NormalizedWebhookPayment =>
    provider === 'paystack'
        ? normalizePaystack(event, payload)
        : normalizeFlutterwave(event, payload);

// ── Reconciliation helpers ───────────────────────────────────────────────────

/** Mark the matching internal Payment row COMPLETED, if one exists. */
const reconcilePaymentRecord = async (
    reference: string,
    log: Logger | undefined
): Promise<void> => {
    try {
        const prisma = getDatabaseClient();
        const updated = await prisma.payment.updateMany({
            where: { txHash: reference, status: { in: ['PENDING', 'FAILED'] } },
            data: { status: 'COMPLETED', lastError: null, updatedAt: new Date() },
        });
        if (updated.count > 0) {
            log?.info(`[webhooks] Marked Payment ${reference} as COMPLETED`);
        }
    } catch (error) {
        // Reconcile is best-effort — never fail the webhook ack over it.
        log?.warn('[webhooks] Payment reconciliation failed', {
            reference,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};

/** Emit wallet.credited when the webhook represents a successful payment. */
const emitWalletCredit = async (
    payment: NormalizedWebhookPayment,
    log: Logger | undefined
): Promise<void> => {
    const userId = payment.metadata?.userId;
    if (typeof userId !== 'string') {
        log?.debug('[webhooks] No userId metadata — skipping wallet.credited emit');
        return;
    }

    try {
        await walletProducer.publishWalletCredited(
            {
                userId,
                walletId: userId,
                amount: payment.amount,
                currency: payment.currency === 'XLM' || payment.currency === 'AXT'
                    ? payment.currency
                    : 'NGN',
                reason: 'deposit',
                referenceId: payment.reference,
            },
            payment.reference
        );
        log?.info('[webhooks] Published wallet.credited', { reference: payment.reference });
    } catch (error) {
        log?.warn('[webhooks] wallet.credited publish failed', {
            reference: payment.reference,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};

// ── Public API ───────────────────────────────────────────────────────────────

export const paymentWebhookService = {
    SUCCESS_EVENTS,

    async process(input: ProcessWebhookInput): Promise<ProcessWebhookResult> {
        const { provider, event, payload, log } = input;

        const payment = normalize(provider, event, payload);
        const dedupeKey = `${provider}:${payment.transactionId ?? payment.reference}`;

        if (isDuplicate(dedupeKey)) {
            log?.info('[webhooks] Ignoring duplicate webhook', {
                provider,
                event,
                reference: payment.reference,
            });
            return { status: 'duplicate', event, reference: payment.reference };
        }

        if (payment.status !== 'completed') {
            log?.info('[webhooks] Non-success event; no credit applied', {
                provider,
                event,
                reference: payment.reference,
            });
            return { status: 'ignored', event, reference: payment.reference };
        }

        log?.info('[webhooks] Processing successful payment', {
            provider,
            event,
            reference: payment.reference,
            transactionId: payment.transactionId,
            amount: payment.amount,
            currency: payment.currency,
        });

        await reconcilePaymentRecord(payment.reference, log);
        await emitWalletCredit(payment, log);

        return { status: 'processed', event, reference: payment.reference };
    },
};

export default paymentWebhookService;