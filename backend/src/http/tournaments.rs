use actix_web::{web, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::auth::Claims;
use crate::models::{JoinTournamentRequest, TournamentStatus};
use crate::service::TournamentService;

#[derive(Deserialize)]
pub struct ListTournamentsQuery {
    pub page: Option<i32>,
    pub per_page: Option<i32>,
    pub status: Option<String>,
    pub game: Option<String>,
}

/// GET /api/tournaments
/// List tournaments. Requires valid JWT (user context used for `can_join`).
pub async fn list_tournaments(
    svc: web::Data<Arc<TournamentService>>,
    claims: Claims,
    query: web::Query<ListTournamentsQuery>,
) -> Result<HttpResponse, ApiError> {
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("Invalid user ID in token"))?;

    let page = query.page.unwrap_or(1).max(1);
    let per_page = query.per_page.unwrap_or(20).min(100).max(1);
    let status_filter = query.status.as_deref().and_then(parse_tournament_status);
    let game_filter = query.game.clone();

    let list = svc
        .get_tournaments(Some(user_id), page, per_page, status_filter, game_filter)
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": list
    })))
}

/// GET /api/tournaments/{id}
/// Get tournament details. Requires valid JWT.
pub async fn get_tournament(
    svc: web::Data<Arc<TournamentService>>,
    path: web::Path<Uuid>,
    claims: Claims,
) -> Result<HttpResponse, ApiError> {
    let tournament_id = path.into_inner();
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("Invalid user ID in token"))?;

    let tournament = svc.get_tournament(tournament_id, Some(user_id)).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": tournament
    })))
}

/// POST /api/tournaments/{id}/join
/// Join a tournament. Requires valid JWT.
pub async fn join_tournament(
    svc: web::Data<Arc<TournamentService>>,
    path: web::Path<Uuid>,
    claims: Claims,
    body: web::Json<JoinTournamentRequest>,
) -> Result<HttpResponse, ApiError> {
    let tournament_id = path.into_inner();
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("Invalid user ID in token"))?;

    let participant = svc
        .join_tournament(user_id, tournament_id, body.into_inner())
        .await?;

    Ok(HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "data": participant
    })))
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/tournaments")
            .route("", web::get().to(list_tournaments))
            .route("/{id}", web::get().to(get_tournament))
            .route("/{id}/join", web::post().to(join_tournament)),
    );
}

fn parse_tournament_status(s: &str) -> Option<TournamentStatus> {
    match s {
        "draft" => Some(TournamentStatus::Draft),
        "upcoming" => Some(TournamentStatus::Upcoming),
        "registration_open" => Some(TournamentStatus::RegistrationOpen),
        "registration_closed" => Some(TournamentStatus::RegistrationClosed),
        "in_progress" => Some(TournamentStatus::InProgress),
        "completed" => Some(TournamentStatus::Completed),
        "cancelled" => Some(TournamentStatus::Cancelled),
        _ => None,
    }
}
