//! Stellar integration microservice HTTP surface (Issue #1282).
//!
//! Exposes account creation/management, token transfers, tournament escrow &
//! prize distribution, ArenaX token issuance, transaction inspection, and
//! Soroban contract invocation on top of [`StellarService`] and
//! [`SorobanService`].
//!
//! Routes are registered under a dedicated `/stellar` scope (nested inside the
//! `/api` scope in `main.rs`), yielding `/api/stellar/...`.

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::http::match_authority_handler::SignerSecret;
use crate::service::soroban_service::SorobanService;
use crate::service::stellar_service::{StellarError, StellarService};
use actix_web::{web, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use uuid::Uuid;

// =============================================================================
// REQUEST / RESPONSE TYPES
// =============================================================================

/// Body for `POST /api/stellar/accounts`.
#[derive(Debug, Deserialize)]
pub struct CreateAccountBody {
    /// Arbitrary account classification (defaults to `user`).
    pub account_type: Option<String>,
}

/// Body for `POST /api/stellar/accounts/fund`.
#[derive(Debug, Deserialize)]
pub struct FundAccountBody {
    pub public_key: String,
    /// Amount in stroops (1 XLM = 10_000_000 stroops).
    pub amount: Option<i64>,
}

/// Body for `POST /api/stellar/transfers/tokens`.
#[derive(Debug, Deserialize)]
pub struct TransferTokensBody {
    pub to_public_key: String,
    pub amount: i64,
}

/// Body for `POST /api/stellar/escrow`.
#[derive(Debug, Deserialize)]
pub struct EscrowBody {
    pub tournament_id: Uuid,
    pub prize_pool_account: String,
    pub amount: i64,
}

/// A single prize recipient.
#[derive(Debug, Deserialize)]
pub struct PrizeWinner {
    pub user_id: Uuid,
    pub amount: i64,
}

/// Body for `POST /api/stellar/prizes/distribute`.
#[derive(Debug, Deserialize)]
pub struct DistributePrizesBody {
    pub tournament_id: Uuid,
    pub prize_pool_account: String,
    pub winners: Vec<PrizeWinner>,
}

/// Body for `POST /api/stellar/contracts/invoke`.
#[derive(Debug, Deserialize)]
pub struct InvokeContractBody {
    pub contract_id: String,
    pub function_name: String,
    #[serde(default)]
    pub args: Value,
}

/// Response for the token issuance endpoint.
#[derive(Debug, Serialize)]
pub struct IssueTokenResponse {
    pub message: String,
}

/// Response for `POST /api/stellar/transactions/{tx_hash}/verify`.
#[derive(Debug, Serialize)]
pub struct VerifyTransactionResponse {
    pub tx_hash: String,
    pub verified: bool,
}

// =============================================================================
// HELPERS
// =============================================================================

fn map_stellar_error(err: StellarError) -> ApiError {
    match err {
        StellarError::AccountNotFound => ApiError::not_found("Stellar account not found"),
        StellarError::AccountNotFunded => ApiError::bad_request("Stellar account is not funded"),
        StellarError::InsufficientBalance => ApiError::bad_request("Insufficient Stellar balance"),
        StellarError::InvalidPublicKey => ApiError::bad_request("Invalid Stellar public key"),
        StellarError::TransactionFailed(message) => {
            ApiError::bad_request(format!("Stellar transaction failed: {}", message))
        }
        StellarError::DatabaseError(e) => ApiError::database_error(e),
        StellarError::StellarSdkError(message) => ApiError::StellarError(message),
    }
}

fn authenticated_user(req: &HttpRequest) -> Result<Uuid, ApiError> {
    req.user_id()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))
}

fn require_admin(req: &HttpRequest) -> Result<Uuid, ApiError> {
    let user_id = authenticated_user(req)?;
    let is_admin = req
        .claims()
        .map(|c| c.roles.iter().any(|r| r == "admin"))
        .unwrap_or(false);
    if !is_admin {
        return Err(ApiError::forbidden("Admin role required"));
    }
    Ok(user_id)
}

// =============================================================================
// HANDLERS
// =============================================================================

/// `POST /api/stellar/accounts` — create a Stellar account for the caller.
pub async fn create_stellar_account(
    service: web::Data<Arc<StellarService>>,
    req: HttpRequest,
    body: web::Json<CreateAccountBody>,
) -> Result<HttpResponse, ApiError> {
    let user_id = authenticated_user(&req)?;
    let account_type = body.account_type.as_deref().unwrap_or("user");

    let account = service
        .create_stellar_account(user_id, account_type)
        .await
        .map_err(map_stellar_error)?;

    Ok(HttpResponse::Created().json(account))
}

/// `GET /api/stellar/accounts/me` — fetch the caller's Stellar account.
pub async fn get_my_account(
    service: web::Data<Arc<StellarService>>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let user_id = authenticated_user(&req)?;
    let account = service.get_account(user_id).await.map_err(map_stellar_error)?;
    Ok(HttpResponse::Ok().json(account))
}

/// `GET /api/stellar/accounts/{public_key}` — lookup by public key.
pub async fn get_account_by_public_key(
    service: web::Data<Arc<StellarService>>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let public_key = path.into_inner();
    let account = service
        .get_account_by_public_key(&public_key)
        .await
        .map_err(map_stellar_error)?;
    Ok(HttpResponse::Ok().json(account))
}

/// `POST /api/stellar/accounts/fund` — fund an account (friendbot on testnet).
pub async fn fund_account(
    service: web::Data<Arc<StellarService>>,
    req: HttpRequest,
    body: web::Json<FundAccountBody>,
) -> Result<HttpResponse, ApiError> {
    authenticated_user(&req)?;
    let amount = body.amount.unwrap_or(20_000_000);
    if amount <= 0 {
        return Err(ApiError::bad_request("amount must be positive"));
    }

    let tx_hash = service
        .fund_account(&body.public_key, amount)
        .await
        .map_err(map_stellar_error)?;

    Ok(HttpResponse::Ok().json(serde_json::json!({ "tx_hash": tx_hash })))
}

/// `POST /api/stellar/transfers/tokens` — transfer ArenaX tokens.
pub async fn transfer_tokens(
    service: web::Data<Arc<StellarService>>,
    req: HttpRequest,
    body: web::Json<TransferTokensBody>,
) -> Result<HttpResponse, ApiError> {
    let user_id = authenticated_user(&req)?;
    if body.amount <= 0 {
        return Err(ApiError::bad_request("amount must be positive"));
    }

    let tx_hash = service
        .transfer_tokens(user_id, &body.to_public_key, body.amount)
        .await
        .map_err(map_stellar_error)?;

    Ok(HttpResponse::Ok().json(serde_json::json!({ "tx_hash": tx_hash })))
}

/// `POST /api/stellar/escrow` — escrow tournament entry fees (admin).
pub async fn escrow_entry_fees(
    service: web::Data<Arc<StellarService>>,
    req: HttpRequest,
    body: web::Json<EscrowBody>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;
    if body.amount <= 0 {
        return Err(ApiError::bad_request("amount must be positive"));
    }

    let tx_hash = service
        .escrow_entry_fees(body.tournament_id, &body.prize_pool_account, body.amount)
        .await
        .map_err(map_stellar_error)?;

    Ok(HttpResponse::Ok().json(serde_json::json!({ "tx_hash": tx_hash })))
}

/// `POST /api/stellar/prizes/distribute` — distribute tournament prizes (admin).
pub async fn distribute_prizes(
    service: web::Data<Arc<StellarService>>,
    req: HttpRequest,
    body: web::Json<DistributePrizesBody>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;
    if body.winners.is_empty() {
        return Err(ApiError::bad_request("winners must not be empty"));
    }
    if body.winners.iter().any(|w| w.amount <= 0) {
        return Err(ApiError::bad_request("each prize amount must be positive"));
    }

    let winners: Vec<(Uuid, i64)> = body
        .winners
        .iter()
        .map(|w| (w.user_id, w.amount))
        .collect();

    let tx_hashes = service
        .distribute_prizes(body.tournament_id, &body.prize_pool_account, winners)
        .await
        .map_err(map_stellar_error)?;

    Ok(HttpResponse::Ok().json(serde_json::json!({ "tx_hashes": tx_hashes })))
}

/// `POST /api/stellar/assets/issue` — issue the ArenaX token (admin).
pub async fn issue_asset(
    service: web::Data<Arc<StellarService>>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;

    service
        .issue_arenax_token()
        .await
        .map_err(map_stellar_error)?;

    Ok(HttpResponse::Ok().json(IssueTokenResponse {
        message: "ArenaX token issuance initiated".to_string(),
    }))
}

/// `POST /api/stellar/contracts/invoke` — invoke a Soroban contract (admin).
pub async fn invoke_contract(
    soroban: web::Data<Arc<SorobanService>>,
    signer: web::Data<SignerSecret>,
    req: HttpRequest,
    body: web::Json<InvokeContractBody>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;

    if signer.0.is_empty() {
        return Err(ApiError::internal_error(
            "Protocol signer secret is not configured",
        ));
    }

    let result = soroban
        .invoke(
            &body.contract_id,
            &body.function_name,
            &body.args,
            &signer.0,
        )
        .await
        .map_err(|e| ApiError::internal_error(format!("Soroban invocation failed: {}", e)))?;

    Ok(HttpResponse::Ok().json(result))
}

/// `GET /api/stellar/transactions/{tx_hash}` — fetch a recorded transaction.
pub async fn get_transaction(
    service: web::Data<Arc<StellarService>>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let transaction = service
        .get_transaction(&path.into_inner())
        .await
        .map_err(map_stellar_error)?;
    Ok(HttpResponse::Ok().json(transaction))
}

/// `POST /api/stellar/transactions/{tx_hash}/verify` — verify a transaction.
pub async fn verify_transaction(
    service: web::Data<Arc<StellarService>>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let tx_hash = path.into_inner();
    let verified = service
        .verify_transaction(&tx_hash)
        .await
        .map_err(map_stellar_error)?;

    Ok(HttpResponse::Ok().json(VerifyTransactionResponse { tx_hash, verified }))
}

// =============================================================================
// ROUTES
// =============================================================================

/// Register the Stellar microservice routes under a `/stellar` scope.
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/stellar")
            .route("/accounts", web::post().to(create_stellar_account))
            .route("/accounts/me", web::get().to(get_my_account))
            .route("/accounts/fund", web::post().to(fund_account))
            .route(
                "/accounts/{public_key}",
                web::get().to(get_account_by_public_key),
            )
            .route("/transfers/tokens", web::post().to(transfer_tokens))
            .route("/escrow", web::post().to(escrow_entry_fees))
            .route("/prizes/distribute", web::post().to(distribute_prizes))
            .route("/assets/issue", web::post().to(issue_asset))
            .route("/contracts/invoke", web::post().to(invoke_contract))
            .route(
                "/transactions/{tx_hash}",
                web::get().to(get_transaction),
            )
            .route(
                "/transactions/{tx_hash}/verify",
                web::post().to(verify_transaction),
            ),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_account_not_found_is_404() {
        let err = map_stellar_error(StellarError::AccountNotFound);
        let response = actix_web::ResponseError::error_response(&err);
        assert_eq!(response.status().as_u16(), 404);
    }

    #[test]
    fn map_invalid_public_key_is_400() {
        let err = map_stellar_error(StellarError::InvalidPublicKey);
        let response = actix_web::ResponseError::error_response(&err);
        assert_eq!(response.status().as_u16(), 400);
    }

    #[test]
    fn distribute_body_deserializes() {
        let json = r#"{
            "tournament_id": "00000000-0000-0000-0000-000000000001",
            "prize_pool_account": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "winners": [{"user_id": "00000000-0000-0000-0000-000000000002", "amount": 500}]
        }"#;
        let body: DistributePrizesBody = serde_json::from_str(json).unwrap();
        assert_eq!(body.winners.len(), 1);
        assert_eq!(body.winners[0].amount, 500);
    }
}
