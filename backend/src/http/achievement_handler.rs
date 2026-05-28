use actix_web::{web, HttpResponse, Result};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::service::AchievementService;

#[derive(Deserialize)]
pub struct UpdateProgressRequest {
    pub progress: i32,
}

#[derive(Deserialize)]
pub struct ShareAchievementRequest {
    pub message: Option<String>,
}

#[derive(Deserialize)]
pub struct CheckAchievementsRequest {
    pub event_type: String,
    pub event_data: serde_json::Value,
}

/// GET /api/v1/achievements
pub async fn list_achievements(
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let service = AchievementService::new(pool.get_ref().clone());
    let achievements = service.get_all_achievements().await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": achievements
    })))
}

/// GET /api/v1/achievements/player/:player_id
pub async fn get_player_achievements(
    pool: web::Data<PgPool>,
    player_id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let service = AchievementService::new(pool.get_ref().clone());
    let achievements = service.get_player_achievements(*player_id).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": achievements
    })))
}

/// POST /api/v1/achievements/:id/progress
pub async fn update_achievement_progress(
    pool: web::Data<PgPool>,
    path: web::Path<Uuid>,
    body: web::Json<UpdateProgressRequest>,
    player_id: web::Data<Uuid>, // From auth middleware
) -> Result<HttpResponse, ApiError> {
    let achievement_id = path.into_inner();
    let service = AchievementService::new(pool.get_ref().clone());

    let unlock_event = service
        .update_progress(*player_id, achievement_id, body.progress)
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": unlock_event,
        "message": if unlock_event.is_some() { "Achievement unlocked!" } else { "Progress updated" }
    })))
}

/// GET /api/v1/achievements/:id/stats
pub async fn get_achievement_stats(
    pool: web::Data<PgPool>,
    achievement_id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let service = AchievementService::new(pool.get_ref().clone());
    let stats = service.get_achievement_stats(*achievement_id).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": stats
    })))
}

/// POST /api/v1/achievements/:id/share
pub async fn share_achievement(
    pool: web::Data<PgPool>,
    achievement_id: web::Path<Uuid>,
    player_id: web::Data<Uuid>, // From auth middleware
) -> Result<HttpResponse, ApiError> {
    let service = AchievementService::new(pool.get_ref().clone());
    let (share_url, share_text) = service
        .generate_share_content(*player_id, *achievement_id)
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": {
            "share_url": share_url,
            "share_text": share_text
        }
    })))
}

/// POST /api/v1/achievements/check
pub async fn check_achievements(
    pool: web::Data<PgPool>,
    body: web::Json<CheckAchievementsRequest>,
    player_id: web::Data<Uuid>, // From auth middleware
) -> Result<HttpResponse, ApiError> {
    let service = AchievementService::new(pool.get_ref().clone());
    let unlocked = service
        .check_achievements(*player_id, &body.event_type, body.event_data.clone())
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": {
            "unlocked_achievements": unlocked,
            "count": unlocked.len()
        }
    })))
}
