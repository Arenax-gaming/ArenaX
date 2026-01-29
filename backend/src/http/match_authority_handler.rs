use crate::api_error::ApiError;
use crate::models::match_authority::*;
use crate::service::match_authority_service::MatchAuthorityService;
use actix_web::{web, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

/// Application state containing the Match Authority Service
pub struct AppState {
    pub match_authority_service: Arc<MatchAuthorityService>,
    pub protocol_signer_secret: String,
}

// =============================================================================
// CREATE MATCH
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateMatchRequest {
    pub player_a: String,
    pub player_b: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
}

/// POST /api/matches
/// Create a new match
pub async fn create_match(
    state: web::Data<AppState>,
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

    let result = state
        .match_authority_service
        .create_match(dto, &state.protocol_signer_secret)
        .await?;

    Ok(HttpResponse::Created().json(result))
}

// =============================================================================
// START MATCH
// =============================================================================

/// POST /api/matches/:id/start
/// Start a match (transition to STARTED state)
pub async fn start_match(
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
) -> Result<impl Responder, ApiError> {
    let match_id = path.into_inner();

    info!(match_id = %match_id, "Received start match request");

    let result = state
        .match_authority_service
        .start_match(match_id, &state.protocol_signer_secret)
        .await?;

    Ok(HttpResponse::Ok().json(result))
}

// =============================================================================
// COMPLETE MATCH
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CompleteMatchRequest {
    pub winner: String,
}

/// POST /api/matches/:id/complete
/// Complete a match with a winner (transition to COMPLETED state)
pub async fn complete_match(
    state: web::Data<AppState>,
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

    let result = state
        .match_authority_service
        .complete_match(match_id, dto, &state.protocol_signer_secret)
        .await?;

    Ok(HttpResponse::Ok().json(result))
}

// =============================================================================
// RAISE DISPUTE
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct RaiseDisputeRequest {
    pub actor: String,
    pub reason: String,
}

/// POST /api/matches/:id/dispute
/// Raise a dispute for a completed match
pub async fn raise_dispute(
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
    req: web::Json<RaiseDisputeRequest>,
) -> Result<impl Responder, ApiError> {
    let match_id = path.into_inner();

    info!(
        match_id = %match_id,
        actor = %req.actor,
        "Received raise dispute request"
    );

    let result = state
        .match_authority_service
        .raise_dispute(
            match_id,
            &req.actor,
            req.reason.clone(),
            &state.protocol_signer_secret,
        )
        .await?;

    Ok(HttpResponse::Ok().json(result))
}

// =============================================================================
// FINALIZE MATCH
// =============================================================================

/// POST /api/matches/:id/finalize
/// Finalize a match (perform on-chain settlement)
pub async fn finalize_match(
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
) -> Result<impl Responder, ApiError> {
    let match_id = path.into_inner();

    info!(match_id = %match_id, "Received finalize match request");

    let result = state
        .match_authority_service
        .finalize_match(match_id, &state.protocol_signer_secret)
        .await?;

    Ok(HttpResponse::Ok().json(result))
}

// =============================================================================
// GET MATCH
// =============================================================================

/// GET /api/matches/:id
/// Get match details with transition history
pub async fn get_match(
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
) -> Result<impl Responder, ApiError> {
    let match_id = path.into_inner();

    info!(match_id = %match_id, "Received get match request");

    let result = state
        .match_authority_service
        .get_match(match_id)
        .await?;

    Ok(HttpResponse::Ok().json(result))
}

// =============================================================================
// RECONCILE MATCH
// =============================================================================

#[derive(Debug, Serialize)]
pub struct ReconcileResponse {
    pub match_id: Uuid,
    pub is_synchronized: bool,
    pub message: String,
}

/// POST /api/matches/:id/reconcile
/// Reconcile match state with blockchain
pub async fn reconcile_match(
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
) -> Result<impl Responder, ApiError> {
    let match_id = path.into_inner();

    info!(match_id = %match_id, "Received reconcile match request");

    let is_synchronized = state
        .match_authority_service
        .reconcile_match(match_id)
        .await?;

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

/// Configure Match Authority routes
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api/matches")
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
        let json = r#"{"player_a":"GAAAAAA","player_b":"GBBBBBBB","idempotency_key":"test-123"}"#;
        let req: CreateMatchRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.player_a, "GAAAAAA");
        assert_eq!(req.player_b, "GBBBBBBB");
        assert_eq!(req.idempotency_key, Some("test-123".to_string()));
    }

    #[test]
    fn test_complete_match_request_deserialization() {
        let json = r#"{"winner":"GAAAAAA"}"#;
        let req: CompleteMatchRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.winner, "GAAAAAA");
    }

    #[test]
    fn test_raise_dispute_request_deserialization() {
        let json = r#"{"actor":"GAAAAAA","reason":"Cheating detected"}"#;
        let req: RaiseDisputeRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.actor, "GAAAAAA");
        assert_eq!(req.reason, "Cheating detected");
    }
}
