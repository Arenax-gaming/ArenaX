use actix_web::{web, HttpResponse, Result};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::models::{PaginatedResponse, PaginationParams};
use crate::service::LeaderboardService;

/// GET /api/v1/leaderboards/:category
pub async fn get_leaderboard(
    pool: web::Data<PgPool>,
    category: web::Path<String>,
    query: web::Query<PaginationParams>,
) -> Result<HttpResponse, ApiError> {
    let service = LeaderboardService::new(pool.get_ref().clone());
    let limit = query.resolved_limit();
    let offset = query.sql_offset();

    let leaderboard = service
        .get_leaderboard(&category, limit, offset)
        .await?;

    Ok(HttpResponse::Ok().json(PaginatedResponse {
        total: leaderboard.total_count,
        page: query.resolved_page(),
        limit,
        data: leaderboard.entries,
    }))
}

/// GET /api/v1/leaderboards/:category/season/:season
pub async fn get_seasonal_leaderboard(
    pool: web::Data<PgPool>,
    path: web::Path<(String, String)>,
    query: web::Query<PaginationParams>,
) -> Result<HttpResponse, ApiError> {
    let (category, season) = path.into_inner();
    let service = LeaderboardService::new(pool.get_ref().clone());
    let limit = query.resolved_limit();
    let offset = query.sql_offset();

    let leaderboard = service
        .get_seasonal_leaderboard(&category, &season, limit, offset)
        .await?;

    Ok(HttpResponse::Ok().json(PaginatedResponse {
        total: leaderboard.total_participants,
        page: query.resolved_page(),
        limit,
        data: leaderboard.entries,
    }))
}

/// GET /api/v1/leaderboards/:category/player/:player_id
pub async fn get_player_rank(
    pool: web::Data<PgPool>,
    path: web::Path<(String, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (category, player_id) = path.into_inner();
    let service = LeaderboardService::new(pool.get_ref().clone());

    let player_rank = service.get_player_rank(&category, player_id).await?;

    Ok(HttpResponse::Ok().json(player_rank))
}

/// GET /api/v1/leaderboards/:category/history/:player_id
pub async fn get_rank_history(
    pool: web::Data<PgPool>,
    path: web::Path<(String, Uuid)>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, ApiError> {
    let (category, player_id) = path.into_inner();
    let service = LeaderboardService::new(pool.get_ref().clone());
    let days = query
        .get("days")
        .and_then(|d| d.parse::<i64>().ok())
        .unwrap_or(30);

    let history = service
        .get_rank_history(player_id, &category, days)
        .await?;

    Ok(HttpResponse::Ok().json(history))
}

/// POST /api/v1/leaderboards/:category/refresh
pub async fn refresh_leaderboard(
    pool: web::Data<PgPool>,
    category: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let service = LeaderboardService::new(pool.get_ref().clone());

    service.refresh_leaderboard(&category).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": format!("Leaderboard for {} refreshed successfully", category)
    })))
}

/// GET /api/v1/leaderboards/:category/stats
pub async fn get_leaderboard_stats(
    pool: web::Data<PgPool>,
    category: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let service = LeaderboardService::new(pool.get_ref().clone());

    let stats = service.get_leaderboard_stats(&category).await?;

    Ok(HttpResponse::Ok().json(stats))
}
