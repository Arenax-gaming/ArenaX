use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::db::DbPool;
use crate::middleware::security::validate_uuid;
use crate::middleware::tenant_context::{with_tenant_scope, TenantContext};
use crate::models::{
    CreateTournamentRequest, JoinTournamentRequest, PaginatedResponse, TournamentParticipant,
    TournamentStatus,
};
use crate::service::tournament_service::TournamentService;
use actix_web::{web, HttpRequest, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

// ─── Query params ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ListTournamentsQuery {
    pub status: Option<String>,
    pub game: Option<String>,
    /// 1-indexed page number (default: 1).
    pub page: Option<i32>,
    /// Rows per page, clamped to 1–100 (default: 20).
    pub limit: Option<i32>,
}

#[derive(Deserialize)]
pub struct TournamentStatisticsQuery {
    pub include_participants: Option<bool>,
    pub include_matches: Option<bool>,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Return `ApiError::Forbidden` unless the caller has the `admin` role.
fn require_admin(req: &HttpRequest) -> Result<(), ApiError> {
    let claims = req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;
    if !claims.roles.contains(&"admin".to_string()) {
        return Err(ApiError::forbidden("Admin access required"));
    }
    Ok(())
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/// POST /api/tournaments
///
/// Create a tournament.  Requires `admin` or `organizer` role.
pub async fn create_tournament(
    svc: web::Data<Arc<TournamentService>>,
    req: HttpRequest,
    body: web::Json<CreateTournamentRequest>,
) -> Result<HttpResponse, ApiError> {
    let claims = req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;

    let is_privileged = claims.roles.contains(&"admin".to_string())
        || claims.roles.contains(&"organizer".to_string());
    if !is_privileged {
        return Err(ApiError::forbidden(
            "Only admins or organizers may create tournaments",
        ));
    }

    let creator_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;

    info!(creator_id = %creator_id, name = %body.name, "Creating tournament");

    let tournament = svc.create_tournament(creator_id, body.into_inner()).await?;

    Ok(HttpResponse::Created().json(tournament))
}

/// GET /api/tournaments
///
/// List tournaments with optional `status` and `game` filters.
/// Accepts `?page=1&limit=20` (max 100).
pub async fn list_tournaments(
    svc: web::Data<Arc<TournamentService>>,
    req: HttpRequest,
    query: web::Query<ListTournamentsQuery>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id(); // optional — guests can browse

    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).max(1).min(100);

    let status_filter = query
        .status
        .as_deref()
        .map(|s| match s {
            "draft" => Ok(TournamentStatus::Draft),
            "upcoming" => Ok(TournamentStatus::Upcoming),
            "registration_open" => Ok(TournamentStatus::RegistrationOpen),
            "registration_closed" => Ok(TournamentStatus::RegistrationClosed),
            "in_progress" => Ok(TournamentStatus::InProgress),
            "completed" => Ok(TournamentStatus::Completed),
            "cancelled" => Ok(TournamentStatus::Cancelled),
            other => Err(ApiError::bad_request(format!(
                "Unknown tournament status: {}",
                other
            ))),
        })
        .transpose()?;

    let list = svc
        .get_tournaments(user_id, page, limit, status_filter, query.game.clone())
        .await?;

    // Re-wrap in the shared PaginatedResponse envelope so the response shape
    // is consistent with every other list endpoint in the API.
    Ok(HttpResponse::Ok().json(PaginatedResponse {
        data: list.tournaments,
        total: list.total,
        page: list.page as i64,
        limit: list.per_page as i64,
    }))
}

/// GET /api/tournaments/{id}
///
/// Get tournament details with bracket.
pub async fn get_tournament(
    svc: web::Data<Arc<TournamentService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament_id = path.into_inner();
    validate_uuid(&tournament_id.to_string())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let user_id = req.user_id();
    let tournament = svc.get_tournament(tournament_id, user_id).await?;

    Ok(HttpResponse::Ok().json(tournament))
}

/// GET /api/tournaments/{id}/participants
///
/// Row-level-security-scoped (#1108): runs on a connection with
/// `app.tournament_id` set to this route's `{id}`, so even a bug in the
/// query below couldn't leak another tournament's participants — the
/// database itself won't return rows outside this tenant.
pub async fn get_tournament_participants(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament_id = path.into_inner();
    let ctx = req
        .extensions()
        .get::<TenantContext>()
        .cloned()
        .unwrap_or_default();

    let participants = with_tenant_scope(pool.get_ref(), &ctx, move |mut conn| async move {
        sqlx::query_as::<_, TournamentParticipant>(
            "SELECT * FROM tournament_participants WHERE tournament_id = $1 ORDER BY registered_at",
        )
        .bind(tournament_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(ApiError::DatabaseError)
    })
    .await?;

    Ok(HttpResponse::Ok().json(participants))
}

/// POST /api/tournaments/{id}/register
///
/// Register the authenticated user in the tournament, deducting the entry fee
/// from their wallet.
pub async fn register_for_tournament(
    svc: web::Data<Arc<TournamentService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
    body: web::Json<JoinTournamentRequest>,
) -> Result<HttpResponse, ApiError> {
    let tournament_id = path.into_inner();
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;

    info!(
        user_id = %user_id,
        tournament_id = %tournament_id,
        payment_method = %body.payment_method,
        "Tournament registration request"
    );

    let participant = svc
        .join_tournament(user_id, tournament_id, body.into_inner())
        .await?;

    Ok(HttpResponse::Created().json(participant))
}

/// POST /api/tournaments/{id}/start
///
/// Start the tournament and generate the initial bracket.  Admin only.
pub async fn start_tournament(
    svc: web::Data<Arc<TournamentService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;

    let tournament_id = path.into_inner();

    info!(tournament_id = %tournament_id, "Admin starting tournament");

    svc.update_tournament_status(tournament_id, TournamentStatus::InProgress)
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "message": "Tournament started and bracket generated",
        "tournament_id": tournament_id,
    })))
}

/// POST /api/tournaments/{id}/advance
///
/// Advance the tournament bracket to the next round.  Admin only.
pub async fn advance_bracket(
    svc: web::Data<Arc<TournamentService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;

    let tournament_id = path.into_inner();

    info!(tournament_id = %tournament_id, "Advancing tournament bracket");

    svc.advance_bracket(tournament_id).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "message": "Bracket advanced to next round",
        "tournament_id": tournament_id,
    })))
}

/// POST /api/tournaments/{id}/generate-bracket
///
/// Enqueue bracket generation in the background so large tournaments do not
/// block the HTTP request while the worker builds the bracket.
pub async fn generate_bracket_job(
    svc: web::Data<Arc<TournamentService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;

    let tournament_id = path.into_inner();
    let job = svc.enqueue_generate_bracket_job(tournament_id).await?;

    info!(tournament_id = %tournament_id, job_id = %job.id, "Bracket generation queued");

    Ok(HttpResponse::Accepted().json(serde_json::json!({
        "job_id": job.id,
        "status": "pending"
    })))
}

/// GET /api/jobs/{job_id}
pub async fn get_job_status(
    svc: web::Data<Arc<TournamentService>>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let job = svc.get_job_status(path.into_inner()).await?;
    Ok(HttpResponse::Ok().json(job))
}

/// POST /api/tournaments/{id}/distribute-prizes
///
/// Enqueue on-chain prize distribution for a completed tournament.  Admin only.
pub async fn distribute_prizes(
    svc: web::Data<Arc<TournamentService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;

    let tournament_id = path.into_inner();
    let job = svc.enqueue_prize_distribution_job(tournament_id).await?;

    info!(tournament_id = %tournament_id, job_id = %job.id, "Prize distribution queued");

    Ok(HttpResponse::Accepted().json(serde_json::json!({
        "job_id": job.id,
        "status": "pending"
    })))
}

/// DELETE /api/tournaments/{id}
///
/// Cancel the tournament and issue refunds to all registered participants.
/// Admin only.
pub async fn cancel_tournament(
    svc: web::Data<Arc<TournamentService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;

    let tournament_id = path.into_inner();

    info!(tournament_id = %tournament_id, "Admin cancelling tournament");

    let tournament = svc.cancel_tournament(tournament_id).await?;

    Ok(HttpResponse::Ok().json(tournament))
}

/// GET /api/tournaments/{id}/statistics
pub async fn get_tournament_statistics(
    svc: web::Data<Arc<TournamentService>>,
    path: web::Path<Uuid>,
    _query: web::Query<TournamentStatisticsQuery>,
) -> Result<HttpResponse, ApiError> {
    let tournament_id = path.into_inner();

    validate_uuid(&tournament_id.to_string())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let stats = svc.get_tournament_statistics(tournament_id).await?;

    Ok(HttpResponse::Ok().json(stats))
}

// ─── Route configuration ──────────────────────────────────────────────────────

/// Configure all tournament routes under `/tournaments`.
///
/// Call via `.configure(crate::http::tournament_handler::configure_routes)`
/// inside the existing `/api` scope.
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/tournaments")
            .route("", web::post().to(create_tournament))
            .route("", web::get().to(list_tournaments))
            .route("/{id}", web::get().to(get_tournament))
            .route("/{id}", web::delete().to(cancel_tournament))
            .route("/{id}/participants", web::get().to(get_tournament_participants))
            .route("/{id}/register", web::post().to(register_for_tournament))
            .route("/{id}/start", web::post().to(start_tournament))
            .route("/{id}/advance", web::post().to(advance_bracket))
            .route("/{id}/generate-bracket", web::post().to(generate_bracket_job))
            .route("/{id}/distribute-prizes", web::post().to(distribute_prizes))
            .route("/{id}/statistics", web::get().to(get_tournament_statistics)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[actix_web::test]
    async fn test_get_tournament_statistics() {
        // Placeholder — real test requires a running DB.
        assert!(true);
    }
}
