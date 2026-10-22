//! Anti-cheat microservice HTTP surface (Issue #1281).
//!
//! - `POST /api/anticheat/screenshot` — run the screenshot analysis pipeline
//!   against evidence already stored in S3/MinIO.
//! - `POST /api/anticheat/telemetry`  — run the telemetry analysis pipeline
//!   against a single frame; suspicious frames produce a recorded finding.
//! - `GET  /api/anticheat/findings/{match_id}` — list the findings recorded
//!   for a match.
//! - `GET  /api/anticheat/players/{player_id}/flags` — a player's flag
//!   history; the player themselves or an admin (Issue #1233).
//! - `GET  /api/anticheat/review-queue?limit=N` — unreviewed flagged findings
//!   awaiting admin review; admin only (Issue #1233).
//!
//! All routes require authentication. A player may only submit analysis for
//! themselves; admins may submit on behalf of any player.

use crate::api_error::ApiError;
use crate::auth::jwt_service::{Claims, JwtService};
use crate::http::auth_handler::ACCESS_TOKEN_COOKIE;
use crate::service::anti_cheat_service::{
    AntiCheatService, Finding, FindingSource, ScreenshotAnalysisRequest, TelemetryFrame,
};
use actix_web::{web, HttpRequest, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

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
            "You can only submit anti-cheat analysis for yourself",
        ))
    }
}

/// POST /api/anticheat/screenshot
async fn post_screenshot(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    service: web::Data<Arc<AntiCheatService>>,
    body: web::Json<ScreenshotAnalysisRequest>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    let body = body.into_inner();
    assert_can_act_for(&claims, body.player_id)?;

    let finding = service
        .analyze_screenshot(
            body.match_id,
            body.player_id,
            &body.evidence_key,
            body.evidence_hash.as_deref(),
            &body.content_type,
        )
        .await?;

    Ok(HttpResponse::Ok().json(finding))
}

/// Body for `POST /api/matches/{id}/analyze`.
#[derive(Debug, Deserialize)]
struct MatchAnalyzeRequest {
    player_id: Uuid,
    evidence_key: String,
    #[serde(default)]
    evidence_hash: Option<String>,
    #[serde(default)]
    content_type: Option<String>,
}

/// POST /api/matches/{id}/analyze — fetch a match screenshot from S3/MinIO and
/// run the tampering analysis (Issue #1232).
async fn post_match_analyze(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    service: web::Data<Arc<AntiCheatService>>,
    path: web::Path<Uuid>,
    body: web::Json<MatchAnalyzeRequest>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    let body = body.into_inner();
    assert_can_act_for(&claims, body.player_id)?;

    let finding = service
        .analyze_screenshot(
            path.into_inner(),
            body.player_id,
            &body.evidence_key,
            body.evidence_hash.as_deref(),
            body.content_type.as_deref().unwrap_or("image/png"),
        )
        .await?;

    Ok(HttpResponse::Ok().json(analysis_view(&finding)))
}

/// GET /api/matches/{id}/analysis — screenshot analysis results with confidence.
async fn get_match_analysis(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    service: web::Data<Arc<AntiCheatService>>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    caller(&req, jwt.get_ref()).await?;
    let results: Vec<_> = service
        .list_findings(path.into_inner())
        .await?
        .iter()
        .filter(|f| f.source == FindingSource::Screenshot)
        .map(analysis_view)
        .collect();
    Ok(HttpResponse::Ok().json(results))
}

fn analysis_view(finding: &Finding) -> serde_json::Value {
    serde_json::json!({
        "finding_id": finding.id,
        "match_id": finding.match_id,
        "player_id": finding.player_id,
        "manipulated": finding.flagged,
        "confidence": finding.score as f64 / 100.0,
        "reasons": finding.reasons,
        "evidence_key": finding.evidence_key,
        "analyzed_at": finding.created_at,
    })
}

/// POST /api/anticheat/telemetry
async fn post_telemetry(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    service: web::Data<Arc<AntiCheatService>>,
    body: web::Json<TelemetryFrame>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    let frame = body.into_inner();
    assert_can_act_for(&claims, frame.player_id)?;

    let (result, finding) = service.ingest_telemetry(frame).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "result": result,
        "finding": finding,
    })))
}

/// GET /api/anticheat/findings/{match_id}
async fn get_findings(
    service: web::Data<Arc<AntiCheatService>>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let findings = service.list_findings(path.into_inner()).await?;
    Ok(HttpResponse::Ok().json(findings))
}

/// GET /api/anticheat/players/{player_id}/flags
async fn get_player_flags(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    service: web::Data<Arc<AntiCheatService>>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    let player_id = path.into_inner();
    if claims.sub != player_id.to_string() && !is_admin(&claims) {
        return Err(ApiError::forbidden("You can only view your own flag history"));
    }

    let flags = service.list_player_flags(player_id).await?;
    Ok(HttpResponse::Ok().json(flags))
}

#[derive(Debug, Deserialize)]
struct ReviewQueueQuery {
    #[serde(default = "default_review_queue_limit")]
    limit: i64,
}

fn default_review_queue_limit() -> i64 {
    50
}

/// GET /api/anticheat/review-queue
async fn get_review_queue(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    service: web::Data<Arc<AntiCheatService>>,
    query: web::Query<ReviewQueueQuery>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    if !is_admin(&claims) {
        return Err(ApiError::forbidden("Admin access required"));
    }

    let queue = service.list_review_queue(query.limit).await?;
    Ok(HttpResponse::Ok().json(queue))
}

/// Mounted inside the `/api` scope in `main.rs`.
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/anticheat")
            .route("/screenshot", web::post().to(post_screenshot))
            .route("/telemetry", web::post().to(post_telemetry))
            .route("/findings/{match_id}", web::get().to(get_findings))
            .route("/players/{player_id}/flags", web::get().to(get_player_flags))
            .route("/review-queue", web::get().to(get_review_queue)),
    )
    .route("/matches/{id}/analyze", web::post().to(post_match_analyze))
    .route("/matches/{id}/analysis", web::get().to(get_match_analysis));
}
