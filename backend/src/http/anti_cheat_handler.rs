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
use crate::service::anti_cheat_config::{AntiCheatConfig, AntiCheatConfigStore};
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

/// Body for `PATCH /admin/anti-cheat/rules`.
///
/// Both fields are optional so a caller can change just the flag threshold or
/// just one rule. Unknown rule names are rejected rather than silently ignored.
#[derive(Debug, Deserialize)]
pub struct UpdateRulesRequest {
    #[serde(default)]
    pub flag_threshold: Option<u8>,
    #[serde(default)]
    pub rules: Vec<RuleUpdate>,
}

#[derive(Debug, Deserialize)]
pub struct RuleUpdate {
    pub name: String,
    #[serde(default)]
    pub weight: Option<u8>,
    #[serde(default)]
    pub threshold: Option<u32>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

/// PATCH /admin/anti-cheat/rules — update thresholds without a deploy
/// (Issue #1525).
///
/// The write is transactional and the in-memory cache is replaced from the
/// committed rows before responding, so the new rules apply immediately on this
/// instance; other instances pick them up within the 60-second refresh.
async fn patch_rules(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<sqlx::PgPool>,
    store: web::Data<Arc<AntiCheatConfigStore>>,
    body: web::Json<UpdateRulesRequest>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    if !is_admin(&claims) {
        return Err(ApiError::forbidden("Admin access required"));
    }
    let body = body.into_inner();

    if body.flag_threshold.map_or(false, |threshold| threshold > 100) {
        return Err(ApiError::bad_request("flag_threshold must be 0-100"));
    }
    for rule in &body.rules {
        if rule.weight.map_or(false, |weight| weight > 100) {
            return Err(ApiError::bad_request(format!(
                "weight for rule '{}' must be 0-100",
                rule.name
            )));
        }
        if rule.threshold.map_or(false, |threshold| threshold > i32::MAX as u32) {
            return Err(ApiError::bad_request(format!(
                "threshold for rule '{}' is out of range",
                rule.name
            )));
        }
    }

    let mut tx = db.begin().await.map_err(ApiError::database_error)?;

    if let Some(threshold) = body.flag_threshold {
        sqlx::query("UPDATE anti_cheat_settings SET flag_threshold = $1 WHERE id = TRUE")
            .bind(threshold as i16)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::database_error)?;
    }

    for rule in &body.rules {
        let updated = sqlx::query(
            r#"
            UPDATE anti_cheat_rules
            SET weight = COALESCE($2, weight),
                threshold = COALESCE($3, threshold),
                enabled = COALESCE($4, enabled)
            WHERE name = $1
            "#,
        )
        .bind(&rule.name)
        .bind(rule.weight.map(|weight| weight as i16))
        .bind(rule.threshold.map(|threshold| threshold as i32))
        .bind(rule.enabled)
        .execute(&mut *tx)
        .await
        .map_err(ApiError::database_error)?;

        if updated.rows_affected() == 0 {
            return Err(ApiError::not_found(format!(
                "Anti-cheat rule '{}' not found",
                rule.name
            )));
        }
    }

    tx.commit().await.map_err(ApiError::database_error)?;

    let config = AntiCheatConfig::load_from_db(db.get_ref())
        .await
        .map_err(ApiError::database_error)?;
    store.set_config(config.clone());

    Ok(HttpResponse::Ok().json(config))
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
    .route("/admin/anti-cheat/rules", web::patch().to(patch_rules))
    .route("/matches/{id}/analyze", web::post().to(post_match_analyze))
    .route("/matches/{id}/analysis", web::get().to(get_match_analysis));
}

/// Registers the absolute path documented in Issue #1525
/// (`PATCH /admin/anti-cheat/rules`) at the app level. The `/api`-prefixed
/// alias is registered by [`configure_routes`].
pub fn configure_admin(cfg: &mut web::ServiceConfig) {
    cfg.route("/admin/anti-cheat/rules", web::patch().to(patch_rules));
}

