//! Gameplay telemetry upload + match linkage HTTP surface.
//!
//! - `POST /api/telemetry` — validate a recorded session, upload it to
//!   S3/MinIO and link the resulting reference to the match record.
//! - `GET  /api/telemetry/{match_id}` — every recording linked to a match
//!   (admin only: it spans all players in the match).
//! - `GET  /api/telemetry/{match_id}/players/{player_id}` — one player's
//!   recording metadata; the player themselves or an admin.
//!
//! Uploads require authentication and a player may only submit their own
//! recording; admins may submit or read on behalf of any player.
//!
//! Expiry is not exposed here: retention is enforced by the background sweeper
//! ([`crate::service::TelemetryRetentionService`]), so nothing in the API can
//! delete a recording early or keep one alive past its window.

use crate::api_error::ApiError;
use crate::auth::jwt_service::{Claims, JwtService};
use crate::http::auth_handler::ACCESS_TOKEN_COOKIE;
use crate::models::telemetry::{TelemetryUploadRequest, MAX_TELEMETRY_BYTES};
use crate::service::TelemetryUploadService;
use actix_web::{web, HttpRequest, HttpResponse};
use std::sync::Arc;
use uuid::Uuid;

/// Slack added to the extractor limit so a body that is valid JSON but one byte
/// over the document cap is rejected by the service (422) rather than by the
/// extractor (413).
const TELEMETRY_BODY_LIMIT: usize = MAX_TELEMETRY_BYTES + 64 * 1024;

/// Extract and validate the caller's claims from the bearer token or the
/// access-token cookie.
async fn caller(req: &HttpRequest, jwt: &JwtService) -> Result<Claims, ApiError> {
    let token = req
        .headers()
        .get("Authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_owned)
        .or_else(|| {
            req.cookie(ACCESS_TOKEN_COOKIE)
                .map(|cookie| cookie.value().to_string())
        })
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;

    jwt.validate_token(&token)
        .await
        .map_err(|_| ApiError::unauthorized("Authentication required"))
}

fn is_admin(claims: &Claims) -> bool {
    claims.roles.iter().any(|role| role == "admin")
}

fn assert_can_act_for(claims: &Claims, player_id: Uuid) -> Result<(), ApiError> {
    if claims.sub == player_id.to_string() || is_admin(claims) {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "You can only submit telemetry for yourself",
        ))
    }
}

/// POST /api/telemetry
async fn post_telemetry(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    service: web::Data<Arc<TelemetryUploadService>>,
    body: web::Json<TelemetryUploadRequest>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    let request = body.into_inner();
    assert_can_act_for(&claims, request.player_id)?;

    let outcome = service.upload(request).await?;
    Ok(HttpResponse::Ok().json(outcome))
}

/// GET /api/telemetry/{match_id}/players/{player_id}
async fn get_player_telemetry(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    service: web::Data<Arc<TelemetryUploadService>>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    let (match_id, player_id) = path.into_inner();
    assert_can_act_for(&claims, player_id)?;

    let reference = service.metadata(match_id, player_id).await?;
    Ok(HttpResponse::Ok().json(reference))
}

/// GET /api/telemetry/{match_id}
async fn get_match_telemetry(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    service: web::Data<Arc<TelemetryUploadService>>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    if !is_admin(&claims) {
        return Err(ApiError::forbidden("Admin access required"));
    }

    let references = service.metadata_for_match(path.into_inner()).await?;
    Ok(HttpResponse::Ok().json(references))
}

/// Mounted inside the `/api` scope in `main.rs`.
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/telemetry")
            // Recordings legitimately exceed the default 2 MB JSON limit, so the
            // scope raises it to just above the document cap.
            .app_data(web::JsonConfig::default().limit(TELEMETRY_BODY_LIMIT))
            .route("", web::post().to(post_telemetry))
            .route("/{match_id}", web::get().to(get_match_telemetry))
            .route(
                "/{match_id}/players/{player_id}",
                web::get().to(get_player_telemetry),
            ),
    );
}
