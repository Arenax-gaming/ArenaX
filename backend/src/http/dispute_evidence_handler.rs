//! Dispute evidence upload with tamper-evident hash storage — Issues #1081, #1076.
//!
//! - `POST /api/matches/{id}/dispute/evidence` — upload a screenshot as the
//!   raw request body (`Content-Type: image/png|image/jpeg|image/webp`).
//!   Creates the dispute if one does not already exist for this match/player,
//!   hashes the bytes with SHA-256, stores them in S3, and persists the hash
//!   + S3 key.
//! - `GET  /api/matches/{id}/dispute` — the most recent dispute for the
//!   match, including `evidence_hash` so the player (or an admin) can
//!   re-hash the S3 object and confirm it was never swapped.

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::db::DbPool;
use crate::models::match_models::MatchDispute;
use crate::service::evidence_storage::{
    evidence_object_key, hash_evidence, validate_content_type, validate_evidence_size,
    validate_magic_bytes, EvidenceStore,
};
use crate::service::match_service::MatchService;
use actix_web::{web, HttpRequest, HttpResponse};
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct DisputeEvidenceResponse {
    #[serde(flatten)]
    pub dispute: MatchDispute,
}

/// POST /api/matches/{id}/dispute/evidence
pub async fn upload_dispute_evidence(
    req: HttpRequest,
    db: web::Data<DbPool>,
    store: web::Data<Arc<dyn EvidenceStore>>,
    path: web::Path<Uuid>,
    body: web::Bytes,
) -> Result<HttpResponse, ApiError> {
    let match_id = path.into_inner();
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;

    let content_type = req
        .headers()
        .get("Content-Type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default()
        .to_string();

    validate_content_type(&content_type)?;
    validate_evidence_size(body.len())?;
    validate_magic_bytes(&content_type, &body)?;

    let hash_hex = hash_evidence(&body);
    let s3_key = evidence_object_key(user_id, match_id, &content_type, &hash_hex);
    store.put(&s3_key, &content_type, &body).await?;

    let svc = MatchService::new(db.get_ref().clone());
    let dispute = svc
        .attach_dispute_evidence(match_id, user_id, &hash_hex, &s3_key)
        .await?;

    Ok(HttpResponse::Ok().json(DisputeEvidenceResponse { dispute }))
}

/// GET /api/matches/{id}/dispute
pub async fn get_match_dispute(
    db: web::Data<DbPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let match_id = path.into_inner();
    let svc = MatchService::new(db.get_ref().clone());
    let disputes = svc.get_match_disputes(match_id).await?;
    let latest = disputes
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::not_found("No dispute found for this match"))?;

    Ok(HttpResponse::Ok().json(DisputeEvidenceResponse { dispute: latest }))
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/matches").service(
            web::scope("/{id}/dispute")
                .route("", web::get().to(get_match_dispute))
                .route("/evidence", web::post().to(upload_dispute_evidence)),
        ),
    );
}
