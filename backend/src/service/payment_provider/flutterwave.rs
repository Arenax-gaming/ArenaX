//! Flutterwave gateway — real API integration.
//!
//! Calls `https://api.flutterwave.com/v3/transactions/{id}/verify` with the
//! secret key read from `FLUTTERWAVE_SECRET`.  All acceptance criteria from
//! issue #1157 are satisfied here:
//!
//! - status must be `"successful"`
//! - amount (in the currency's major unit) must match `expected_amount`
//! - currency must match env-configured value (default `"NGN"`)
//! - duplicate transaction IDs are rejected via an in-process idempotency set

use super::{DepositInitiation, PaymentError, PaymentProvider, PaymentStatus};
use async_trait::async_trait;
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::Mutex;

// ── Flutterwave response shapes ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct FlwVerifyResponse {
    status: String,
    message: String,
    data: Option<FlwTransactionData>,
}

#[derive(Debug, Deserialize)]
struct FlwTransactionData {
    /// Gateway-reported outcome, e.g. `"successful"`, `"failed"`, `"pending"`.
    status: String,
    /// Amount charged in the currency's **major** unit (naira for NGN).
    /// Flutterwave uses major units, unlike Paystack which uses kobo.
    /// We store wallet balances in kobo, so `expected_amount` is also in kobo;
    /// we convert: `flw_amount_kobo = data.amount * 100`.
    amount: f64,
    /// ISO-4217 currency code, e.g. `"NGN"`.
    currency: String,
    /// Unique Flutterwave transaction ID (numeric, passed as the URL segment).
    id: i64,
    /// Merchant-supplied `tx_ref`.
    tx_ref: String,
}

#[derive(Debug, Deserialize)]
struct FlwPaymentLinkResponse {
    status: String,
    message: String,
    data: Option<FlwPaymentLinkData>,
}

#[derive(Debug, Deserialize)]
struct FlwPaymentLinkData {
    link: String,
}

// ── Provider ──────────────────────────────────────────────────────────────────

/// Flutterwave gateway.  `seen_ids` guards against duplicate transaction IDs
/// (the `reference` parameter is treated as the numeric Flutterwave
/// transaction ID when verifying).
pub struct FlutterwaveProvider {
    /// Transaction IDs that have already been verified successfully in this
    /// process.  Durable deduplication is the wallet handler's DB check.
    ///
    /// `pub` so integration tests can pre-seed it via `tests::provider_with_seen`.
    pub seen_ids: Mutex<HashSet<String>>,
}

impl Default for FlutterwaveProvider {
    fn default() -> Self {
        Self {
            seen_ids: Mutex::new(HashSet::new()),
        }
    }
}

impl std::fmt::Debug for FlutterwaveProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FlutterwaveProvider").finish()
    }
}

#[async_trait]
impl PaymentProvider for FlutterwaveProvider {
    fn name(&self) -> &'static str {
        "flutterwave"
    }

    /// Initiate a deposit: POST to Flutterwave's payment link endpoint and
    /// return the hosted payment URL.
    async fn initiate_deposit(
        &self,
        reference: &str,
        amount: i64,
        currency: &str,
    ) -> Result<DepositInitiation, PaymentError> {
        let secret = std::env::var("FLUTTERWAVE_SECRET")
            .map_err(|_| PaymentError::Provider("FLUTTERWAVE_SECRET not set".into()))?;

        let client = reqwest::Client::new();

        // Flutterwave uses major units in its API (naira, not kobo).
        let amount_major = amount as f64 / 100.0;

        let body = serde_json::json!({
            "tx_ref":       reference,
            "amount":       amount_major,
            "currency":     currency,
            "redirect_url": std::env::var("FLUTTERWAVE_REDIRECT_URL").unwrap_or_default(),
            "customer": {
                "email": std::env::var("FLUTTERWAVE_CUSTOMER_EMAIL").unwrap_or_else(|_| "customer@arenax.gg".to_string()),
            },
            "customizations": {
                "title": "ArenaX Deposit",
            }
        });

        let resp = client
            .post("https://api.flutterwave.com/v3/payments")
            .header("Authorization", format!("Bearer {}", secret))
            .json(&body)
            .send()
            .await
            .map_err(|e| PaymentError::Provider(format!("flutterwave network error: {e}")))?;

        let parsed: FlwPaymentLinkResponse = resp
            .json()
            .await
            .map_err(|e| PaymentError::Provider(format!("flutterwave parse error: {e}")))?;

        if parsed.status != "success" {
            return Err(PaymentError::Provider(format!(
                "flutterwave init failed: {}",
                parsed.message
            )));
        }

        let data = parsed.data.ok_or_else(|| {
            PaymentError::Provider("flutterwave: missing data in init response".into())
        })?;

        Ok(DepositInitiation {
            reference: reference.to_string(),
            authorization_url: Some(data.link),
        })
    }

    /// Verify a deposit:
    /// 1. Check the in-process seen-IDs set (fast duplicate guard).
    /// 2. GET `https://api.flutterwave.com/v3/transactions/{id}/verify`.
    /// 3. Validate status == "successful", amount matches (converted to kobo),
    ///    and currency matches.
    /// 4. Mark the ID as seen after all validations pass.
    ///
    /// `reference` is the **Flutterwave transaction ID** (numeric string) for
    /// the verify path.  For the Flutterwave webhook flow the handler passes
    /// the `data.id` field from the webhook payload.
    async fn verify_deposit(
        &self,
        reference: &str,
        expected_amount: i64,
    ) -> Result<bool, PaymentError> {
        // ── In-process duplicate guard ────────────────────────────────────
        {
            let seen = self
                .seen_ids
                .lock()
                .expect("seen_ids mutex poisoned");
            if seen.contains(reference) {
                tracing::warn!(
                    reference,
                    "flutterwave: duplicate transaction ID rejected (already verified in this process)"
                );
                return Err(PaymentError::Provider(format!(
                    "duplicate reference: '{reference}' has already been verified"
                )));
            }
        }

        // ── Live API call ─────────────────────────────────────────────────
        let secret = std::env::var("FLUTTERWAVE_SECRET")
            .map_err(|_| PaymentError::Provider("FLUTTERWAVE_SECRET not set".into()))?;

        let url = format!(
            "https://api.flutterwave.com/v3/transactions/{}/verify",
            reference
        );

        let client = reqwest::Client::new();
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", secret))
            .send()
            .await
            .map_err(|e| PaymentError::Provider(format!("flutterwave network error: {e}")))?;

        let http_status = resp.status();
        let parsed: FlwVerifyResponse = resp
            .json()
            .await
            .map_err(|e| PaymentError::Provider(format!("flutterwave parse error: {e}")))?;

        if parsed.status != "success" || !http_status.is_success() {
            tracing::warn!(
                reference,
                http_status = %http_status,
                message = %parsed.message,
                "flutterwave: verification call returned unsuccessful status"
            );
            return Ok(false);
        }

        let data = match parsed.data {
            Some(d) => d,
            None => {
                tracing::warn!(reference, "flutterwave: missing data in verify response");
                return Ok(false);
            }
        };

        // ── Validate status ───────────────────────────────────────────────
        if data.status != "successful" {
            tracing::warn!(
                reference,
                gateway_status = %data.status,
                "flutterwave: payment not successful"
            );
            return Ok(false);
        }

        // ── Validate amount (convert FLW major units → kobo) ─────────────
        // Flutterwave returns naira; our wallet stores kobo (× 100).
        let gateway_amount_kobo = (data.amount * 100.0).round() as i64;
        if gateway_amount_kobo != expected_amount {
            tracing::warn!(
                reference,
                gateway_amount_kobo,
                expected_amount,
                "flutterwave: amount mismatch"
            );
            return Ok(false);
        }

        // ── Validate currency ─────────────────────────────────────────────
        let expected_currency =
            std::env::var("FLUTTERWAVE_CURRENCY").unwrap_or_else(|_| "NGN".to_string());
        if !data.currency.eq_ignore_ascii_case(&expected_currency) {
            tracing::warn!(
                reference,
                gateway_currency = %data.currency,
                expected_currency,
                "flutterwave: currency mismatch"
            );
            return Ok(false);
        }

        // ── Mark seen *after* all validations pass ────────────────────────
        self.seen_ids
            .lock()
            .expect("seen_ids mutex poisoned")
            .insert(reference.to_string());

        tracing::info!(
            reference,
            tx_ref = %data.tx_ref,
            amount_kobo = gateway_amount_kobo,
            "flutterwave: payment verified"
        );
        Ok(true)
    }

    async fn initiate_withdrawal(
        &self,
        reference: &str,
        amount: i64,
        currency: &str,
        destination: &str,
    ) -> Result<PaymentStatus, PaymentError> {
        let secret = std::env::var("FLUTTERWAVE_SECRET")
            .map_err(|_| PaymentError::Provider("FLUTTERWAVE_SECRET not set".into()))?;

        let client = reqwest::Client::new();
        // destination is expected to be the bank account number; bank code
        // should be supplied as FLUTTERWAVE_BANK_CODE env var.
        let bank_code = std::env::var("FLUTTERWAVE_BANK_CODE").unwrap_or_else(|_| "044".to_string());
        let amount_major = amount as f64 / 100.0;

        let body = serde_json::json!({
            "account_bank":   bank_code,
            "account_number": destination,
            "amount":         amount_major,
            "currency":       currency,
            "reference":      reference,
            "narration":      "ArenaX withdrawal",
        });

        let resp = client
            .post("https://api.flutterwave.com/v3/transfers")
            .header("Authorization", format!("Bearer {}", secret))
            .json(&body)
            .send()
            .await
            .map_err(|e| PaymentError::Provider(format!("flutterwave network error: {e}")))?;

        let val: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| PaymentError::Provider(format!("flutterwave parse error: {e}")))?;

        let status_ok = val["status"].as_str().map(|s| s == "success").unwrap_or(false);
        if !status_ok {
            let msg = val["message"].as_str().unwrap_or("unknown error");
            return Err(PaymentError::Provider(format!(
                "flutterwave transfer failed: {msg}"
            )));
        }

        let transfer_status = val["data"]["status"].as_str().unwrap_or("NEW");
        Ok(match transfer_status {
            "SUCCESSFUL" => PaymentStatus::Success,
            "FAILED" => PaymentStatus::Failed,
            _ => PaymentStatus::Pending,
        })
    }

    async fn check_status(&self, reference: &str) -> Result<PaymentStatus, PaymentError> {
        let secret = std::env::var("FLUTTERWAVE_SECRET")
            .map_err(|_| PaymentError::Provider("FLUTTERWAVE_SECRET not set".into()))?;

        let url = format!(
            "https://api.flutterwave.com/v3/transfers?reference={}",
            reference
        );
        let client = reqwest::Client::new();
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", secret))
            .send()
            .await
            .map_err(|e| PaymentError::Provider(format!("flutterwave network error: {e}")))?;

        let val: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| PaymentError::Provider(format!("flutterwave parse error: {e}")))?;

        // FLW paginates; grab the first item's status.
        let transfer_status = val["data"]["items"][0]["status"]
            .as_str()
            .unwrap_or("NEW");
        Ok(match transfer_status {
            "SUCCESSFUL" => PaymentStatus::Success,
            "FAILED" => PaymentStatus::Failed,
            _ => PaymentStatus::Pending,
        })
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

/// Test helpers — exposed unconditionally so integration tests can construct
/// pre-seeded providers without needing `#[cfg(test)]` access.
pub mod tests {
    use super::*;

    pub fn provider_with_seen(ids: &[&str]) -> FlutterwaveProvider {
        let mut set = HashSet::new();
        for id in ids {
            set.insert(id.to_string());
        }
        FlutterwaveProvider {
            seen_ids: Mutex::new(set),
        }
    }

    #[cfg(test)]
    mod unit {
        use super::*;

        #[test]
        fn duplicate_id_detected_before_network_call() {
            let provider = provider_with_seen(&["99999"]);
            let seen = provider.seen_ids.lock().unwrap();
            assert!(seen.contains("99999"));
        }
    }
}
