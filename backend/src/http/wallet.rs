use actix_web::{web, HttpResponse, Result};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::models::{
    DepositRequest, PaginatedResponse, PaginationParams, TransactionResponse, TransactionStatus,
    TransactionType, WalletResponse, WithdrawalRequest,
};
use crate::service::WalletService;

#[derive(Deserialize)]
pub struct PaymentVerificationRequest {
    pub reference: String,
    pub provider: String,
}

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

    let verified = match body.provider.as_str() {
        "paystack" => service.verify_paystack_payment(&body.reference, transaction.amount.mantissa()).await?,
        "flutterwave" => service
            .verify_flutterwave_payment(&body.reference, transaction.amount.mantissa())
            .await?,
        _ => false,
    };

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