//! HTTP handlers for aggregated player statistics — Issue #904.
//!
//! Endpoints:
//! - GET /api/stats/player/{user_id}/summary          — lifetime win/loss/streak summary
//! - GET /api/stats/player/{user_id}/daily            — daily snapshots (last N days)
//! - GET /api/stats/player/{user_id}/win-rate-by-mode — win rate per game mode
//! - GET /api/stats/player/{user_id}/head-to-head     — record vs a specific opponent

use crate::{
    api_error::ApiError,
    middleware::security::validate_uuid,
    service::player_stats_service::PlayerStatsService,
};
use actix_web::{web, HttpResponse};
use serde::Deserialize;
use sqlx::PgPool;

#[derive(Deserialize)]
pub struct DailySnapshotQuery {
    pub days: Option<i32>,
    pub game_mode: Option<String>,
}

#[derive(Deserialize)]
pub struct WinRateByModeQuery {
    pub min_matches: Option<i64>,
}

#[derive(Deserialize)]
pub struct HeadToHeadQuery {
    pub opponent_id: String,
}

/// GET /api/stats/player/{user_id}/summary
///
/// Returns lifetime totals, current/best win streak, overall win-rate,
/// favourite game mode, and per-mode breakdown.
/// Cached in Redis for 5 minutes.
pub async fn get_player_stats_summary(
    db: web::Data<PgPool>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let user_id = validate_uuid(&path.into_inner())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let svc = PlayerStatsService::new(db.get_ref().clone());
    let summary = svc.get_player_stats_summary(user_id).await?;
    Ok(HttpResponse::Ok().json(summary))
}

/// GET /api/stats/player/{user_id}/daily?days=30&game_mode=ranked
///
/// Returns daily win/loss/draw snapshots for the last N days (default 30, max 90).
/// Optionally filtered to a single game mode.
pub async fn get_daily_stats_snapshots(
    db: web::Data<PgPool>,
    path: web::Path<String>,
    query: web::Query<DailySnapshotQuery>,
) -> Result<HttpResponse, ApiError> {
    let user_id = validate_uuid(&path.into_inner())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let days = query.days.unwrap_or(30).clamp(1, 90);
    let svc = PlayerStatsService::new(db.get_ref().clone());
    let snapshots = svc
        .get_daily_snapshots(user_id, days, query.game_mode.as_deref())
        .await?;
    Ok(HttpResponse::Ok().json(snapshots))
}

/// GET /api/stats/player/{user_id}/win-rate-by-mode?min_matches=1
///
/// Returns win rate broken down by game mode.
/// Modes with fewer than min_matches are excluded.
pub async fn get_win_rate_by_mode(
    db: web::Data<PgPool>,
    path: web::Path<String>,
    query: web::Query<WinRateByModeQuery>,
) -> Result<HttpResponse, ApiError> {
    let user_id = validate_uuid(&path.into_inner())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let min_matches = query.min_matches.unwrap_or(1).max(1);
    let svc = PlayerStatsService::new(db.get_ref().clone());
    let rates = svc.get_win_rate_by_mode(user_id, min_matches).await?;
    Ok(HttpResponse::Ok().json(rates))
}

/// GET /api/stats/player/{user_id}/head-to-head?opponent_id=<uuid>
///
/// Returns the head-to-head record between two players: wins, losses, draws,
/// total matches, win rate, and timestamp of last encounter.
pub async fn get_head_to_head(
    db: web::Data<PgPool>,
    path: web::Path<String>,
    query: web::Query<HeadToHeadQuery>,
) -> Result<HttpResponse, ApiError> {
    let user_id = validate_uuid(&path.into_inner())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let opponent_id = validate_uuid(&query.opponent_id)
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let svc = PlayerStatsService::new(db.get_ref().clone());
    let record = svc.get_head_to_head(user_id, opponent_id).await?;
    Ok(HttpResponse::Ok().json(record))
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/stats/player/{user_id}")
            .route("/summary",           web::get().to(get_player_stats_summary))
            .route("/daily",             web::get().to(get_daily_stats_snapshots))
            .route("/win-rate-by-mode",  web::get().to(get_win_rate_by_mode))
            .route("/head-to-head",      web::get().to(get_head_to_head)),
    );
}
