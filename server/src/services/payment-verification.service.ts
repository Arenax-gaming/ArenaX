/**
 * Payment Verification Service
 *
 * Verifies payment transactions against Paystack and Flutterwave provider APIs.
 * All verification is performed server-side — client-supplied payment data is
 * never trusted for final confirmation.
 *
 * Supported providers:
 *   - paystack  → GET https://api.paystack.co/transaction/verify/:reference
 *   - flutterwave → GET https://api.flutterwave.com/v3/transactions/:id/verify
 */

import { logger } from './logger.service';
import { HttpError } from '../utils/http-error';
import { getEnv } from '../config/env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaymentProvider = 'paystack' | 'flutterwave';

export interface VerifyPaymentParams {
  provider: PaymentProvider;
  /** Provider-specific transaction reference (Paystack) or numeric ID (Flutterwave). */
  reference: string;
  /** Expected amount in the smallest currency unit (kobo for NGN). */
  expectedAmountKobo: number;
}

export interface PaymentVerificationResult {
  verified: boolean;
  provider: PaymentProvider;
  reference: string;
  /** Amount charged, in kobo. */
  amountKobo: number;
  currency: string;
  status: string;
  /** ISO-8601 payment date from provider. */
  paidAt: string | null;
  /** Raw provider response for audit storage — stripped of sensitive keys. */
  providerData: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PAYSTACK_BASE = 'https://api.paystack.co';
const FLUTTERWAVE_BASE = 'https://api.flutterwave.com/v3';

/** Perform a GET request with Bearer auth and a 10-second timeout. */
async function authorisedGet(url: string, secretKey: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    const body = await response.json() as unknown;

    if (!response.ok) {
      const msg = (body as any)?.message ?? `HTTP ${response.status}`;
      throw new HttpError(response.status >= 500 ? 502 : 400, `Provider error: ${msg}`);
    }

    return body;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new HttpError(504, 'Payment provider request timed out');
    }
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'Unable to reach payment provider');
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Paystack
// ---------------------------------------------------------------------------

/** Verify a Paystack transaction reference. */
async function verifyPaystack(
  reference: string,
  expectedAmountKobo: number,
): Promise<PaymentVerificationResult> {
  const env = getEnv();
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new HttpError(500, 'Paystack is not configured');
  }

  // Sanitise: Paystack references must not contain path-traversal characters
  if (!/^[A-Za-z0-9_\-./]+$/.test(reference)) {
    throw new HttpError(400, 'Invalid payment reference format');
  }

  const url = `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`;

  logger.info('Verifying Paystack transaction', { reference });

  const body = await authorisedGet(url, env.PAYSTACK_SECRET_KEY) as any;

  if (!body?.status || body.status !== true) {
    throw new HttpError(400, body?.message ?? 'Paystack verification failed');
  }

  const data = body.data ?? {};
  const txStatus: string = (data.status ?? '').toLowerCase();
  const amountKobo: number = typeof data.amount === 'number' ? data.amount : 0;
  const currency: string = data.currency ?? 'NGN';
  const paidAt: string | null = data.paid_at ?? null;

  // Build safe audit record — omit the raw secret key / authorization object
  const providerData: Record<string, unknown> = {
    id: data.id,
    reference: data.reference,
    status: data.status,
    amount: data.amount,
    currency: data.currency,
    paid_at: data.paid_at,
    gateway_response: data.gateway_response,
    channel: data.channel,
    ip_address: data.ip_address,
  };

  logger.info('Paystack verification result', {
    reference,
    txStatus,
    amountKobo,
    currency,
    expectedAmountKobo,
  });

  // --- Validation checks ---

  if (txStatus !== 'success') {
    return {
      verified: false,
      provider: 'paystack',
      reference,
      amountKobo,
      currency,
      status: txStatus,
      paidAt,
      providerData,
    };
  }

  if (amountKobo !== expectedAmountKobo) {
    logger.warn('Paystack amount mismatch', { reference, amountKobo, expectedAmountKobo });
    return {
      verified: false,
      provider: 'paystack',
      reference,
      amountKobo,
      currency,
      status: 'amount_mismatch',
      paidAt,
      providerData,
    };
  }

  return {
    verified: true,
    provider: 'paystack',
    reference,
    amountKobo,
    currency,
    status: txStatus,
    paidAt,
    providerData,
  };
}

// ---------------------------------------------------------------------------
// Flutterwave
// ---------------------------------------------------------------------------

/** Verify a Flutterwave transaction by numeric ID. */
async function verifyFlutterwave(
  reference: string,
  expectedAmountKobo: number,
): Promise<PaymentVerificationResult> {
  const env = getEnv();
  if (!env.FLUTTERWAVE_SECRET_KEY) {
    throw new HttpError(500, 'Flutterwave is not configured');
  }

  // Flutterwave uses numeric transaction IDs
  if (!/^\d+$/.test(reference)) {
    throw new HttpError(400, 'Invalid Flutterwave transaction ID — must be numeric');
  }

  const url = `${FLUTTERWAVE_BASE}/transactions/${encodeURIComponent(reference)}/verify`;

  logger.info('Verifying Flutterwave transaction', { reference });

  const body = await authorisedGet(url, env.FLUTTERWAVE_SECRET_KEY) as any;

  if (body?.status !== 'success') {
    throw new HttpError(400, body?.message ?? 'Flutterwave verification failed');
  }

  const data = body.data ?? {};
  const txStatus: string = (data.status ?? '').toLowerCase();
  // Flutterwave returns the amount in major units (NGN), convert to kobo
  const amountNgn: number = typeof data.amount === 'number' ? data.amount : 0;
  const amountKobo: number = Math.round(amountNgn * 100);
  const currency: string = data.currency ?? 'NGN';
  const paidAt: string | null = data.created_at ?? null;

  const providerData: Record<string, unknown> = {
    id: data.id,
    tx_ref: data.tx_ref,
    flw_ref: data.flw_ref,
    status: data.status,
    amount: data.amount,
    charged_amount: data.charged_amount,
    currency: data.currency,
    created_at: data.created_at,
    payment_type: data.payment_type,
    ip: data.ip,
  };

  logger.info('Flutterwave verification result', {
    reference,
    txStatus,
    amountKobo,
    currency,
    expectedAmountKobo,
  });

  // --- Validation checks ---

  if (txStatus !== 'successful') {
    return {
      verified: false,
      provider: 'flutterwave',
      reference,
      amountKobo,
      currency,
      status: txStatus,
      paidAt,
      providerData,
    };
  }

  if (amountKobo !== expectedAmountKobo) {
    logger.warn('Flutterwave amount mismatch', { reference, amountKobo, expectedAmountKobo });
    return {
      verified: false,
      provider: 'flutterwave',
      reference,
      amountKobo,
      currency,
      status: 'amount_mismatch',
      paidAt,
      providerData,
    };
  }

  return {
    verified: true,
    provider: 'flutterwave',
    reference,
    amountKobo,
    currency,
    status: txStatus,
    paidAt,
    providerData,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify a payment with the specified provider.
 *
 * Throws HttpError on:
 *   - unknown provider
 *   - provider not configured
 *   - invalid reference format
 *   - network/timeout errors
 *   - non-2xx responses from the provider API
 *
 * Returns a result with `verified: false` (rather than throwing) when the
 * transaction exists but fails business validation (wrong status, wrong amount).
 */
export async function verifyPayment(
  params: VerifyPaymentParams,
): Promise<PaymentVerificationResult> {
  const { provider, reference, expectedAmountKobo } = params;

  if (!reference || reference.trim() === '') {
    throw new HttpError(400, 'Payment reference is required');
  }
  if (!Number.isInteger(expectedAmountKobo) || expectedAmountKobo <= 0) {
    throw new HttpError(400, 'Expected payment amount must be a positive integer (kobo)');
  }

  switch (provider) {
    case 'paystack':
      return verifyPaystack(reference.trim(), expectedAmountKobo);
    case 'flutterwave':
      return verifyFlutterwave(reference.trim(), expectedAmountKobo);
    default:
      throw new HttpError(400, `Unknown payment provider: ${provider}`);
  }
}
