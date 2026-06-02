use actix_web::{web, HttpResponse};
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::auth::Claims;
use crate::db::DbPool;
use crate::models::match_models::{CreateDisputeRequest, ReportScoreRequest};
use crate::service::MatchService;

/// POST /api/matches/{id}/report
/// Submit a score report for a match. Requires valid JWT.
pub async fn report_score(
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
    claims: Claims,
    body: web::Json<ReportScoreRequest>,
) -> Result<HttpResponse, ApiError> {
    let match_id = path.into_inner();
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("Invalid user ID in token"))?;

    let service = MatchService::new(pool.get_ref().clone());
    let score = service.report_score(match_id, user_id, body.into_inner()).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": score
    })))
}

/// POST /api/matches/{id}/dispute
/// Dispute a match result. Requires valid JWT.
pub async fn dispute_match(
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
    claims: Claims,
    body: web::Json<CreateDisputeRequest>,
) -> Result<HttpResponse, ApiError> {
    let match_id = path.into_inner();
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("Invalid user ID in token"))?;

    let service = MatchService::new(pool.get_ref().clone());
    let dispute = service.create_dispute(match_id, user_id, body.into_inner()).await?;

    Ok(HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "data": dispute
    })))
}

/// GET /api/matches/{id}
/// Get match details. Requires valid JWT (user ID used for permission checks).
pub async fn get_match(
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
    claims: Claims,
) -> Result<HttpResponse, ApiError> {
    let match_id = path.into_inner();
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("Invalid user ID in token"))?;

    let service = MatchService::new(pool.get_ref().clone());
    let match_response = service.get_match(match_id, Some(user_id)).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": match_response
    })))
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/matches")
            .route("/{id}", web::get().to(get_match))
            .route("/{id}/report", web::post().to(report_score))
            .route("/{id}/dispute", web::post().to(dispute_match)),
    );
}
