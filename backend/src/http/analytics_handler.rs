use crate::{
    api_error::ApiError,
    middleware::security::validate_uuid,
    service::analytics_service::{AnalyticsService, RecordMatchRequest},
};
use actix_web::{web, HttpResponse};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct RecordMatchBody {
    pub game_id: i32,
    pub match_id: String,
    pub duration_secs: i64,
    pub wager_amount: i64,
    pub reward_amount: i64,
    pub player_count: i32,
}

#[derive(Deserialize)]
pub struct PlayerBehaviourBody {
    pub user_id: String,
    pub game_id: i32,
    pub won: bool,
    pub session_secs: i64,
}

#[derive(Deserialize)]
pub struct PlayerInsightsQuery {
    pub game_id: i32,
}

pub async fn record_match(
    db: web::Data<PgPool>,
    body: web::Json<RecordMatchBody>,
) -> Result<HttpResponse, ApiError> {
    let match_id = validate_uuid(&body.match_id)
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let svc = AnalyticsService::new(db.get_ref().clone());
    svc.record_match(&RecordMatchRequest {
        game_id: body.game_id,
        match_id,
        duration_secs: body.duration_secs,
        wager_amount: body.wager_amount,
        reward_amount: body.reward_amount,
        player_count: body.player_count,
    }).await?;

    Ok(HttpResponse::NoContent().finish())
}

pub async fn record_player_behaviour(
    db: web::Data<PgPool>,
    body: web::Json<PlayerBehaviourBody>,
) -> Result<HttpResponse, ApiError> {
    let user_id = validate_uuid(&body.user_id)
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let svc = AnalyticsService::new(db.get_ref().clone());
    svc.record_player_behaviour(user_id, body.game_id, body.won, body.session_secs).await?;
    Ok(HttpResponse::NoContent().finish())
}

pub async fn get_game_metrics(
    db: web::Data<PgPool>,
    path: web::Path<i32>,
) -> Result<HttpResponse, ApiError> {
    let svc = AnalyticsService::new(db.get_ref().clone());
    match svc.get_game_metrics(path.into_inner()).await? {
        Some(m) => Ok(HttpResponse::Ok().json(m)),
        None => Ok(HttpResponse::NotFound().json(serde_json::json!({"error": "no metrics found"}))),
    }
}

pub async fn get_platform_metrics(db: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let svc = AnalyticsService::new(db.get_ref().clone());
    Ok(HttpResponse::Ok().json(svc.get_platform_metrics().await?))
}

pub async fn get_player_insights(
    db: web::Data<PgPool>,
    path: web::Path<String>,
    query: web::Query<PlayerInsightsQuery>,
    // In production this comes from JWT claims; simplified here
) -> Result<HttpResponse, ApiError> {
    let user_id = validate_uuid(&path.into_inner())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let svc = AnalyticsService::new(db.get_ref().clone());
    // requesting_user_id == target for self-service; admin check omitted for brevity
    match svc.get_player_insights(user_id, user_id, false, query.game_id).await? {
        Some(i) => Ok(HttpResponse::Ok().json(i)),
        None => Ok(HttpResponse::NotFound().json(serde_json::json!({"error": "no data"}))),
    }
}
