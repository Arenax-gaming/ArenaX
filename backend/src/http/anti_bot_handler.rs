//! Anti-bot HTTP handlers — Issue #903.
//!
//! GET /api/anti-bot/status  — returns bot detection verdict for the caller
//! GET /api/anti-bot/metrics — returns aggregate detection counters (admin)

use crate::{
    api_error::ApiError,
    auth::middleware::ClaimsExt,
    middleware::anti_bot::{get_bot_metrics, AntiBotConfig, BotChallenge, BotDetectionResult},
};
use actix_web::{web, HttpRequest, HttpResponse};
use redis::aio::ConnectionManager;
use std::sync::Arc;

/// GET /api/anti-bot/status
///
/// Returns the bot-detection verdict for the requesting IP / user.
/// Frontend can call this to decide whether to render a CAPTCHA widget.
pub async fn get_bot_status(req: HttpRequest) -> HttpResponse {
    // Read X-Bot-Score set by the middleware (0 when not flagged)
    let score: u8 = req
        .headers()
        .get("x-bot-score")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let cfg = AntiBotConfig::default();
    let challenge = if score >= cfg.block_threshold {
        BotChallenge::Block
    } else if score >= cfg.captcha_threshold {
        BotChallenge::Captcha
    } else {
        BotChallenge::None
    };

    HttpResponse::Ok().json(BotDetectionResult {
        flagged: score > 0,
        score,
        reasons: vec![],
        challenge,
        retry_after: None,
    })
}

/// GET /api/anti-bot/metrics
///
/// Returns aggregate bot-detection counters. Requires admin role.
pub async fn get_bot_metrics_handler(
    req: HttpRequest,
    redis: web::Data<Arc<ConnectionManager>>,
) -> Result<HttpResponse, ApiError> {
    let claims = req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("Not authenticated"))?;

    if !claims.roles.contains(&"admin".to_string()) {
        return Err(ApiError::forbidden("Admin access required"));
    }

    let mut conn = redis.get_ref().as_ref().clone();
    let metrics = get_bot_metrics(&mut conn).await;
    Ok(HttpResponse::Ok().json(metrics))
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/anti-bot")
            .route("/status",  web::get().to(get_bot_status))
            .route("/metrics", web::get().to(get_bot_metrics_handler)),
    );
}
