//! HTTP surface for player suspensions (Issue #906).
//!
//! Moderator actions and player-facing appeal endpoints. Authorization is
//! deliberately explicit at each handler rather than folded into one guard:
//! the read endpoints split on *whose* record is being read, which a blanket
//! role check cannot express.

use actix_web::{web, HttpRequest, HttpResponse, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::db::DbPool;
use crate::service::suspension_service::{
    RestrictionScope, SuspensionService,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuspendRequest {
    pub user_id: Uuid,
    /// "all_access" | "competition" | "social" | "financial"
    pub scope: String,
    pub reason: String,
    /// Omit for a permanent ban.
    pub duration_hours: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiftRequest {
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppealRequest {
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewAppealRequest {
    pub accept: bool,
    pub response: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckQuery {
    /// Defaults to the broadest scope, so a caller that forgets the parameter
    /// gets the strictest answer rather than an accidental pass.
    pub scope: Option<String>,
}

#[derive(Debug, Serialize)]
struct Envelope<T> {
    data: T,
}

fn parse_scope(raw: &str) -> Result<RestrictionScope, ApiError> {
    Ok(match raw {
        "all_access" => RestrictionScope::AllAccess,
        "competition" => RestrictionScope::Competition,
        "social" => RestrictionScope::Social,
        "financial" => RestrictionScope::Financial,
        other => {
            return Err(ApiError::BadRequest(format!(
                "Unknown restriction scope '{other}'"
            )))
        }
    })
}

/// True when the caller is a moderator or admin.
///
/// Roles come off the JWT as a list, so this is a membership test rather than
/// an equality check — an admin who is also a moderator must not fail it.
fn is_moderator(req: &HttpRequest) -> bool {
    req.claims()
        .map(|c| {
            c.roles
                .iter()
                .any(|r| r == "admin" || r == "moderator")
        })
        .unwrap_or(false)
}

fn require_moderator(req: &HttpRequest) -> Result<Uuid, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;
    if !is_moderator(req) {
        return Err(ApiError::Forbidden);
    }
    Ok(user_id)
}

/// POST /api/suspensions — issue a suspension or a permanent ban.
pub async fn suspend_player(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    body: web::Json<SuspendRequest>,
) -> Result<HttpResponse, ApiError> {
    let moderator_id = require_moderator(&req)?;
    let service = SuspensionService::new(pool.get_ref().clone());
    let scope = parse_scope(&body.scope)?;

    let suspension = match body.duration_hours {
        Some(hours) => {
            service
                .suspend_temporarily(body.user_id, scope, &body.reason, hours, Some(moderator_id))
                .await?
        }
        None => {
            service
                .ban_permanently(body.user_id, scope, &body.reason, Some(moderator_id))
                .await?
        }
    };

    Ok(HttpResponse::Created().json(Envelope { data: suspension }))
}

/// POST /api/suspensions/{id}/lift — end a suspension early.
pub async fn lift_suspension(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
    body: web::Json<LiftRequest>,
) -> Result<HttpResponse, ApiError> {
    let moderator_id = require_moderator(&req)?;
    let service = SuspensionService::new(pool.get_ref().clone());

    let suspension = service
        .lift(path.into_inner(), moderator_id, &body.reason)
        .await?;

    Ok(HttpResponse::Ok().json(Envelope { data: suspension }))
}

/// GET /api/suspensions/me — the caller's own active suspensions.
pub async fn my_suspensions(
    req: HttpRequest,
    pool: web::Data<DbPool>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;
    let service = SuspensionService::new(pool.get_ref().clone());

    let suspensions = service.active_for_user(user_id).await?;
    Ok(HttpResponse::Ok().json(Envelope { data: suspensions }))
}

/// GET /api/suspensions/user/{id} — full history. Moderators only.
///
/// Separate from `/me` because the history includes moderator notes and the
/// full record of past offences, which a player has no business reading about
/// anyone else.
pub async fn user_history(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_moderator(&req)?;
    let service = SuspensionService::new(pool.get_ref().clone());

    let history = service.history_for_user(path.into_inner()).await?;
    Ok(HttpResponse::Ok().json(Envelope { data: history }))
}

/// GET /api/suspensions/check — can the caller do this?
///
/// Cheap enough to call from a gate in front of an action.
pub async fn check_restriction(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    query: web::Query<CheckQuery>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;
    let scope = parse_scope(query.scope.as_deref().unwrap_or("all_access"))?;

    let service = SuspensionService::new(pool.get_ref().clone());
    let check = service.check(user_id, scope).await?;

    Ok(HttpResponse::Ok().json(Envelope { data: check }))
}

/// POST /api/suspensions/{id}/appeal — a player contests a suspension.
pub async fn submit_appeal(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
    body: web::Json<AppealRequest>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;
    let service = SuspensionService::new(pool.get_ref().clone());

    // The service scopes the update by user_id, so a player cannot appeal
    // someone else's suspension even with a valid id.
    let suspension = service
        .submit_appeal(path.into_inner(), user_id, &body.text)
        .await?;

    Ok(HttpResponse::Ok().json(Envelope { data: suspension }))
}

/// GET /api/suspensions/appeals — the moderator queue.
pub async fn pending_appeals(
    req: HttpRequest,
    pool: web::Data<DbPool>,
) -> Result<HttpResponse, ApiError> {
    require_moderator(&req)?;
    let service = SuspensionService::new(pool.get_ref().clone());

    let appeals = service.pending_appeals(100).await?;
    Ok(HttpResponse::Ok().json(Envelope { data: appeals }))
}

/// POST /api/suspensions/{id}/appeal/review — decide an appeal.
pub async fn review_appeal(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
    body: web::Json<ReviewAppealRequest>,
) -> Result<HttpResponse, ApiError> {
    let reviewer_id = require_moderator(&req)?;
    let service = SuspensionService::new(pool.get_ref().clone());

    let suspension = service
        .review_appeal(path.into_inner(), reviewer_id, body.accept, &body.response)
        .await?;

    Ok(HttpResponse::Ok().json(Envelope { data: suspension }))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api/suspensions")
            // Fixed segments before the `{id}` routes so `/me`, `/check` and
            // `/appeals` are not swallowed as suspension ids.
            .route("/me", web::get().to(my_suspensions))
            .route("/check", web::get().to(check_restriction))
            .route("/appeals", web::get().to(pending_appeals))
            .route("/user/{id}", web::get().to(user_history))
            .route("", web::post().to(suspend_player))
            .route("/{id}/lift", web::post().to(lift_suspension))
            .route("/{id}/appeal", web::post().to(submit_appeal))
            .route("/{id}/appeal/review", web::post().to(review_appeal)),
    );
}
