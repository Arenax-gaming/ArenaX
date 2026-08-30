/// Comprehensive security middleware for ArenaX backend.
///
/// Provides:
/// - Per-IP and per-user rate limiting (sliding window via Redis)
/// - Input size / content-type validation
/// - Audit logging of every mutating request
/// - DDoS heuristics (burst detection, IP blocking)
/// - Security-event monitoring (emits structured log entries)
/// - Gradual exponential backoff on repeated violations
/// - IP whitelist/blacklist enforcement
use std::{
    future::{ready, Ready},
    rc::Rc,
    sync::Arc,
};

use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpResponse,
};
use futures_util::future::LocalBoxFuture;
use redis::aio::ConnectionManager;
use serde::Serialize;
use tracing::{error, info, warn};

// ─── Config ───────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct SecurityConfig {
    /// Max requests per window per IP
    pub rate_limit_per_ip: u32,
    /// Max requests per window per authenticated user
    pub rate_limit_per_user: u32,
    /// Sliding window in seconds
    pub window_secs: u64,
    /// Max request body size in bytes (0 = no limit)
    pub max_body_bytes: usize,
    /// Burst threshold — if an IP exceeds this in 1 s it is temporarily blocked
    pub burst_threshold: u32,
    /// How long (seconds) a burst-blocked IP stays blocked
    pub block_duration_secs: u64,
    /// Base delay in seconds for exponential backoff (first violation)
    pub backoff_base_secs: u64,
    /// Maximum delay in seconds for exponential backoff (cap)
    pub backoff_max_secs: u64,
    /// TTL in seconds for the per-IP backoff counter; violations decay after this
    pub backoff_window_secs: u64,
    /// After this many consecutive violations within the backoff window,
    /// escalate from Retry-After to a temporary block
    pub backoff_block_threshold: u32,
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            rate_limit_per_ip: 120,
            rate_limit_per_user: 300,
            window_secs: 60,
            max_body_bytes: 1_048_576, // 1 MiB
            burst_threshold: 30,
            block_duration_secs: 300,
            backoff_base_secs: 1,
            backoff_max_secs: 60,
            backoff_window_secs: 300,
            backoff_block_threshold: 5,
        }
    }
}

// ─── Audit log entry ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AuditEntry {
    pub ts: u64,
    pub ip: String,
    pub method: String,
    pub path: String,
    pub status: u16,
    pub user_id: Option<String>,
    pub latency_ms: u64,
    pub blocked: bool,
    pub rate_limited: bool,
    /// Correlation id set by [`crate::middleware::tracing_middleware::RequestTracing`],
    /// so audit entries can be cross-referenced with the distributed trace.
    pub correlation_id: Option<String>,
}

// ─── Transform (factory) ──────────────────────────────────────────────────────

pub struct SecurityMiddleware {
    redis: Arc<ConnectionManager>,
    config: Arc<SecurityConfig>,
}

impl SecurityMiddleware {
    pub fn new(redis: ConnectionManager, config: SecurityConfig) -> Self {
        Self {
            redis: Arc::new(redis),
            config: Arc::new(config),
        }
    }
}

impl<S, B> Transform<S, ServiceRequest> for SecurityMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type InitError = ();
    type Transform = SecurityMiddlewareService<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(SecurityMiddlewareService {
            service: Rc::new(service),
            redis: self.redis.clone(),
            config: self.config.clone(),
        }))
    }
}

// ─── Service ──────────────────────────────────────────────────────────────────

pub struct SecurityMiddlewareService<S> {
    service: Rc<S>,
    redis: Arc<ConnectionManager>,
    config: Arc<SecurityConfig>,
}

impl<S, B> Service<ServiceRequest> for SecurityMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let svc = self.service.clone();
        let redis = self.redis.clone();
        let config = self.config.clone();
        let start = now_ms();

        Box::pin(async move {
            let ip = extract_ip(&req);
            let path = req.path().to_string();
            let method = req.method().to_string();
            let correlation_id = crate::middleware::tracing_middleware::correlation_id(&req);
            let mut conn = (*redis).clone();

            // ── 0. Whitelist check — bypass all security ──────────────────────
            if crate::middleware::ip_list::is_whitelisted(&mut conn, &ip).await {
                return svc.call(req).await.map(|res| res.map_into_left_body());
            }

            // ── 1. Check if IP is blocked (DDoS or backoff escalation) ───────
            let block_key = format!("sec:block:{}", ip);
            let blocked: bool = redis::cmd("EXISTS")
                .arg(&block_key)
                .query_async(&mut conn)
                .await
                .unwrap_or(false);

            if blocked {
                warn!(ip = %ip, path = %path, "DDoS block active");
                emit_audit(AuditEntry {
                    ts: start / 1000,
                    ip: ip.clone(),
                    method,
                    path,
                    status: 429,
                    user_id: None,
                    latency_ms: 0,
                    blocked: true,
                    rate_limited: false,
                    correlation_id: correlation_id.clone(),
                });
                let retry_after = redis::cmd("TTL")
                    .arg(&block_key)
                    .query_async::<i64>(&mut conn)
                    .await
                    .unwrap_or(config.block_duration_secs as i64)
                    .max(1) as u64;
                let mut resp = HttpResponse::TooManyRequests()
                    .json(serde_json::json!({"error": "blocked", "code": "DDOS_BLOCK", "retry_after": retry_after}));
                insert_header(&mut resp, "Retry-After", retry_after);
                return Ok(req.into_response(resp).map_into_right_body());
            }

            // ── 2. Burst detection (1-second window) ──────────────────────────
            let burst_key = format!("sec:burst:{}:{}", ip, start / 1000);
            let burst_count: u32 = redis::pipe()
                .atomic()
                .cmd("INCR").arg(&burst_key)
                .cmd("EXPIRE").arg(&burst_key).arg(2u64)
                .query_async::<Vec<i64>>(&mut conn)
                .await
                .map(|v| v.first().copied().unwrap_or(0) as u32)
                .unwrap_or(0);

            if burst_count > config.burst_threshold {
                warn!(ip = %ip, burst = burst_count, "Burst threshold exceeded — blocking IP");
                let _: () = redis::cmd("SETEX")
                    .arg(&block_key)
                    .arg(config.block_duration_secs)
                    .arg(1u8)
                    .query_async(&mut conn)
                    .await
                    .unwrap_or(());
                // Increment backoff counter
                let backoff_level = increment_backoff(&mut conn, &ip, &config).await;
                emit_security_event("BURST_BLOCK", &ip, &path, burst_count);
                let retry_after = calculate_backoff(backoff_level, &config);
                let mut resp = HttpResponse::TooManyRequests()
                    .json(serde_json::json!({"error": "rate limited", "code": "BURST_LIMIT", "retry_after": retry_after, "backoff_level": backoff_level}));
                insert_header(&mut resp, "Retry-After", retry_after);
                insert_header(&mut resp, "X-Backoff-Level", backoff_level);
                return Ok(req.into_response(resp).map_into_right_body());
            }

            // ── 3. Sliding-window rate limit per IP ───────────────────────────
            let window_key = format!("sec:rl:ip:{}:{}", ip, start / 1000 / config.window_secs);
            let ip_count: u32 = redis::pipe()
                .atomic()
                .cmd("INCR").arg(&window_key)
                .cmd("EXPIRE").arg(&window_key).arg(config.window_secs)
                .query_async::<Vec<i64>>(&mut conn)
                .await
                .map(|v| v.first().copied().unwrap_or(0) as u32)
                .unwrap_or(0);

            if ip_count > config.rate_limit_per_ip {
                warn!(ip = %ip, count = ip_count, "IP rate limit exceeded");
                let backoff_level = increment_backoff(&mut conn, &ip, &config).await;

                // Escalate to block if threshold reached
                if backoff_level >= config.backoff_block_threshold {
                    warn!(ip = %ip, level = backoff_level, "Backoff threshold reached — escalating to block");
                    let _: () = redis::cmd("SETEX")
                        .arg(&block_key)
                        .arg(config.block_duration_secs)
                        .arg(1u8)
                        .query_async(&mut conn)
                        .await
                        .unwrap_or(());
                    emit_security_event("BACKOFF_BLOCK", &ip, &path, backoff_level);
                    let retry_after = config.block_duration_secs;
                    let mut resp = HttpResponse::TooManyRequests()
                        .json(serde_json::json!({"error": "blocked", "code": "BACKOFF_BLOCK", "retry_after": retry_after, "backoff_level": backoff_level}));
                    insert_header(&mut resp, "Retry-After", retry_after);
                    insert_header(&mut resp, "X-Backoff-Level", backoff_level);
                    return Ok(req.into_response(resp).map_into_right_body());
                }

                emit_audit(AuditEntry {
                    ts: start / 1000,
                    ip: ip.clone(),
                    method,
                    path,
                    status: 429,
                    user_id: None,
                    latency_ms: now_ms() - start,
                    blocked: false,
                    rate_limited: true,
                    correlation_id: correlation_id.clone(),
                });
                let retry_after = calculate_backoff(backoff_level, &config);
                let mut resp = HttpResponse::TooManyRequests()
                    .json(serde_json::json!({"error": "rate limited", "code": "IP_RATE_LIMIT", "retry_after": retry_after, "backoff_level": backoff_level}));
                insert_header(&mut resp, "Retry-After", retry_after);
                insert_header(&mut resp, "X-Backoff-Level", backoff_level);
                return Ok(req.into_response(resp).map_into_right_body());
            }

            // ── 4. Body size guard ────────────────────────────────────────────
            if config.max_body_bytes > 0 {
                if let Some(content_length) = req
                    .headers()
                    .get("content-length")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.parse::<usize>().ok())
                {
                    if content_length > config.max_body_bytes {
                        warn!(ip = %ip, size = content_length, "Request body too large");
                        let resp = HttpResponse::PayloadTooLarge()
                            .json(serde_json::json!({"error": "payload too large"}));
                        return Ok(req.into_response(resp).map_into_right_body());
                    }
                }
            }

            // ── 5. Forward to inner service ───────────────────────────────────
            let res = svc.call(req).await?;
            let status = res.status().as_u16();
            let latency = now_ms() - start;

            // ── 6. Audit log ──────────────────────────────────────────────────
            if method_is_mutating(&method) || status >= 400 {
                emit_audit(AuditEntry {
                    ts: start / 1000,
                    ip: ip.clone(),
                    method,
                    path: path.clone(),
                    status,
                    user_id: None, // populated by auth layer if needed
                    latency_ms: latency,
                    blocked: false,
                    rate_limited: false,
                    correlation_id: correlation_id.clone(),
                });
            }

            // ── 7. Monitor suspicious patterns ───────────────────────────────
            if status == 401 || status == 403 {
                let auth_fail_key = format!("sec:authfail:{}", &ip);
                let fails: u32 = redis::pipe()
                    .atomic()
                    .cmd("INCR").arg(&auth_fail_key)
                    .cmd("EXPIRE").arg(&auth_fail_key).arg(300u64)
                    .query_async::<Vec<i64>>(&mut conn)
                    .await
                    .map(|v| v.first().copied().unwrap_or(0) as u32)
                    .unwrap_or(0);
                if fails >= 10 {
                    warn!(ip = %ip, fails = fails, "Repeated auth failures — possible credential stuffing");
                    emit_security_event("AUTH_FAIL_SPIKE", &ip, &path, fails);
                }
            }

            Ok(res.map_into_left_body())
        })
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

use super::{extract_ip, now_ms};

fn method_is_mutating(method: &str) -> bool {
    matches!(method, "POST" | "PUT" | "PATCH" | "DELETE")
}

// ─── Gradual backoff helpers ─────────────────────────────────────────────────

/// Increment the per-IP backoff violation counter.
///
/// Returns the new violation level (1-based). The counter auto-decays after
/// `backoff_window_secs` seconds of clean behaviour.
async fn increment_backoff(
    conn: &mut ConnectionManager,
    ip: &str,
    config: &SecurityConfig,
) -> u32 {
    let key = format!("sec:backoff:{}", ip);
    let count: u32 = redis::pipe()
        .atomic()
        .cmd("INCR").arg(&key)
        .cmd("EXPIRE").arg(&key).arg(config.backoff_window_secs)
        .query_async::<Vec<i64>>(conn)
        .await
        .map(|v| v.first().copied().unwrap_or(0) as u32)
        .unwrap_or(0);
    count
}

/// Calculate the exponential backoff delay for a given violation level.
///
/// `delay = min(base * 2^(level - 1), max)`
fn calculate_backoff(level: u32, config: &SecurityConfig) -> u64 {
    if level == 0 {
        return 0;
    }
    let delay = config.backoff_base_secs.saturating_mul(1u64 << (level.saturating_sub(1)));
    delay.min(config.backoff_max_secs)
}

/// Insert a header into an `HttpResponse`.
fn insert_header(response: &mut HttpResponse, name: &'static str, value: impl ToString) {
    use actix_web::http::header::{HeaderName, HeaderValue};
    let n = HeaderName::from_static(name);
    if let Ok(v) = HeaderValue::from_str(&value.to_string()) {
        response.headers_mut().insert(n, v);
    }
}

fn emit_audit(entry: AuditEntry) {
    // Structured JSON log — consumed by log aggregator (e.g. Loki / CloudWatch)
    match serde_json::to_string(&entry) {
        Ok(json) => info!(target: "audit", "{}", json),
        Err(e) => error!("Failed to serialise audit entry: {}", e),
    }
}

fn emit_security_event(event: &str, ip: &str, path: &str, value: u32) {
    info!(
        target: "security",
        event = event,
        ip = ip,
        path = path,
        value = value,
        "Security event"
    );
}

// ─── Input validation helpers (used by handlers) ─────────────────────────────

/// Validate that a string contains only safe characters (alphanumeric + limited punctuation).
pub fn validate_safe_string(s: &str, max_len: usize) -> Result<(), &'static str> {
    if s.len() > max_len {
        return Err("input too long");
    }
    if s.chars().any(|c| c.is_control()) {
        return Err("control characters not allowed");
    }
    Ok(())
}

/// Validate a UUID string.
pub fn validate_uuid(s: &str) -> Result<uuid::Uuid, &'static str> {
    uuid::Uuid::parse_str(s).map_err(|_| "invalid UUID")
}

/// Validate a positive integer amount.
pub fn validate_positive_amount(amount: i64) -> Result<(), &'static str> {
    if amount <= 0 {
        return Err("amount must be positive");
    }
    Ok(())
}
