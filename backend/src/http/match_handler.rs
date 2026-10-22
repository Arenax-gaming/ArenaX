//! Database-backed match microservice HTTP surface (Issue #1280).
//!
//! Handles match creation/assignment, score reporting & validation, dispute
//! handling, Elo rating reads, and matchmaking-queue management on top of
//! [`MatchService`].
//!
//! The routes declared here are registered *inside* the existing `/matches`
//! scope owned by [`crate::http::match_authority_handler`] (see its
//! `configure_routes`), so all paths are relative to `/api/matches`. Every
//! path must stay distinct from the on-chain authority routes
//! (`""`, `/{id}`, `/{id}/start`, `/{id}/complete`, `/{id}/dispute`,
//! `/{id}/finalize`, `/{id}/reconcile`).

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::models::{CreateDisputeRequest, JoinMatchmakingRequest, MatchType, ReportScoreRequest};
use crate::service::match_service::MatchService;
use crate::service::notification_service::{NewNotification, NotificationService};
use actix_web::{web, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

// =============================================================================
// REQUEST / RESPONSE TYPES
// =============================================================================

/// Body for `POST /api/matches/create`.
#[derive(Debug, Deserialize)]
pub struct CreateMatchBody {
    pub player1_id: Uuid,
    pub player2_id: Option<Uuid>,
    /// `tournament` | `casual` | `ranked` | `practice` (defaults to `casual`).
    pub match_type: Option<String>,
    pub game_mode: String,
    pub tournament_id: Option<Uuid>,
    pub round_id: Option<Uuid>,
}

/// Body for `POST /api/matches/{id}/report`.
#[derive(Debug, Deserialize)]
pub struct ReportScoreBody {
    pub score: i32,
    pub opponent_score: i32,
    pub proof_url: Option<String>,
    pub telemetry_data: Option<String>,
}

/// Body for `POST /api/matches/{id}/disputes`.
#[derive(Debug, Deserialize)]
pub struct CreateMatchDisputeBody {
    pub reason: String,
    pub evidence_urls: Option<Vec<String>>,
}

/// Body for `POST /api/matches/{id}/disputes/{dispute_id}/resolve`.
#[derive(Debug, Deserialize)]
pub struct ResolveMatchDisputeBody {
    pub resolution: String,
    pub winner_id: Option<Uuid>,
}

/// Body for `POST /api/matches/{id}/disputes/{dispute_id}/reject`.
#[derive(Debug, Deserialize)]
pub struct RejectMatchDisputeBody {
    pub reason: String,
}

/// Body for `POST /api/matches/{id}/cancel`.
#[derive(Debug, Deserialize)]
pub struct CancelMatchBody {
    pub reason: Option<String>,
}

/// Body for `POST /api/matches/queue/join`.
#[derive(Debug, Deserialize)]
pub struct JoinQueueBody {
    pub game: String,
    pub game_mode: String,
    pub max_wait_time: Option<i32>,
}

/// Query parameters for Elo / history endpoints.
#[derive(Debug, Deserialize)]
pub struct GameQuery {
    pub game: String,
}

/// Query parameters for match history.
#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub page: Option<i32>,
    pub per_page: Option<i32>,
    pub game: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MatchMessageResponse {
    pub message: String,
}

// =============================================================================
// HELPERS
// =============================================================================

/// Map the free-form `match_type` string onto the typed enum, defaulting to
/// `Casual` for unknown/absent values.
fn parse_match_type(raw: Option<&str>) -> MatchType {
    match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("tournament") => MatchType::Tournament,
        Some("ranked") => MatchType::Ranked,
        Some("practice") => MatchType::Practice,
        _ => MatchType::Casual,
    }
}

fn authenticated_user(req: &HttpRequest) -> Result<Uuid, ApiError> {
    req.user_id()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))
}

fn is_admin(req: &HttpRequest) -> bool {
    req.claims()
        .map(|c| c.roles.iter().any(|r| r == "admin"))
        .unwrap_or(false)
}

fn require_admin(req: &HttpRequest) -> Result<Uuid, ApiError> {
    let user_id = authenticated_user(req)?;
    if !is_admin(req) {
        return Err(ApiError::forbidden("Admin role required"));
    }
    Ok(user_id)
}

// =============================================================================
// HANDLERS
// =============================================================================

/// `POST /api/matches/create` — create a database-backed match.
///
/// Only a participant named in the payload, or an admin acting on their
/// behalf, may create the match.
pub async fn create_match(
    service: web::Data<Arc<MatchService>>,
    req: HttpRequest,
    body: web::Json<CreateMatchBody>,
) -> Result<HttpResponse, ApiError> {
    let caller = authenticated_user(&req)?;
    let involves_caller = caller == body.player1_id || body.player2_id == Some(caller);
    if !involves_caller && !is_admin(&req) {
        return Err(ApiError::forbidden(
            "Only a match participant or an admin may create a match",
        ));
    }

    let match_record = service
        .create_match(
            body.player1_id,
            body.player2_id,
            parse_match_type(body.match_type.as_deref()),
            body.game_mode.clone(),
            body.tournament_id,
            body.round_id,
        )
        .await?;

    Ok(HttpResponse::Created().json(match_record))
}

/// `GET /api/matches/{id}/details` — fetch a database match with players.
pub async fn get_match_details(
    service: web::Data<Arc<MatchService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let details = service.get_match(path.into_inner(), req.user_id()).await?;
    Ok(HttpResponse::Ok().json(details))
}

/// `POST /api/matches/{id}/report` — submit a score report (validated).
pub async fn report_score(
    service: web::Data<Arc<MatchService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
    body: web::Json<ReportScoreBody>,
) -> Result<HttpResponse, ApiError> {
    let user_id = authenticated_user(&req)?;
    let request = ReportScoreRequest {
        score: body.score,
        opponent_score: body.opponent_score,
        proof_url: body.proof_url.clone(),
        telemetry_data: body.telemetry_data.clone(),
    };

    let score = service
        .report_score(path.into_inner(), user_id, request)
        .await?;

    Ok(HttpResponse::Created().json(score))
}

/// `POST /api/matches/{id}/cancel` — cancel a match.
///
/// Allowed for a participant or an admin.
pub async fn cancel_match(
    service: web::Data<Arc<MatchService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
    body: web::Json<CancelMatchBody>,
) -> Result<HttpResponse, ApiError> {
    let match_id = path.into_inner();
    let caller = authenticated_user(&req)?;

    if !is_admin(&req) {
        let existing = service.get_match(match_id, Some(caller)).await?;
        let is_participant =
            existing.player1.id == caller || existing.player2.as_ref().map(|p| p.id) == Some(caller);
        if !is_participant {
            return Err(ApiError::forbidden(
                "Only a match participant or an admin may cancel a match",
            ));
        }
    }

    let cancelled = service.cancel_match(match_id, body.reason.clone()).await?;
    Ok(HttpResponse::Ok().json(cancelled))
}

/// `POST /api/matches/{id}/disputes` — file a dispute for a match.
pub async fn create_match_dispute(
    service: web::Data<Arc<MatchService>>,
    notifications: web::Data<Arc<NotificationService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
    body: web::Json<CreateMatchDisputeBody>,
) -> Result<HttpResponse, ApiError> {
    let user_id = authenticated_user(&req)?;
    if body.reason.trim().is_empty() {
        return Err(ApiError::bad_request("Dispute reason must not be empty"));
    }
    let request = CreateDisputeRequest {
        reason: body.reason.trim().to_string(),
        evidence_urls: body.evidence_urls.clone(),
    };

    let match_id = path.into_inner();
    let dispute = service
        .create_dispute(match_id, user_id, request)
        .await?;

    let match_details = service.get_match(match_id, None).await.ok();
    let opponent_id = match_details.as_ref().and_then(|m| {
        if m.player1.id == user_id {
            m.player2.as_ref().map(|p| p.id)
        } else {
            Some(m.player1.id)
        }
    });
    for recipient in [Some(user_id), opponent_id].into_iter().flatten() {
        let _ = notifications.create_and_fan_out(NewNotification {
            user_id: recipient,
            typ: "match_dispute".to_string(),
            title: "Match dispute opened".to_string(),
            message: format!("A dispute was opened for match {match_id}."),
            link: Some(format!("/matches/{match_id}")),
            link_label: Some("View match".to_string()),
        }).await;
    }

    Ok(HttpResponse::Created().json(dispute))
}

/// `GET /api/matches/disputes/pending` — admin review queue.
pub async fn list_pending_match_disputes(
    req: HttpRequest,
    service: web::Data<Arc<MatchService>>,
    query: web::Query<HistoryQuery>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;
    let page = query.page.unwrap_or(1).max(1);
    let per_page = query.per_page.unwrap_or(50).clamp(1, 200);
    let disputes = service.get_pending_disputes(page, per_page).await?;
    Ok(HttpResponse::Ok().json(disputes))
}

/// `GET /api/matches/{id}/disputes` — list a match's disputes.
pub async fn list_match_disputes(
    service: web::Data<Arc<MatchService>>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let disputes = service.get_match_disputes(path.into_inner()).await?;
    Ok(HttpResponse::Ok().json(disputes))
}

/// `POST /api/matches/{id}/disputes/{dispute_id}/review` — start admin review.
pub async fn start_match_dispute_review(
    service: web::Data<Arc<MatchService>>,
    req: HttpRequest,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let admin_id = require_admin(&req)?;
    let (match_id, dispute_id) = path.into_inner();
    let existing = service.get_dispute(dispute_id).await?;
    if existing.match_id != match_id {
        return Err(ApiError::not_found("Dispute not found for this match"));
    }
    let dispute = service.start_dispute_review(dispute_id, admin_id).await?;
    Ok(HttpResponse::Ok().json(dispute))
}

/// `POST /api/matches/{id}/disputes/{dispute_id}/resolve` — admin resolution.
pub async fn resolve_match_dispute(
    service: web::Data<Arc<MatchService>>,
    notifications: web::Data<Arc<NotificationService>>,
    req: HttpRequest,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<ResolveMatchDisputeBody>,
) -> Result<HttpResponse, ApiError> {
    let admin_id = require_admin(&req)?;
    let (match_id, dispute_id) = path.into_inner();
    if body.resolution.trim().is_empty() {
        return Err(ApiError::bad_request("Resolution must not be empty"));
    }

    // Guard against resolving a dispute that belongs to a different match.
    let existing = service.get_dispute(dispute_id).await?;
    if existing.match_id != match_id {
        return Err(ApiError::not_found("Dispute not found for this match"));
    }

    let dispute = service
        .resolve_dispute(dispute_id, admin_id, body.resolution.clone(), body.winner_id)
        .await?;

    let match_details = service.get_match(match_id, None).await.ok();
    let recipients = match_details.map(|m| {
        let mut ids = vec![m.player1.id];
        if let Some(player2) = m.player2 { ids.push(player2.id); }
        ids
    }).unwrap_or_default();
    for recipient in recipients {
        let _ = notifications.create_and_fan_out(NewNotification {
            user_id: recipient,
            typ: "match_dispute_resolved".to_string(),
            title: "Match dispute resolved".to_string(),
            message: format!("The dispute for match {match_id} was resolved."),
            link: Some(format!("/matches/{match_id}")),
            link_label: Some("View match".to_string()),
        }).await;
    }

    Ok(HttpResponse::Ok().json(dispute))
}

/// `POST /api/matches/{id}/disputes/{dispute_id}/reject` — admin rejection.
pub async fn reject_match_dispute(
    service: web::Data<Arc<MatchService>>,
    notifications: web::Data<Arc<NotificationService>>,
    req: HttpRequest,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<RejectMatchDisputeBody>,
) -> Result<HttpResponse, ApiError> {
    let admin_id = require_admin(&req)?;
    let (match_id, dispute_id) = path.into_inner();
    if body.reason.trim().is_empty() {
        return Err(ApiError::bad_request("Rejection reason must not be empty"));
    }

    let existing = service.get_dispute(dispute_id).await?;
    if existing.match_id != match_id {
        return Err(ApiError::not_found("Dispute not found for this match"));
    }

    let dispute = service
        .reject_dispute(dispute_id, admin_id, body.reason.clone())
        .await?;

    let match_details = service.get_match(match_id, None).await.ok();
    let recipients = match_details.map(|m| {
        let mut ids = vec![m.player1.id];
        if let Some(player2) = m.player2 { ids.push(player2.id); }
        ids
    }).unwrap_or_default();
    for recipient in recipients {
        let _ = notifications.create_and_fan_out(NewNotification {
            user_id: recipient,
            typ: "match_dispute_rejected".to_string(),
            title: "Match dispute rejected".to_string(),
            message: format!("The dispute for match {match_id} was rejected: {}", body.reason.trim()),
            link: Some(format!("/matches/{match_id}")),
            link_label: Some("View match".to_string()),
        }).await;
    }

    Ok(HttpResponse::Ok().json(dispute))
}

/// `GET /api/matches/players/{user_id}/elo?game=...` — Elo rating.
pub async fn get_player_elo(
    service: web::Data<Arc<MatchService>>,
    path: web::Path<Uuid>,
    query: web::Query<GameQuery>,
) -> Result<HttpResponse, ApiError> {
    let elo = service
        .get_user_elo_rating(path.into_inner(), &query.game)
        .await?;
    Ok(HttpResponse::Ok().json(elo))
}

/// `GET /api/matches/players/{user_id}/history` — paginated match history.
pub async fn get_match_history(
    service: web::Data<Arc<MatchService>>,
    path: web::Path<Uuid>,
    query: web::Query<HistoryQuery>,
) -> Result<HttpResponse, ApiError> {
    let page = query.page.unwrap_or(1).max(1);
    let per_page = query.per_page.unwrap_or(20).clamp(1, 100);

    let history = service
        .get_user_match_history(path.into_inner(), page, per_page, query.game.clone())
        .await?;

    Ok(HttpResponse::Ok().json(history))
}

/// `POST /api/matches/queue/join` — join the matchmaking queue.
pub async fn join_queue(
    service: web::Data<Arc<MatchService>>,
    req: HttpRequest,
    body: web::Json<JoinQueueBody>,
) -> Result<HttpResponse, ApiError> {
    let user_id = authenticated_user(&req)?;
    let request = JoinMatchmakingRequest {
        game: body.game.clone(),
        game_mode: body.game_mode.clone(),
        max_wait_time: body.max_wait_time,
    };

    let entry = service.join_matchmaking(user_id, request).await?;
    Ok(HttpResponse::Created().json(entry))
}

/// `POST /api/matches/queue/leave` — leave the matchmaking queue.
pub async fn leave_queue(
    service: web::Data<Arc<MatchService>>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let user_id = authenticated_user(&req)?;
    service.leave_matchmaking(user_id).await?;

    Ok(HttpResponse::Ok().json(MatchMessageResponse {
        message: "Left matchmaking queue".to_string(),
    }))
}

/// `GET /api/matches/queue/status` — current queue status for the caller.
pub async fn queue_status(
    service: web::Data<Arc<MatchService>>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let user_id = authenticated_user(&req)?;
    let status = service.get_matchmaking_status(user_id).await?;
    Ok(HttpResponse::Ok().json(status))
}

// =============================================================================
// ROUTES
// =============================================================================

/// Register the match-microservice routes relative to the `/matches` scope.
///
/// Called from [`crate::http::match_authority_handler::configure_routes`] so
/// both modules share a single `/matches` scope without path collisions.
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/create", web::post().to(create_match))
        .route("/{id}/details", web::get().to(get_match_details))
        .route("/{id}/report", web::post().to(report_score))
        .route("/{id}/cancel", web::post().to(cancel_match))
        .route("/disputes/pending", web::get().to(list_pending_match_disputes))
        .route("/{id}/dispute", web::post().to(create_match_dispute))
        .route("/{id}/disputes", web::post().to(create_match_dispute))
        .route("/{id}/disputes", web::get().to(list_match_disputes))
        .route(
            "/{id}/disputes/{dispute_id}/review",
            web::post().to(start_match_dispute_review),
        )
        .route(
            "/{id}/disputes/{dispute_id}/resolve",
            web::post().to(resolve_match_dispute),
        )
        .route(
            "/{id}/disputes/{dispute_id}/reject",
            web::post().to(reject_match_dispute),
        )
        .route(
            "/{id}/dispute/{dispute_id}/review",
            web::post().to(start_match_dispute_review),
        )
        .route(
            "/{id}/dispute/{dispute_id}/resolve",
            web::post().to(resolve_match_dispute),
        )
        .route(
            "/{id}/dispute/{dispute_id}/reject",
            web::post().to(reject_match_dispute),
        )
        .route("/players/{user_id}/elo", web::get().to(get_player_elo))
        .route(
            "/players/{user_id}/history",
            web::get().to(get_match_history),
        )
        .route("/queue/join", web::post().to(join_queue))
        .route("/queue/leave", web::post().to(leave_queue))
        .route("/queue/status", web::get().to(queue_status));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_match_type_defaults_to_casual() {
        assert!(matches!(parse_match_type(None), MatchType::Casual));
        assert!(matches!(parse_match_type(Some("nonsense")), MatchType::Casual));
        assert!(matches!(parse_match_type(Some("RANKED")), MatchType::Ranked));
        assert!(matches!(
            parse_match_type(Some(" tournament ")),
            MatchType::Tournament
        ));
        assert!(matches!(parse_match_type(Some("practice")), MatchType::Practice));
    }

    #[test]
    fn report_score_body_deserializes() {
        let json = r#"{"score":5,"opponent_score":3,"proof_url":null,"telemetry_data":null}"#;
        let body: ReportScoreBody = serde_json::from_str(json).unwrap();
        assert_eq!(body.score, 5);
        assert_eq!(body.opponent_score, 3);
    }

    #[test]
    fn dispute_body_accepts_evidence_urls() {
        let json = r#"{"reason":"score mismatch","evidence_urls":["https://example.com/proof.png"]}"#;
        let body: CreateMatchDisputeBody = serde_json::from_str(json).unwrap();
        assert_eq!(body.reason, "score mismatch");
        assert_eq!(body.evidence_urls.unwrap().len(), 1);
    }
}
