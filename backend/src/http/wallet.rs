use actix_web::{http::header, web, HttpResponse, Result};
use once_cell::sync::Lazy;
use serde::Deserialize;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::models::{
    DepositRequest, PaginatedResponse, PaginationParams, TransactionResponse, TransactionStatus,
    TransactionType, WalletResponse, WithdrawalRequest,
};
use crate::service::wallet_service::WalletError;
use crate::service::WalletService;

#[derive(Deserialize)]
pub struct PaymentVerificationRequest {
    pub reference: String,
    pub provider: String,
}

#[derive(Debug, Deserialize)]
pub struct StatementQuery {
    pub from: String,
    pub to: String,
}

/// Per-user rate limiter for wallet statement exports (1 request per minute).
pub struct StatementRateLimiter {
    window: Duration,
    last_export: Mutex<HashMap<Uuid, Instant>>,
}

impl StatementRateLimiter {
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            last_export: Mutex::new(HashMap::new()),
        }
    }

    /// Returns `Ok(())` if the user is allowed to export now, or `Err(retry_after_secs)`
    /// if they must wait.
    pub fn check_and_record(&self, user_id: Uuid, now: Instant) -> Result<(), u64> {
        let mut map = self.last_export.lock().unwrap_or_else(|e| e.into_inner());

        // Opportunistically prune expired entries if the map grows large.
        if map.len() > 10_000 {
            map.retain(|_, ts| now.saturating_duration_since(*ts) < self.window);
        }

        if let Some(prev) = map.get(&user_id) {
            let elapsed = now.saturating_duration_since(*prev);
            if elapsed < self.window {
                let remaining = self.window - elapsed;
                let retry_after = remaining.as_secs().max(1);
                return Err(retry_after);
            }
        }

        map.insert(user_id, now);
        Ok(())
    }
}

static STATEMENT_RATE_LIMITER: Lazy<StatementRateLimiter> =
    Lazy::new(|| StatementRateLimiter::new(Duration::from_secs(60)));

pub async fn get_wallet(
    pool: web::Data<PgPool>,
    req: actix_web::HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let wallet = sqlx::query_as!(
        crate::models::Wallet,
        r#"
        SELECT * FROM wallets
        WHERE user_id = $1
        "#,
        user_id
    )
    .fetch_optional(pool.get_ref())
    .await?
    .ok_or_else(|| ApiError::not_found("Wallet not found"))?;

    Ok(HttpResponse::Ok().json(WalletResponse::from(wallet)))
}

pub async fn get_transaction_history(
    pool: web::Data<PgPool>,
    req: actix_web::HttpRequest,
    query: web::Query<PaginationParams>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let limit = query.resolved_limit();
    let offset = query.sql_offset();

    let service = WalletService::new(pool.get_ref().clone().into(), None);
    let (transactions, total) = service
        .get_transaction_history_paginated(user_id, limit, offset)
        .await
        .map_err(|e| ApiError::internal_error(format!("Failed to fetch transactions: {}", e)))?;

    let data: Vec<TransactionResponse> = transactions
        .into_iter()
        .map(|t| TransactionResponse {
            id: t.id,
            transaction_type: t.transaction_type,
            amount: t.amount,
            currency: t.currency,
            status: t.status,
            reference: t.reference,
            description: t.description,
            stellar_transaction_id: t.stellar_transaction_id,
            created_at: t.created_at,
            completed_at: t.completed_at,
        })
        .collect();

    Ok(HttpResponse::Ok().json(PaginatedResponse::new(data, total, &query)))
}

pub async fn initiate_deposit(
    pool: web::Data<PgPool>,
    req: actix_web::HttpRequest,
    body: web::Json<DepositRequest>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let amount = body.amount;
    if amount <= rust_decimal::Decimal::ZERO {
        return Err(ApiError::bad_request("Amount must be positive"));
    }

    let service = WalletService::new(pool.get_ref().clone().into(), None);
    let transaction = service
        .create_transaction(
            user_id,
            TransactionType::Deposit,
            amount.mantissa(),
            body.currency.clone(),
            format!("Wallet deposit via {}", body.payment_method),
            None,
        )
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "transaction_id": transaction.id,
        "reference": transaction.reference,
        "status": "pending",
        "amount": amount,
        "currency": body.currency,
        "payment_method": body.payment_method,
        "message": "Deposit initiated. Complete payment to finalize."
    })))
}

pub async fn verify_deposit(
    pool: web::Data<PgPool>,
    req: actix_web::HttpRequest,
    body: web::Json<PaymentVerificationRequest>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let service = WalletService::new(pool.get_ref().clone().into(), None);

    let transaction = service
        .get_transaction_by_reference(&body.reference)
        .await?;

    if transaction.status == TransactionStatus::Completed {
        return Ok(HttpResponse::Ok().json(serde_json::json!({
            "status": "completed",
            "transaction": transaction
        })));
    }

    // The active gateway comes from PAYMENT_PROVIDER (#1069); a provider
    // that isn't enabled verifies as false, as an unknown one always did.
    let verified = service
        .verify_payment(&body.provider, &body.reference, transaction.amount.mantissa())
        .await?;

    if verified {
        service
            .update_transaction_status(transaction.id, TransactionStatus::Completed)
            .await?;
    }

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "status": if verified { "completed" } else { "failed" },
        "verified": verified
    })))
}

pub async fn initiate_withdrawal(
    pool: web::Data<PgPool>,
    req: actix_web::HttpRequest,
    body: web::Json<WithdrawalRequest>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let amount = body.amount;
    if amount <= rust_decimal::Decimal::ZERO {
        return Err(ApiError::bad_request("Amount must be positive"));
    }

    let service = WalletService::new(pool.get_ref().clone().into(), None);

    let wallet = service.get_wallet(user_id).await.map_err(|e| match e {
        crate::service::wallet_service::WalletError::InsufficientBalance { required, available } => {
            ApiError::bad_request(format!(
                "Insufficient balance: required {}, available {}",
                required, available
            ))
        }
        _ => ApiError::not_found("Wallet not found"),
    })?;

    let available_balance = match body.currency.as_str() {
        "NGN" => wallet.balance_ngn.unwrap_or(0),
        "XLM" => wallet.balance_xlm.unwrap_or(0),
        "ARENAX_TOKEN" => wallet.balance_arenax_tokens.unwrap_or(0),
        _ => 0,
    };

    let amount_in_smallest_unit = match body.currency.as_str() {
        "NGN" | "ARENAX_TOKEN" => amount.mantissa(),
        "XLM" => amount.mantissa() / 1_000_000,
        _ => amount.mantissa(),
    };

    if available_balance < amount_in_smallest_unit {
        return Err(ApiError::bad_request(format!(
            "Insufficient {} balance. Available: {}",
            body.currency, available_balance
        )));
    }

    let transaction = service
        .create_transaction(
            user_id,
            TransactionType::Withdrawal,
            amount.mantissa(),
            body.currency.clone(),
            format!("Withdrawal to {}", body.destination),
            None,
        )
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "transaction_id": transaction.id,
        "reference": transaction.reference,
        "status": "pending",
        "amount": amount,
        "currency": body.currency,
        "destination": body.destination,
        "payment_method": body.payment_method,
        "message": "Withdrawal initiated. Processing may take a few minutes."
    })))
}

/// `GET /wallet/statement?from=YYYY-MM-DD&to=YYYY-MM-DD`
///
/// Returns a downloadable CSV statement of the authenticated user's wallet
/// transactions within the requested date range (max 12 months), rate-limited
/// to 1 export per minute per user.
pub async fn get_wallet_statement(
    pool: web::Data<PgPool>,
    req: actix_web::HttpRequest,
    query: web::Query<StatementQuery>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let (from_date, to_date) =
        WalletService::validate_statement_date_range(&query.from, &query.to).map_err(|e| {
            match e {
                WalletError::InvalidDateRange(msg) => ApiError::bad_request(msg),
                other => ApiError::bad_request(other.to_string()),
            }
        })?;

    if let Err(retry_after) = STATEMENT_RATE_LIMITER.check_and_record(user_id, Instant::now()) {
        return Err(ApiError::TooManyRequests {
            message: "Wallet statement export is limited to 1 request per minute. Please try again later.".to_string(),
            limit: 1,
            remaining: 0,
            reset: retry_after,
            retry_after,
        });
    }

    let service = WalletService::new(pool.get_ref().clone().into(), None);
    let csv = service
        .get_wallet_statement_csv(user_id, from_date, to_date)
        .await
        .map_err(|e| match e {
            WalletError::WalletNotFound => ApiError::not_found("Wallet not found"),
            WalletError::InvalidDateRange(msg) => ApiError::bad_request(msg),
            other => ApiError::internal_error(format!("Failed to generate wallet statement: {}", other)),
        })?;

    let filename = format!("wallet-statement-{}-to-{}.csv", from_date, to_date);

    Ok(HttpResponse::Ok()
        .insert_header((header::CONTENT_TYPE, "text/csv; charset=utf-8"))
        .insert_header((
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename),
        ))
        .body(csv))
}

#[cfg(test)]
mod statement_rate_limit_tests {
    use super::*;

    #[test]
    fn allows_first_request_and_blocks_second_within_one_minute() {
        let limiter = StatementRateLimiter::new(Duration::from_secs(60));
        let user_id = Uuid::new_v4();
        let t0 = Instant::now();

        assert!(limiter.check_and_record(user_id, t0).is_ok());

        let err = limiter
            .check_and_record(user_id, t0 + Duration::from_secs(10))
            .unwrap_err();
        assert_eq!(err, 50);

        // After 60 seconds, export is allowed again.
        assert!(limiter
            .check_and_record(user_id, t0 + Duration::from_secs(60))
            .is_ok());
    }

    #[test]
    fn rate_limits_are_isolated_per_user() {
        let limiter = StatementRateLimiter::new(Duration::from_secs(60));
        let user_a = Uuid::new_v4();
        let user_b = Uuid::new_v4();
        let t0 = Instant::now();

        assert!(limiter.check_and_record(user_a, t0).is_ok());
        assert!(limiter.check_and_record(user_b, t0).is_ok());
        assert!(limiter
            .check_and_record(user_a, t0 + Duration::from_secs(5))
            .is_err());
    }
}