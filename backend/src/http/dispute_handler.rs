//! Dispute resolution HTTP handlers (Issue #909).
//!
//! Any authenticated user can open a ticket, add evidence to their own
//! ticket, and read tickets they opened. Assigning, escalating, resolving,
//! and rejecting are moderator/admin actions.

use actix_web::{web, HttpRequest, HttpResponse};
use sqlx::PgPool;
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::models::{
    AddEvidenceRequest, AssignDisputeRequest, CreateTicketRequest, EscalateDisputeRequest,
    ListDisputesQuery, PaginationParams, RejectDisputeRequest, ResolveDisputeRequest,
};
use crate::service::DisputeService;

/// Require the caller to hold the `admin` or `moderator` role.
///
/// Mirrors `tournament_handler::require_admin`'s shape; disputes are handled
/// by moderators day-to-day, with admins as the final escalation tier, so
/// both roles pass here and the escalation *level* (not the caller's role)
/// is what actually gates how far a ticket has progressed.
fn require_staff(req: &HttpRequest) -> Result<Uuid, ApiError> {
    let claims = req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;
    let is_staff = claims.roles.contains(&"admin".to_string())
        || claims.roles.contains(&"moderator".to_string());
    if !is_staff {
        return Err(ApiError::forbidden("Moderator or admin access required"));
    }
    req.user_id()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))
}

fn require_user(req: &HttpRequest) -> Result<Uuid, ApiError> {
    req.user_id()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))
}

/// POST /api/disputes - Open a new dispute ticket.
pub async fn create_dispute(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<CreateTicketRequest>,
) -> Result<HttpResponse, ApiError> {
    let user_id = require_user(&req)?;
    let service = DisputeService::new(pool.get_ref().clone());

    let dispute = service.create_dispute(user_id, body.into_inner()).await?;

    Ok(HttpResponse::Created().json(serde_json::json!({
        "data": dispute,
        "ticketId": dispute.ticket_id(),
    })))
}

/// GET /api/disputes/:id - Full detail: dispute + history + evidence.
///
/// Open to the ticket's own opener or to staff -- not to arbitrary users.
pub async fn get_dispute(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user_id = require_user(&req)?;
    let service = DisputeService::new(pool.get_ref().clone());
    let dispute_id = path.into_inner();

    let dispute = service.get_dispute(dispute_id).await?;
    let claims = req.claims();
    let is_staff = claims
        .as_ref()
        .map(|c| {
            c.roles.contains(&"admin".to_string()) || c.roles.contains(&"moderator".to_string())
        })
        .unwrap_or(false);
    if dispute.opened_by != user_id && !is_staff {
        return Err(ApiError::forbidden("You may only view your own disputes"));
    }

    let detail = service.get_dispute_detail(dispute_id).await?;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "data": detail })))
}

/// GET /api/disputes - List disputes (staff only; use `/api/disputes/mine`
/// for a user's own tickets).
pub async fn list_disputes(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    query: web::Query<ListDisputesQuery>,
    pagination: web::Query<PaginationParams>,
) -> Result<HttpResponse, ApiError> {
    require_staff(&req)?;
    let service = DisputeService::new(pool.get_ref().clone());

    let limit = pagination.resolved_limit();
    let offset = pagination.sql_offset();
    let (disputes, total) = service.list_disputes(&query, limit, offset).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "data": disputes,
        "total": total,
        "page": pagination.resolved_page(),
        "limit": limit,
    })))
}

/// GET /api/disputes/mine - Disputes the caller opened.
pub async fn list_my_disputes(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    pagination: web::Query<PaginationParams>,
) -> Result<HttpResponse, ApiError> {
    let user_id = require_user(&req)?;
    let service = DisputeService::new(pool.get_ref().clone());

    let filter = ListDisputesQuery {
        status: None,
        category: None,
        assigned_to: None,
        opened_by: Some(user_id),
    };
    let limit = pagination.resolved_limit();
    let offset = pagination.sql_offset();
    let (disputes, total) = service.list_disputes(&filter, limit, offset).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "data": disputes,
        "total": total,
        "page": pagination.resolved_page(),
        "limit": limit,
    })))
}

/// POST /api/disputes/:id/evidence - Attach evidence metadata.
///
/// Open to the ticket's own opener or to staff.
pub async fn add_evidence(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    path: web::Path<Uuid>,
    body: web::Json<AddEvidenceRequest>,
) -> Result<HttpResponse, ApiError> {
    let user_id = require_user(&req)?;
    let service = DisputeService::new(pool.get_ref().clone());
    let dispute_id = path.into_inner();

    let dispute = service.get_dispute(dispute_id).await?;
    let claims = req.claims();
    let is_staff = claims
        .as_ref()
        .map(|c| {
            c.roles.contains(&"admin".to_string()) || c.roles.contains(&"moderator".to_string())
        })
        .unwrap_or(false);
    if dispute.opened_by != user_id && !is_staff {
        return Err(ApiError::forbidden(
            "You may only add evidence to your own disputes",
        ));
    }

    let evidence = service
        .add_evidence(dispute_id, user_id, body.into_inner())
        .await?;

    Ok(HttpResponse::Created().json(serde_json::json!({ "data": evidence })))
}

/// GET /api/disputes/:id/evidence - List evidence for a dispute.
pub async fn list_evidence(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user_id = require_user(&req)?;
    let service = DisputeService::new(pool.get_ref().clone());
    let dispute_id = path.into_inner();

    let dispute = service.get_dispute(dispute_id).await?;
    let claims = req.claims();
    let is_staff = claims
        .as_ref()
        .map(|c| {
            c.roles.contains(&"admin".to_string()) || c.roles.contains(&"moderator".to_string())
        })
        .unwrap_or(false);
    if dispute.opened_by != user_id && !is_staff {
        return Err(ApiError::forbidden(
            "You may only view evidence on your own disputes",
        ));
    }

    let evidence = service.list_evidence(dispute_id).await?;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "data": evidence })))
}

/// GET /api/disputes/:id/history - Resolution history (staff only).
pub async fn get_history(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_staff(&req)?;
    let service = DisputeService::new(pool.get_ref().clone());

    let history = service.get_history(path.into_inner()).await?;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "data": history })))
}

/// POST /api/disputes/:id/assign - Assign a dispute to a staff member.
pub async fn assign_dispute(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    path: web::Path<Uuid>,
    body: web::Json<AssignDisputeRequest>,
) -> Result<HttpResponse, ApiError> {
    let actor_id = require_staff(&req)?;
    let service = DisputeService::new(pool.get_ref().clone());

    let dispute = service
        .assign_dispute(path.into_inner(), body.assigned_to, actor_id)
        .await?;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "data": dispute })))
}

/// POST /api/disputes/:id/review - Move a dispute from `open` to
/// `under_review`.
pub async fn start_review(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let actor_id = require_staff(&req)?;
    let service = DisputeService::new(pool.get_ref().clone());

    let dispute = service.start_review(path.into_inner(), actor_id).await?;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "data": dispute })))
}

/// POST /api/disputes/:id/escalate - Escalate to the next tier.
pub async fn escalate_dispute(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    path: web::Path<Uuid>,
    body: web::Json<EscalateDisputeRequest>,
) -> Result<HttpResponse, ApiError> {
    let actor_id = require_staff(&req)?;
    let service = DisputeService::new(pool.get_ref().clone());

    let dispute = service
        .escalate_dispute(path.into_inner(), actor_id, body.into_inner().note)
        .await?;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "data": dispute })))
}

/// POST /api/disputes/:id/resolve - Resolve a dispute (notifies the opener).
pub async fn resolve_dispute(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    path: web::Path<Uuid>,
    body: web::Json<ResolveDisputeRequest>,
) -> Result<HttpResponse, ApiError> {
    let actor_id = require_staff(&req)?;
    let service = DisputeService::new(pool.get_ref().clone());

    let dispute = service
        .resolve_dispute(path.into_inner(), actor_id, body.into_inner().resolution)
        .await?;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "data": dispute })))
}

/// POST /api/disputes/:id/reject - Reject a dispute (notifies the opener).
pub async fn reject_dispute(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    path: web::Path<Uuid>,
    body: web::Json<RejectDisputeRequest>,
) -> Result<HttpResponse, ApiError> {
    let actor_id = require_staff(&req)?;
    let service = DisputeService::new(pool.get_ref().clone());

    let dispute = service
        .reject_dispute(path.into_inner(), actor_id, body.into_inner().reason)
        .await?;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "data": dispute })))
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/disputes")
            .route("", web::post().to(create_dispute))
            .route("", web::get().to(list_disputes))
            .route("/mine", web::get().to(list_my_disputes))
            .route("/{id}", web::get().to(get_dispute))
            .route("/{id}/evidence", web::post().to(add_evidence))
            .route("/{id}/evidence", web::get().to(list_evidence))
            .route("/{id}/history", web::get().to(get_history))
            .route("/{id}/assign", web::post().to(assign_dispute))
            .route("/{id}/review", web::post().to(start_review))
            .route("/{id}/escalate", web::post().to(escalate_dispute))
            .route("/{id}/resolve", web::post().to(resolve_dispute))
            .route("/{id}/reject", web::post().to(reject_dispute)),
    );
}