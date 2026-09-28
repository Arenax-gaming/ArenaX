//! Webhook handlers for async payment callbacks.
//!
//! Both Paystack and Flutterwave POST a JSON payload to our server when a
//! transaction's status changes.  This module:
//!
//! 1. Validates the HMAC signature supplied in the `X-Paystack-Signature` /
//!    `X-Flw-Signature` header so that only genuine gateway events are
//!    processed.
//! 2. Extracts the reference / transaction-ID from the payload.
//! 3. Calls `WalletService::verify_payment` — which runs the same full
//!    validation (status, amount, currency, duplicate guard) used by the
//!    manual verify endpoint.
//! 4. Marks the corresponding transaction `Completed` or `Failed` in the DB
//!    and credits the user's wallet on success.
//!
//! Routes (added to main.rs under `/api/webhooks`):
//!   POST /api/webhooks/paystack
//!   POST /api/webhooks/flutterwave

use actix_web::{web, HttpRequest, HttpResponse, Result};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha512;
use sqlx::PgPool;
use std::sync::Arc;

use crate::api_error::ApiError;
use crate::models::TransactionStatus;
use crate::service::WalletService;

// ── HMAC helpers ─────────────────────────────────────────────────────────────

type HmacSha512 = Hmac<Sha512>;

/// Compute HMAC-SHA512 of `body` with `secret` and return the lower-hex string.
fn hmac_sha512_hex(secret: &[u8], body: &[u8]) -> String {
    let mut mac = HmacSha512::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(body);
    hex::encode(mac.finalize().into_bytes())
}

/// Constant-time comparison to guard against timing attacks.
fn signatures_equal(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

// ── Paystack webhook ──────────────────────────────────────────────────────────

/// Minimal shape we need from Paystack's `charge.success` event.
/// Unknown fields are ignored (`deny_unknown_fields` is intentionally absent).
#[derive(Debug, Deserialize)]
struct PaystackWebhookPayload {
    event: String,
    data: PaystackWebhookData,
}

#[derive(Debug, Deserialize)]
struct PaystackWebhookData {
    reference: String,
    amount: i64,   // kobo
    #[allow(dead_code)]
    currency: String,
    #[allow(dead_code)]
    status: String,
}

/// POST /api/webhooks/paystack
pub async fn paystack_webhook(
    req: HttpRequest,
    body: web::Bytes,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    // ── 1. Signature validation ───────────────────────────────────────────
    let secret = std::env::var("PAYSTACK_SECRET").map_err(|_| {
        tracing::error!("PAYSTACK_SECRET not configured");
        ApiError::internal_error("payment configuration error")
    })?;

    let provided_sig = req
        .headers()
        .get("X-Paystack-Signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let expected_sig = hmac_sha512_hex(secret.as_bytes(), &body);

    if !signatures_equal(provided_sig, &expected_sig) {
        tracing::warn!("paystack webhook: invalid signature — request rejected");
        // Return 200 anyway so Paystack stops retrying a permanently-bad request.
        return Ok(HttpResponse::Ok().json(serde_json::json!({"status": "ignored"})));
    }

    // ── 2. Parse payload ──────────────────────────────────────────────────
    let payload: PaystackWebhookPayload =
        serde_json::from_slice(&body).map_err(|e| {
            tracing::warn!(error = %e, "paystack webhook: failed to parse payload");
            ApiError::bad_request(format!("invalid webhook payload: {e}"))
        })?;

    tracing::info!(
        event = %payload.event,
        reference = %payload.data.reference,
        amount = payload.data.amount,
        "paystack webhook received"
    );

    // We only act on charge.success events.
    if payload.event != "charge.success" {
        return Ok(HttpResponse::Ok().json(serde_json::json!({"status": "ignored"})));
    }

    // ── 3. Look up the pending transaction ───────────────────────────────
    let service = WalletService::new(Arc::new(pool.get_ref().clone()), None);

    let tx = match service
        .get_transaction_by_reference(&payload.data.reference)
        .await
    {
        Ok(t) => t,
        Err(_) => {
            tracing::warn!(
                reference = %payload.data.reference,
                "paystack webhook: transaction not found — ignoring"
            );
            return Ok(HttpResponse::Ok().json(serde_json::json!({"status": "not_found"})));
        }
    };

    // Idempotency: already completed — don't double-credit.
    if tx.status == TransactionStatus::Completed {
        tracing::info!(
            reference = %payload.data.reference,
            "paystack webhook: transaction already completed — skipping"
        );
        return Ok(HttpResponse::Ok().json(serde_json::json!({"status": "already_completed"})));
    }

    // ── 4. Verify via the provider (status + amount + currency + dup guard)
    let verified = service
        .verify_payment("paystack", &payload.data.reference, payload.data.amount)
        .await
        .unwrap_or(false);

    if verified {
        // Credit the wallet and mark completed.
        if let Err(e) = service.add_fiat_balance(tx.user_id, payload.data.amount).await {
            tracing::error!(
                reference = %payload.data.reference,
                error = %e,
                "paystack webhook: failed to credit wallet"
            );
            return Err(ApiError::internal_error("failed to credit wallet"));
        }
        service
            .update_transaction_status(tx.id, TransactionStatus::Completed)
            .await
            .map_err(|e| ApiError::internal_error(format!("db update failed: {e}")))?;

        tracing::info!(
            reference = %payload.data.reference,
            user_id = %tx.user_id,
            amount = payload.data.amount,
            "paystack webhook: wallet credited"
        );
        Ok(HttpResponse::Ok().json(serde_json::json!({"status": "credited"})))
    } else {
        service
            .update_transaction_status(tx.id, TransactionStatus::Failed)
            .await
            .map_err(|e| ApiError::internal_error(format!("db update failed: {e}")))?;

        tracing::warn!(
            reference = %payload.data.reference,
            "paystack webhook: payment verification failed — marked as failed"
        );
        Ok(HttpResponse::Ok().json(serde_json::json!({"status": "failed"})))
    }
}

// ── Flutterwave webhook ───────────────────────────────────────────────────────

/// Minimal shape we need from Flutterwave's `charge.completed` event.
#[derive(Debug, Deserialize)]
struct FlwWebhookPayload {
    event: String,
    data: FlwWebhookData,
}

#[derive(Debug, Deserialize)]
struct FlwWebhookData {
    /// Flutterwave's unique numeric transaction ID — this is what we pass to
    /// `/v3/transactions/{id}/verify`.
    id: i64,
    /// Merchant-supplied `tx_ref`, which maps to our `reference` column.
    tx_ref: String,
    amount: f64,    // major units (naira)
    #[allow(dead_code)]
    currency: String,
    #[allow(dead_code)]
    status: String,
}

/// POST /api/webhooks/flutterwave
pub async fn flutterwave_webhook(
    req: HttpRequest,
    body: web::Bytes,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    // ── 1. Signature validation ───────────────────────────────────────────
    // Flutterwave sends its secret hash in `verif-hash` header; we compare
    // it against FLUTTERWAVE_WEBHOOK_HASH env var (set in the FLW dashboard).
    let expected_hash = std::env::var("FLUTTERWAVE_WEBHOOK_HASH").map_err(|_| {
        tracing::error!("FLUTTERWAVE_WEBHOOK_HASH not configured");
        ApiError::internal_error("payment configuration error")
    })?;

    let provided_hash = req
        .headers()
        .get("verif-hash")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !signatures_equal(provided_hash, &expected_hash) {
        tracing::warn!("flutterwave webhook: invalid verif-hash — request rejected");
        return Ok(HttpResponse::Ok().json(serde_json::json!({"status": "ignored"})));
    }

    // ── 2. Parse payload ──────────────────────────────────────────────────
    let payload: FlwWebhookPayload =
        serde_json::from_slice(&body).map_err(|e| {
            tracing::warn!(error = %e, "flutterwave webhook: failed to parse payload");
            ApiError::bad_request(format!("invalid webhook payload: {e}"))
        })?;

    tracing::info!(
        event = %payload.event,
        tx_id = payload.data.id,
        tx_ref = %payload.data.tx_ref,
        amount = payload.data.amount,
        "flutterwave webhook received"
    );

    if payload.event != "charge.completed" {
        return Ok(HttpResponse::Ok().json(serde_json::json!({"status": "ignored"})));
    }

    // ── 3. Look up the pending transaction ───────────────────────────────
    let service = WalletService::new(Arc::new(pool.get_ref().clone()), None);

    let tx = match service
        .get_transaction_by_reference(&payload.data.tx_ref)
        .await
    {
        Ok(t) => t,
        Err(_) => {
            tracing::warn!(
                tx_ref = %payload.data.tx_ref,
                "flutterwave webhook: transaction not found — ignoring"
            );
            return Ok(HttpResponse::Ok().json(serde_json::json!({"status": "not_found"})));
        }
    };

    if tx.status == TransactionStatus::Completed {
        tracing::info!(
            tx_ref = %payload.data.tx_ref,
            "flutterwave webhook: transaction already completed — skipping"
        );
        return Ok(HttpResponse::Ok().json(serde_json::json!({"status": "already_completed"})));
    }

    // ── 4. Verify via the provider ────────────────────────────────────────
    // Use the numeric Flutterwave ID as the reference for the verify call.
    let flw_tx_id = payload.data.id.to_string();
    // Convert naira → kobo to match wallet storage unit.
    let amount_kobo = (payload.data.amount * 100.0).round() as i64;

    let verified = service
        .verify_payment("flutterwave", &flw_tx_id, amount_kobo)
        .await
        .unwrap_or(false);

    if verified {
        if let Err(e) = service.add_fiat_balance(tx.user_id, amount_kobo).await {
            tracing::error!(
                tx_ref = %payload.data.tx_ref,
                error = %e,
                "flutterwave webhook: failed to credit wallet"
            );
            return Err(ApiError::internal_error("failed to credit wallet"));
        }
        service
            .update_transaction_status(tx.id, TransactionStatus::Completed)
            .await
            .map_err(|e| ApiError::internal_error(format!("db update failed: {e}")))?;

        tracing::info!(
            tx_ref = %payload.data.tx_ref,
            user_id = %tx.user_id,
            amount_kobo,
            "flutterwave webhook: wallet credited"
        );
        Ok(HttpResponse::Ok().json(serde_json::json!({"status": "credited"})))
    } else {
        service
            .update_transaction_status(tx.id, TransactionStatus::Failed)
            .await
            .map_err(|e| ApiError::internal_error(format!("db update failed: {e}")))?;

        tracing::warn!(
            tx_ref = %payload.data.tx_ref,
            "flutterwave webhook: payment verification failed — marked as failed"
        );
        Ok(HttpResponse::Ok().json(serde_json::json!({"status": "failed"})))
    }
}

// ── Route configurator ────────────────────────────────────────────────────────

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/webhooks")
            .route("/paystack", web::post().to(paystack_webhook))
            .route("/flutterwave", web::post().to(flutterwave_webhook)),
    );
}
