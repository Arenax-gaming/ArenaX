use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::models::match_authority::*;
use crate::service::match_authority_service::MatchAuthorityService;
use actix_web::{web, HttpRequest, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

/// Newtype wrapper for the protocol signer secret registered in `app_data`.
///
/// Using a dedicated type (rather than bare `web::Data<String>`) avoids
/// ambiguity when actix-web resolves `app_data` entries by type.
#[derive(Clone)]
pub struct SignerSecret(pub String);

impl std::ops::Deref for SignerSecret {
    type Target = str;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

// =============================================================================
// REQUEST TYPES
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateMatchRequest {
    pub player_a: String,
    pub player_b: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CompleteMatchRequest {
    pub winner: String,
}

#[derive(Debug, Deserialize)]
pub struct RaiseDisputeRequest {
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct ReconcileResponse {
    pub match_id: Uuid,
    pub is_synchronized: bool,
    pub message: String,
}

// =============================================================================
// HANDLERS
// =============================================================================

/// POST /api/matches
///
/// Create a new match.  The idempotency middleware is active on this route
/// (configured in main.rs via [`IdempotencyMiddleware`]).
pub async fn create_match(
    svc: web::Data<Arc<MatchAuthorityService>>,
    signer_secret: web::Data<SignerSecret>,
    req: web::Json<CreateMatchRequest>,
) -> Result<impl Responder, ApiError> {
    info!(
        player_a = %req.player_a,
        player_b = %req.player_b,
        "Received create match request"
    );

    let dto = CreateMatchDTO {
        player_a: req.player_a.clone(),
        player_b: req.player_b.clone(),
        idempotency_key: req.idempotency_key.clone(),
    };

    let result = svc.create_match(dto, &signer_secret).await?;

    Ok(HttpResponse::Created().json(result))
}

/// POST /api/matches/{id}/start
pub async fn start_match(
    svc: web::Data<Arc<MatchAuthorityService>>,
    signer_secret: web::Data<SignerSecret>,
    path: web::Path<Uuid>,
) -> Result<impl Responder, ApiError> {
    let match_id = path.into_inner();

    info!(match_id = %match_id, "Received start match request");

    let result = svc.start_match(match_id, &signer_secret).await?;

    Ok(HttpResponse::Ok().json(result))
}

/// POST /api/matches/{id}/complete
pub async fn complete_match(
    svc: web::Data<Arc<MatchAuthorityService>>,
    signer_secret: web::Data<SignerSecret>,
    path: web::Path<Uuid>,
    req: web::Json<CompleteMatchRequest>,
) -> Result<impl Responder, ApiError> {
    let match_id = path.into_inner();

    info!(
        match_id = %match_id,
        winner = %req.winner,
        "Received complete match request"
    );

    let dto = CompleteMatchDTO {
        winner: req.winner.clone(),
    };

    let result = svc.complete_match(match_id, dto, &signer_secret).await?;

    Ok(HttpResponse::Ok().json(result))
}

/// POST /api/matches/{id}/dispute
pub async fn raise_dispute(
    svc: web::Data<Arc<MatchAuthorityService>>,
    signer_secret: web::Data<SignerSecret>,
    path: web::Path<Uuid>,
    req: web::Json<RaiseDisputeRequest>,
) -> Result<impl Responder, ApiError> {
    let match_id = path.into_inner();

    info!(
        match_id = %match_id,
        actor = %req.actor,
        "Received raise dispute request"
    );

    let result = svc
        .raise_dispute(
            match_id,
            &req.actor,
            req.reason.clone(),
            &signer_secret,
        )
        .await?;

    Ok(HttpResponse::Ok().json(result))
}

/// POST /api/matches/{id}/finalize
///
/// Triggers on-chain settlement.  Only the match participants or users with
/// the `admin` role may call this endpoint.
pub async fn finalize_match(
    svc: web::Data<Arc<MatchAuthorityService>>,
    signer_secret: web::Data<SignerSecret>,
    path: web::Path<Uuid>,
    http_req: HttpRequest,
) -> Result<impl Responder, ApiError> {
    let match_id = path.into_inner();

    // ── Authorization check ───────────────────────────────────────────────
    // Fetch the match first so we know who the participants are, then verify
    // the caller is one of them or holds the "admin" role.
    let match_data = svc.get_match(match_id).await?;

    let claims = http_req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;

    let is_admin = claims.roles.contains(&"admin".to_string());
    let caller_id = claims.sub.clone();

    if !is_admin && caller_id != match_data.player_a && caller_id != match_data.player_b {
        return Err(ApiError::forbidden(
            "Only match participants or admins may finalize a match",
        ));
    }

    info!(
        match_id = %match_id,
        caller  = %caller_id,
        is_admin,
        "Received finalize match request"
    );

    let result = svc.finalize_match(match_id, &signer_secret).await?;

    Ok(HttpResponse::Ok().json(result))
}

/// GET /api/matches/{id}
pub async fn get_match(
    svc: web::Data<Arc<MatchAuthorityService>>,
    path: web::Path<Uuid>,
) -> Result<impl Responder, ApiError> {
    let match_id = path.into_inner();

    info!(match_id = %match_id, "Received get match request");

    let result = svc.get_match(match_id).await?;

    Ok(HttpResponse::Ok().json(result))
}

/// POST /api/matches/{id}/reconcile
pub async fn reconcile_match(
    svc: web::Data<Arc<MatchAuthorityService>>,
    path: web::Path<Uuid>,
) -> Result<impl Responder, ApiError> {
    let match_id = path.into_inner();

    info!(match_id = %match_id, "Received reconcile match request");

    let is_synchronized = svc.reconcile_match(match_id).await?;

    let response = ReconcileResponse {
        match_id,
        is_synchronized,
        message: if is_synchronized {
            "Match state is synchronized".to_string()
        } else {
            "Match state divergence detected".to_string()
        },
    };

    Ok(HttpResponse::Ok().json(response))
}

// =============================================================================
// ROUTE CONFIGURATION
// =============================================================================

/// Configure Match Authority routes.
///
/// Call via `.configure(crate::http::match_authority_handler::configure_routes)`
/// inside an existing `/api` scope.  Opens a `/matches` sub-scope so paths
/// resolve to `/api/matches/…`.
///
/// Requires the following items already registered in `app_data`:
/// - `web::Data<Arc<MatchAuthorityService>>`
/// - `web::Data<SignerSecret>` (the protocol signer secret)
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/matches")
            .route("", web::post().to(create_match))
            .route("/{id}", web::get().to(get_match))
            .route("/{id}/start", web::post().to(start_match))
            .route("/{id}/complete", web::post().to(complete_match))
            .route("/{id}/dispute", web::post().to(raise_dispute))
            .route("/{id}/finalize", web::post().to(finalize_match))
            .route("/{id}/reconcile", web::post().to(reconcile_match)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_match_request_deserialization() {
        let json =
            r#"{"player_a":"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","player_b":"GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","idempotency_key":"test-123"}"#;
        let req: CreateMatchRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.idempotency_key, Some("test-123".to_string()));
    }

    #[test]
    fn test_complete_match_request_deserialization() {
        let json = r#"{"winner":"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}"#;
        let req: CompleteMatchRequest = serde_json::from_str(json).unwrap();
        assert_eq!(
            req.winner,
            "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        );
    }

    #[test]
    fn test_raise_dispute_request_deserialization() {
        let json = r#"{"actor":"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","reason":"Cheating detected"}"#;
        let req: RaiseDisputeRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.reason, "Cheating detected");
    }
}
