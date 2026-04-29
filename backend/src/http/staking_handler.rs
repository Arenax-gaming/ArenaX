use crate::{
    api_error::ApiError,
    middleware::security::{validate_positive_amount, validate_uuid},
    service::staking_service::{ClaimRewardsRequest, StakeForRewardsRequest, StakingService},
};
use actix_web::{web, HttpResponse};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct StakeBody {
    pub user_id: String,
    pub stellar_address: String,
    pub amount: i64,
}

#[derive(Deserialize)]
pub struct ClaimBody {
    pub user_id: String,
    pub stellar_address: String,
}

pub async fn stake_for_rewards(
    db: web::Data<PgPool>,
    body: web::Json<StakeBody>,
) -> Result<HttpResponse, ApiError> {
    let user_id = validate_uuid(&body.user_id)
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    validate_positive_amount(body.amount)
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let svc = StakingService::new(db.get_ref().clone());
    let resp = svc.record_stake(&StakeForRewardsRequest {
        user_id,
        stellar_address: body.stellar_address.clone(),
        amount: body.amount,
    }).await?;

    Ok(HttpResponse::Ok().json(resp))
}

pub async fn claim_rewards(
    db: web::Data<PgPool>,
    body: web::Json<ClaimBody>,
) -> Result<HttpResponse, ApiError> {
    let user_id = validate_uuid(&body.user_id)
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let svc = StakingService::new(db.get_ref().clone());
    // claimed_amount would come from Soroban tx result in production
    let resp = svc.record_claim(
        &ClaimRewardsRequest { user_id, stellar_address: body.stellar_address.clone() },
        0,
    ).await?;

    Ok(HttpResponse::Ok().json(resp))
}

pub async fn unstake(
    db: web::Data<PgPool>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let user_id = validate_uuid(&path.into_inner())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let svc = StakingService::new(db.get_ref().clone());
    svc.record_unstake(user_id).await?;
    Ok(HttpResponse::NoContent().finish())
}

pub async fn get_position(
    db: web::Data<PgPool>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let user_id = validate_uuid(&path.into_inner())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let svc = StakingService::new(db.get_ref().clone());
    match svc.get_position(user_id).await? {
        Some(pos) => Ok(HttpResponse::Ok().json(pos)),
        None => Ok(HttpResponse::NotFound().json(serde_json::json!({"error": "no stake found"}))),
    }
}

pub async fn get_staking_stats(db: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let svc = StakingService::new(db.get_ref().clone());
    Ok(HttpResponse::Ok().json(svc.get_stats().await?))
}
