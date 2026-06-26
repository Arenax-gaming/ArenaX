//! Redis-backed sliding window rate limiting middleware for ArenaX.
//!
//! # Design
//!
//! Uses a **true sliding window** implemented with a Redis sorted set per
//! (identity, endpoint-bucket) pair:
//!
//! ```text
//! ZADD  rl:{bucket}:{identity}  <now_ms>  <now_ms>   (add this request)
//! ZREMRANGEBYSCORE  ...  0  <window_start_ms>         (evict stale entries)
//! ZCARD ...                                            (count remaining)
//! EXPIRE ... <window_secs>                             (auto-cleanup)
//! ```
//!
//! All four commands run in a single `MULTI/EXEC` pipeline so the check-and-
//! increment is atomic.
//!
//! # Endpoint buckets and limits
//!
//! | Bucket prefix  | Matching paths              | Limit | Window |
//! |----------------|-----------------------------|-------|--------|
//! | `auth_strict`  | `/api/auth/login`           |  5    | 60 s   |
//! | `auth_strict`  | `/api/auth/register`        |  5    | 60 s   |
//! | `auth_strict`  | `/api/auth/refresh`         |  10   | 60 s   |
//! | `auth`         | Other `/api/auth/*`         |  30   | 60 s   |
//! | `game`         | `/api/matchmaking/*`        |  60   | 60 s   |
//! | `game`         | `/api/matches/*`            |  60   | 60 s   |
//! | `game`         | `/api/tournaments/*`        |  60   | 60 s   |
//! | `default`      | Everything else             | configurable (from env) |
//!
//! # Identity
//!
//! - Authenticated requests: keyed on user ID (from JWT `Claims` in extensions).
//! - Unauthenticated requests: keyed on client IP.
//!
//! # Headers
//!
//! Every response gets:
//! - `X-RateLimit-Limit`     — the limit for this bucket
//! - `X-RateLimit-Remaining` — requests left in the current window
//! - `X-RateLimit-Reset`     — Unix seconds when the window resets
//!
//! On 429:
//! - `Retry-After`           — seconds until the window resets

use std::{
    future::{ready, Ready},
    rc::Rc,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::header::{HeaderName, HeaderValue},
    HttpResponse,
};
use futures_util::future::LocalBoxFuture;
use redis::aio::ConnectionManager;
use tracing::warn;

use crate::auth::jwt_service::Claims;
use crate::config::RateLimitConfig;

// ─────────────────────────────────────────────────────────────────────────────
// Bucket definitions
// ─────────────────────────────────────────────────────────────────────────────

/// A rate-limit bucket: a named group of endpoints that share a limit.
#[derive(Clone, Debug)]
struct Bucket {
    /// Redis key suffix, e.g. "auth_strict"
    name: &'static str,
    /// Maximum requests allowed in `window_secs`
    limit: u32,
    /// Window length in seconds
    window_secs: u64,
}

/// Resolve the bucket for a given request path.
///
/// Returns the most-specific matching bucket.
fn resolve_bucket(path: &str, default_limit: u32, default_window: u64) -> Bucket {
    // Auth — strict (login, register, refresh are the highest-risk)
    if path == "/api/auth/login"
        || path == "/api/auth/register"
        || path == "/api/auth/refresh"
    {
        return Bucket { name: "auth_strict", limit: 5, window_secs: 60 };
    }

    // Auth — other (logout, me, change-password, sessions…)
    if path.starts_with("/api/auth") {
        return Bucket { name: "auth", limit: 30, window_secs: 60 };
    }

    // Game — matchmaking (join/leave are mutation-heavy; stats/status are read)
    if path == "/api/matchmaking/join" || path == "/api/matchmaking/leave" {
        return Bucket { name: "matchmaking_mutate", limit: 20, window_secs: 60 };
    }
    if path.starts_with("/api/matchmaking") {
        return Bucket { name: "matchmaking", limit: 60, window_secs: 60 };
    }

    // Game — score reporting / match lifecycle (complete, dispute, finalize)
    if path.contains("/complete") || path.contains("/dispute") || path.contains("/finalize") {
        return Bucket { name: "match_report", limit: 30, window_secs: 60 };
    }
    if path.starts_with("/api/matches") {
        return Bucket { name: "matches", limit: 60, window_secs: 60 };
    }

    // Tournaments
    if path.starts_with("/api/tournaments") {
        return Bucket { name: "tournaments", limit: 60, window_secs: 60 };
    }

    // Staking mutations
    if path == "/api/staking/stake" || path == "/api/staking/claim" {
        return Bucket { name: "staking_mutate", limit: 10, window_secs: 60 };
    }

    // Default — driven by RateLimitConfig from env
    Bucket { name: "default", limit: default_limit, window_secs: default_window }
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis sliding-window check
// ─────────────────────────────────────────────────────────────────────────────

/// Run the sorted-set sliding window atomically.
///
/// Returns `(current_count, limit, window_reset_unix_secs)`.
/// If Redis is unavailable the function returns `(0, limit, reset)` — i.e.
/// it **fails open** so Redis outages do not take down the service.
async fn sliding_window_check(
    conn: &mut ConnectionManager,
    identity: &str,
    bucket: &Bucket,
    now_ms: u64,
) -> (u32, u32, u64) {
    let window_ms = bucket.window_secs * 1_000;
    let window_start_ms = now_ms.saturating_sub(window_ms);
    let key = format!("rl:{}:{}", bucket.name, identity);
    let reset_secs = (now_ms / 1_000) + bucket.window_secs;

    // Use a pipeline: ZADD → ZREMRANGEBYSCORE → ZCARD → EXPIRE
    // We need ZCARD result, so we can't use a fire-and-forget pipeline;
    // instead use individual pipelined commands and collect.
    let result: Result<(i64, i64, i64, i64), redis::RedisError> = redis::pipe()
        .atomic()
        // 1. Add this request (score = timestamp_ms, member = timestamp_ms as string)
        .cmd("ZADD")
            .arg(&key)
            .arg(now_ms)
            .arg(now_ms.to_string())
        // 2. Remove entries outside the window
        .cmd("ZREMRANGEBYSCORE")
            .arg(&key)
            .arg(0u64)
            .arg(window_start_ms)
        // 3. Count remaining entries
        .cmd("ZCARD")
            .arg(&key)
        // 4. Set TTL so the key is cleaned up automatically
        .cmd("EXPIRE")
            .arg(&key)
            .arg(bucket.window_secs)
        .query_async(conn)
        .await;

    match result {
        Ok((_, _, count, _)) => (count as u32, bucket.limit, reset_secs),
        Err(e) => {
            // Fail open — log and allow the request
            warn!(error = %e, key = %key, "Rate-limit Redis error — failing open");
            (0, bucket.limit, reset_secs)
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// IP extraction (mirrors SecurityMiddleware)
// ─────────────────────────────────────────────────────────────────────────────

fn extract_ip(req: &ServiceRequest) -> String {
    req.headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            req.connection_info()
                .realip_remote_addr()
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware factory
// ─────────────────────────────────────────────────────────────────────────────

/// Actix-web middleware factory for per-endpoint sliding window rate limiting.
///
/// # Usage
///
/// ```rust
/// App::new()
///     .wrap(RateLimitMiddleware::new(redis_conn.clone(), config.rate_limit.clone()))
///     // ... other middleware and routes
/// ```
pub struct RateLimitMiddleware {
    redis: Arc<ConnectionManager>,
    config: Arc<RateLimitConfig>,
}

impl RateLimitMiddleware {
    pub fn new(redis: ConnectionManager, config: RateLimitConfig) -> Self {
        Self {
            redis: Arc::new(redis),
            config: Arc::new(config),
        }
    }
}

impl<S, B> Transform<S, ServiceRequest> for RateLimitMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = actix_web::Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = actix_web::Error;
    type InitError = ();
    type Transform = RateLimitMiddlewareService<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(RateLimitMiddlewareService {
            service: Rc::new(service),
            redis: self.redis.clone(),
            config: self.config.clone(),
        }))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware service
// ─────────────────────────────────────────────────────────────────────────────

pub struct RateLimitMiddlewareService<S> {
    service: Rc<S>,
    redis: Arc<ConnectionManager>,
    config: Arc<RateLimitConfig>,
}

impl<S, B> Service<ServiceRequest> for RateLimitMiddlewareService<S>
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
        let default_limit = self.config.requests;
        let default_window = self.config.window;

        Box::pin(async move {
            let path = req.path().to_string();
            let now = now_ms();

            // ── Resolve bucket ────────────────────────────────────────────────
            let bucket = resolve_bucket(&path, default_limit, default_window);

            // ── Resolve identity (user ID > IP) ───────────────────────────────
            let identity = req
                .extensions()
                .get::<Claims>()
                .map(|c| format!("u:{}", c.sub))
                .unwrap_or_else(|| format!("ip:{}", extract_ip(&req)));

            // ── Sliding window check ──────────────────────────────────────────
            let mut conn = (*redis).clone();
            let (count, limit, reset_secs) =
                sliding_window_check(&mut conn, &identity, &bucket, now).await;

            let remaining = limit.saturating_sub(count);

            if count > limit {
                warn!(
                    identity = %identity,
                    path = %path,
                    bucket = %bucket.name,
                    count = count,
                    limit = limit,
                    "Rate limit exceeded"
                );

                let retry_after = reset_secs.saturating_sub(now / 1_000);
                let mut response = HttpResponse::TooManyRequests().json(serde_json::json!({
                    "error": format!(
                        "Too many requests: limit is {} per {} seconds for this endpoint",
                        limit, bucket.window_secs
                    ),
                    "code": 429,
                    "retry_after": retry_after,
                    "bucket": bucket.name,
                }));

                // Rate limit headers on rejection
                insert_header(&mut response, "X-RateLimit-Limit", limit);
                insert_header(&mut response, "X-RateLimit-Remaining", 0u32);
                insert_header(&mut response, "X-RateLimit-Reset", reset_secs);
                insert_header(&mut response, "Retry-After", retry_after);

                return Ok(req.into_response(response).map_into_right_body());
            }

            // ── Forward to inner service ──────────────────────────────────────
            let mut res = svc.call(req).await?.map_into_left_body();

            // Attach informational headers to every allowed response
            let headers = res.headers_mut();
            try_insert(headers, "X-RateLimit-Limit", limit);
            try_insert(headers, "X-RateLimit-Remaining", remaining);
            try_insert(headers, "X-RateLimit-Reset", reset_secs);

            Ok(res)
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Header helpers
// ─────────────────────────────────────────────────────────────────────────────

fn insert_header(response: &mut HttpResponse, name: &'static str, value: impl ToString) {
    if let (Ok(n), Ok(v)) = (
        HeaderName::from_static(name),
        HeaderValue::from_str(&value.to_string()),
    ) {
        response.headers_mut().insert(n, v);
    }
}

fn try_insert(
    headers: &mut actix_web::http::header::HeaderMap,
    name: &'static str,
    value: impl ToString,
) {
    if let (Ok(n), Ok(v)) = (
        HeaderName::from_static(name),
        HeaderValue::from_str(&value.to_string()),
    ) {
        headers.insert(n, v);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn bucket_for(path: &str) -> Bucket {
        resolve_bucket(path, 100, 60)
    }

    #[test]
    fn test_login_gets_strict_bucket() {
        let b = bucket_for("/api/auth/login");
        assert_eq!(b.name, "auth_strict");
        assert_eq!(b.limit, 5);
    }

    #[test]
    fn test_register_gets_strict_bucket() {
        let b = bucket_for("/api/auth/register");
        assert_eq!(b.name, "auth_strict");
        assert_eq!(b.limit, 5);
    }

    #[test]
    fn test_refresh_gets_strict_bucket() {
        let b = bucket_for("/api/auth/refresh");
        assert_eq!(b.name, "auth_strict");
        assert_eq!(b.limit, 10);
    }

    #[test]
    fn test_logout_gets_auth_bucket() {
        let b = bucket_for("/api/auth/logout");
        assert_eq!(b.name, "auth");
        assert_eq!(b.limit, 30);
    }

    #[test]
    fn test_matchmaking_join_gets_mutate_bucket() {
        let b = bucket_for("/api/matchmaking/join");
        assert_eq!(b.name, "matchmaking_mutate");
        assert_eq!(b.limit, 20);
    }

    #[test]
    fn test_matchmaking_stats_gets_general_bucket() {
        let b = bucket_for("/api/matchmaking/stats");
        assert_eq!(b.name, "matchmaking");
        assert_eq!(b.limit, 60);
    }

    #[test]
    fn test_score_complete_gets_report_bucket() {
        let b = bucket_for("/api/matches/abc-123/complete");
        assert_eq!(b.name, "match_report");
        assert_eq!(b.limit, 30);
    }

    #[test]
    fn test_match_dispute_gets_report_bucket() {
        let b = bucket_for("/api/matches/abc-123/dispute");
        assert_eq!(b.name, "match_report");
        assert_eq!(b.limit, 30);
    }

    #[test]
    fn test_staking_mutate_bucket() {
        let b = bucket_for("/api/staking/stake");
        assert_eq!(b.name, "staking_mutate");
        assert_eq!(b.limit, 10);
    }

    #[test]
    fn test_health_gets_default_bucket() {
        let b = bucket_for("/api/health");
        assert_eq!(b.name, "default");
        assert_eq!(b.limit, 100); // default from test args
    }

    #[test]
    fn test_remaining_never_underflows() {
        // limit.saturating_sub should never wrap to u32::MAX
        let limit: u32 = 5;
        let count: u32 = 10;
        assert_eq!(limit.saturating_sub(count), 0);
    }
}
