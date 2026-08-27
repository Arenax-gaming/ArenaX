//! Anti-bot detection middleware — Issue #903.
//!
//! Detects and throttles bot-like traffic before it reaches handlers.
//!
//! # Detection signals
//!
//! | Signal                     | Key                          | Threshold |
//! |----------------------------|------------------------------|-----------|
//! | Rapid requests             | `bot:rapid:{ip}`             | > 30 req / 10 s |
//! | Missing `User-Agent`       | per-request header check     | present? |
//! | Headless/known-bot UA      | substring match              | see BOT_SIGNATURES |
//! | Missing `Accept` header    | per-request header check     | present? |
//! | Missing `Accept-Language`  | per-request header check     | present? |
//!
//! # Actions on detection
//!
//! | Threat level | Action                                            |
//! |--------------|---------------------------------------------------|
//! | Low (1 sig)  | Set `X-Bot-Score` header, continue                |
//! | Medium (2+)  | Return 429 with `captcha` challenge in body       |
//! | High (block) | Return 403, temp-block IP for `block_secs`        |
//!
//! # Metrics
//!
//! Every detection increments Redis counters readable by the admin handler:
//! - `bot:metrics:rapid_requests`
//! - `bot:metrics:missing_headers`
//! - `bot:metrics:known_signature`
//! - `bot:metrics:captcha_challenges`
//! - `bot:metrics:blocks`

use std::{
    future::{ready, Ready},
    rc::Rc,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use super::extract_ip;

use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    HttpResponse,
};
use futures_util::future::LocalBoxFuture;
use redis::aio::ConnectionManager;
use serde::Serialize;
use tracing::warn;

// ─── Known bot / headless browser signatures ─────────────────────────────────

static BOT_SIGNATURES: &[&str] = &[
    "headlesschrome",
    "phantomjs",
    "selenium",
    "webdriver",
    "puppeteer",
    "playwright",
    "python-requests",
    "go-http-client",
    "curl/",
    "wget/",
    "scrapy",
    "axios/",
    "okhttp/",
    "java/",
    "libwww-perl",
];

// ─── Config ───────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct AntiBotConfig {
    /// Max requests in `rapid_window_secs` before flagging as rapid-bot
    pub rapid_threshold: u32,
    /// Window in seconds for rapid-request counting
    pub rapid_window_secs: u64,
    /// How long (seconds) a blocked IP stays blocked
    pub block_secs: u64,
    /// Score threshold for CAPTCHA challenge (inclusive)
    pub captcha_threshold: u8,
    /// Score threshold for full block (inclusive)
    pub block_threshold: u8,
    /// Paths to skip bot checking (e.g. static assets, health)
    pub skip_paths: Vec<String>,
}

impl Default for AntiBotConfig {
    fn default() -> Self {
        Self {
            rapid_threshold: 30,
            rapid_window_secs: 10,
            block_secs: 600,
            captcha_threshold: 2,
            block_threshold: 4,
            skip_paths: vec![
                "/api/health".to_string(),
                "/api/docs".to_string(),
            ],
        }
    }
}

// ─── Detection result ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct BotDetectionResult {
    pub flagged: bool,
    pub score: u8,
    pub reasons: Vec<String>,
    pub challenge: BotChallenge,
    pub retry_after: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BotChallenge {
    None,
    Captcha,
    Block,
}

// ─── Transform (factory) ─────────────────────────────────────────────────────

pub struct AntiBotMiddleware {
    redis: Arc<ConnectionManager>,
    config: Arc<AntiBotConfig>,
}

impl AntiBotMiddleware {
    pub fn new(redis: ConnectionManager, config: AntiBotConfig) -> Self {
        Self {
            redis: Arc::new(redis),
            config: Arc::new(config),
        }
    }
}

impl<S, B> Transform<S, ServiceRequest> for AntiBotMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = actix_web::Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = actix_web::Error;
    type InitError = ();
    type Transform = AntiBotService<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(AntiBotService {
            service: Rc::new(service),
            redis: self.redis.clone(),
            config: self.config.clone(),
        }))
    }
}

// ─── Service ─────────────────────────────────────────────────────────────────

pub struct AntiBotService<S> {
    service: Rc<S>,
    redis: Arc<ConnectionManager>,
    config: Arc<AntiBotConfig>,
}

impl<S, B> Service<ServiceRequest> for AntiBotService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = actix_web::Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = actix_web::Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let svc = self.service.clone();
        let redis = self.redis.clone();
        let config = self.config.clone();

        Box::pin(async move {
            let path = req.path().to_string();

            // Skip configured paths
            if config.skip_paths.iter().any(|p| path.starts_with(p.as_str())) {
                return Ok(svc.call(req).await?.map_into_left_body());
            }

            // Skip bot detection for whitelisted IPs
            if req.extensions().get::<super::ip_list::IpWhitelisted>().is_some() {
                return Ok(svc.call(req).await?.map_into_left_body());
            }

            let ip = extract_ip(&req);
            let mut conn = (*redis).clone();

            // ── 1. Check existing block ───────────────────────────────────────
            let block_key = format!("bot:block:{}", ip);
            let is_blocked: bool = redis::cmd("EXISTS")
                .arg(&block_key)
                .query_async(&mut conn)
                .await
                .unwrap_or(false);

            if is_blocked {
                let ttl: i64 = redis::cmd("TTL")
                    .arg(&block_key)
                    .query_async(&mut conn)
                    .await
                    .unwrap_or(config.block_secs as i64);
                inc_metric(&mut conn, "bot:metrics:blocks").await;
                let resp = HttpResponse::Forbidden().json(BotDetectionResult {
                    flagged: true,
                    score: 10,
                    reasons: vec!["ip_blocked".to_string()],
                    challenge: BotChallenge::Block,
                    retry_after: Some(ttl.max(0) as u64),
                });
                return Ok(req.into_response(resp).map_into_right_body());
            }

            // ── 2. Score the request ──────────────────────────────────────────
            let detection = score_request(&req, &ip, &mut conn, &config).await;

            // Attach score header on every response
            req.headers();

            if detection.score >= config.block_threshold {
                // Block the IP
                let _: () = redis::cmd("SETEX")
                    .arg(&block_key)
                    .arg(config.block_secs)
                    .arg(1u8)
                    .query_async(&mut conn)
                    .await
                    .unwrap_or(());
                inc_metric(&mut conn, "bot:metrics:blocks").await;
                warn!(ip = %ip, score = detection.score, reasons = ?detection.reasons, "Bot blocked");
                let resp = HttpResponse::Forbidden().json(&detection);
                return Ok(req.into_response(resp).map_into_right_body());
            }

            if detection.score >= config.captcha_threshold {
                inc_metric(&mut conn, "bot:metrics:captcha_challenges").await;
                warn!(ip = %ip, score = detection.score, reasons = ?detection.reasons, "Bot CAPTCHA challenge");
                let resp = HttpResponse::TooManyRequests().json(&detection);
                return Ok(req.into_response(resp).map_into_right_body());
            }

            // ── 3. Pass through; attach score header ──────────────────────────
            let mut res = svc.call(req).await?.map_into_left_body();
            res.headers_mut().insert(
                actix_web::http::header::HeaderName::from_static("x-bot-score"),
                actix_web::http::header::HeaderValue::from_str(
                    &detection.score.to_string()
                ).unwrap_or_else(|_| actix_web::http::header::HeaderValue::from_static("0")),
            );
            Ok(res)
        })
    }
}

// ─── Scoring logic ────────────────────────────────────────────────────────────

async fn score_request(
    req: &ServiceRequest,
    ip: &str,
    conn: &mut ConnectionManager,
    config: &AntiBotConfig,
) -> BotDetectionResult {
    let mut score: u8 = 0;
    let mut reasons: Vec<String> = Vec::new();

    // Signal 1 — rapid requests (sliding counter)
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let bucket = now_secs / config.rapid_window_secs;
    let rapid_key = format!("bot:rapid:{}:{}", ip, bucket);
    let rapid_count: u32 = redis::pipe()
        .atomic()
        .cmd("INCR").arg(&rapid_key)
        .cmd("EXPIRE").arg(&rapid_key).arg(config.rapid_window_secs + 1)
        .query_async::<Vec<i64>>(conn)
        .await
        .map(|v| v.first().copied().unwrap_or(0) as u32)
        .unwrap_or(0);

    if rapid_count > config.rapid_threshold {
        score += 2;
        reasons.push(format!("rapid_requests:{}", rapid_count));
        inc_metric(conn, "bot:metrics:rapid_requests").await;
    }

    // Signal 2 — missing or empty User-Agent
    let ua = req
        .headers()
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if ua.is_empty() {
        score += 2;
        reasons.push("missing_user_agent".to_string());
        inc_metric(conn, "bot:metrics:missing_headers").await;
    } else {
        // Signal 3 — known bot signature in User-Agent
        let ua_lower = ua.to_lowercase();
        if let Some(sig) = BOT_SIGNATURES.iter().find(|&&s| ua_lower.contains(s)) {
            score += 3;
            reasons.push(format!("bot_signature:{}", sig));
            inc_metric(conn, "bot:metrics:known_signature").await;
        }
    }

    // Signal 4 — missing Accept header (real browsers always send it)
    if req.headers().get("accept").is_none() {
        score += 1;
        reasons.push("missing_accept".to_string());
        inc_metric(conn, "bot:metrics:missing_headers").await;
    }

    // Signal 5 — missing Accept-Language header
    if req.headers().get("accept-language").is_none() {
        score += 1;
        reasons.push("missing_accept_language".to_string());
        inc_metric(conn, "bot:metrics:missing_headers").await;
    }

    let challenge = if score >= config.block_threshold {
        BotChallenge::Block
    } else if score >= config.captcha_threshold {
        BotChallenge::Captcha
    } else {
        BotChallenge::None
    };

    BotDetectionResult {
        flagged: score > 0,
        score,
        reasons,
        challenge,
        retry_after: None,
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async fn inc_metric(conn: &mut ConnectionManager, key: &str) {
    let _: Result<i64, _> = redis::cmd("INCR").arg(key).query_async(conn).await;
}

// ─── Public helper used by the anti-bot handler ───────────────────────────────

/// Read all bot-detection counters for the metrics endpoint.
pub async fn get_bot_metrics(conn: &mut ConnectionManager) -> serde_json::Value {
    let keys = [
        "bot:metrics:rapid_requests",
        "bot:metrics:missing_headers",
        "bot:metrics:known_signature",
        "bot:metrics:captcha_challenges",
        "bot:metrics:blocks",
    ];

    let mut map = serde_json::Map::new();
    for key in &keys {
        let val: i64 = redis::cmd("GET")
            .arg(key)
            .query_async(conn)
            .await
            .unwrap_or(0);
        let label = key.trim_start_matches("bot:metrics:");
        map.insert(label.to_string(), serde_json::Value::Number(val.into()));
    }
    serde_json::Value::Object(map)
}
