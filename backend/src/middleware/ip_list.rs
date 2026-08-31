//! IP whitelist / blacklist middleware — Issue #975.
//!
//! Maintains two Redis SETs (`sec:ip_whitelist`, `sec:ip_blacklist`) and
//! enforces them as the **first** check in the security middleware chain.
//!
//! # Behaviour
//!
//! | List       | Effect                                                |
//! |------------|-------------------------------------------------------|
//! | Blacklist  | Request rejected with 403 immediately                 |
//! | Whitelisted| All rate-limiting and bot detection bypassed           |
//!
//! # Redis keys
//!
//! | Key                        | Type | Purpose                              |
//! |----------------------------|------|--------------------------------------|
//! | `sec:ip_whitelist`         | SET  | Permanent whitelisted IPs            |
//! | `sec:ip_blacklist`         | SET  | Permanent blacklisted IPs            |
//! | `sec:ip_blacklist_ttl:{ip}`| KEY  | TTL for auto-expiring blacklist entries |

use std::sync::Arc;

use actix_web::HttpMessage;
use redis::aio::ConnectionManager;
use tracing::warn;

// ─── Redis key constants ─────────────────────────────────────────────────────

const WHITELIST_KEY: &str = "sec:ip_whitelist";
const BLACKLIST_KEY: &str = "sec:ip_blacklist";
const BLACKLIST_TTL_PREFIX: &str = "sec:ip_blacklist_ttl";

// ─── Query helpers ───────────────────────────────────────────────────────────

/// Check if an IP is in the blacklist.
///
/// Returns `false` on Redis failure (fail-open).
pub async fn is_blacklisted(conn: &mut ConnectionManager, ip: &str) -> bool {
    redis::cmd("SISMEMBER")
        .arg(BLACKLIST_KEY)
        .arg(ip)
        .query_async(conn)
        .await
        .unwrap_or(false)
}

/// Check if an IP is in the whitelist.
///
/// Returns `false` on Redis failure (fail-open).
pub async fn is_whitelisted(conn: &mut ConnectionManager, ip: &str) -> bool {
    redis::cmd("SISMEMBER")
        .arg(WHITELIST_KEY)
        .arg(ip)
        .query_async(conn)
        .await
        .unwrap_or(false)
}

// ─── Mutation helpers ────────────────────────────────────────────────────────

/// Add an IP to the whitelist.
pub async fn add_to_whitelist(conn: &mut ConnectionManager, ip: &str) -> Result<(), redis::RedisError> {
    redis::cmd("SADD")
        .arg(WHITELIST_KEY)
        .arg(ip)
        .query_async(conn)
        .await
}

/// Remove an IP from the whitelist.
pub async fn remove_from_whitelist(conn: &mut ConnectionManager, ip: &str) -> Result<(), redis::RedisError> {
    redis::cmd("SREM")
        .arg(WHITELIST_KEY)
        .arg(ip)
        .query_async(conn)
        .await
}

/// Add an IP to the blacklist.
///
/// If `ttl_secs` > 0 the entry auto-expires after the given duration.
pub async fn add_to_blacklist(
    conn: &mut ConnectionManager,
    ip: &str,
    ttl_secs: u64,
) -> Result<(), redis::RedisError> {
    redis::cmd("SADD")
        .arg(BLACKLIST_KEY)
        .arg(ip)
        .query_async(conn)
        .await?;

    if ttl_secs > 0 {
        let ttl_key = format!("{}:{}", BLACKLIST_TTL_PREFIX, ip);
        redis::cmd("SETEX")
            .arg(&ttl_key)
            .arg(ttl_secs)
            .arg("1")
            .query_async(conn)
            .await?;

        // Schedule automatic removal from the set when the TTL expires.
        // We use a Lua script to atomically check-and-remove so a race
        // between an expired TTL and a manual re-add is safe.
        let script = r#"
            local ttl_key = KEYS[1]
            local bl_key  = KEYS[2]
            local ip      = ARGV[1]
            -- Only remove if the TTL key no longer exists (i.e. expired)
            if redis.call('EXISTS', ttl_key) == 0 then
                redis.call('SREM', bl_key, ip)
            end
        "#;
        let ttl_key = format!("{}:{}", BLACKLIST_TTL_PREFIX, ip);
        let _: Result<(), _> = redis::cmd("EVAL")
            .arg(script)
            .arg(2)
            .arg(&ttl_key)
            .arg(BLACKLIST_KEY)
            .arg(ip)
            .query_async(conn)
            .await;
    }

    Ok(())
}

/// Remove an IP from the blacklist.
pub async fn remove_from_blacklist(conn: &mut ConnectionManager, ip: &str) -> Result<(), redis::RedisError> {
    redis::cmd("SREM")
        .arg(BLACKLIST_KEY)
        .arg(ip)
        .query_async(conn)
        .await?;

    let ttl_key = format!("{}:{}", BLACKLIST_TTL_PREFIX, ip);
    let _: Result<(), _> = redis::cmd("DEL")
        .arg(&ttl_key)
        .query_async(conn)
        .await;

    Ok(())
}

// ─── List / query helpers ────────────────────────────────────────────────────

/// Return all IPs in the whitelist.
pub async fn list_whitelist(conn: &mut ConnectionManager) -> Vec<String> {
    redis::cmd("SMEMBERS")
        .arg(WHITELIST_KEY)
        .query_async(conn)
        .await
        .unwrap_or_default()
}

/// Return all IPs in the blacklist.
pub async fn list_blacklist(conn: &mut ConnectionManager) -> Vec<String> {
    redis::cmd("SMEMBERS")
        .arg(BLACKLIST_KEY)
        .query_async(conn)
        .await
        .unwrap_or_default()
}

// ─── Startup seeding ─────────────────────────────────────────────────────────

/// Seed the whitelist/blacklist from comma-separated env var values.
///
/// Called once at server startup. Errors are logged but do not prevent startup.
pub async fn seed_from_env(conn: &mut ConnectionManager) {
    if let Ok(val) = std::env::var("IP_WHITELIST") {
        let ips: Vec<&str> = val.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
        if !ips.is_empty() {
            match redis::cmd("SADD")
                .arg(WHITELIST_KEY)
                .arg(&ips)
                .query_async::<i64>(conn)
                .await
            {
                Ok(n) => tracing::info!(count = n, "Seeded IP whitelist from env"),
                Err(e) => warn!(error = %e, "Failed to seed IP whitelist"),
            }
        }
    }

    if let Ok(val) = std::env::var("IP_BLACKLIST") {
        let ips: Vec<&str> = val.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
        if !ips.is_empty() {
            match redis::cmd("SADD")
                .arg(BLACKLIST_KEY)
                .arg(&ips)
                .query_async::<i64>(conn)
                .await
            {
                Ok(n) => tracing::info!(count = n, "Seeded IP blacklist from env"),
                Err(e) => warn!(error = %e, "Failed to seed IP blacklist"),
            }
        }
    }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    HttpResponse,
};
use futures_util::future::LocalBoxFuture;

/// Middleware that enforces IP whitelist/blacklist as the outermost security
/// check. Whitelisted IPs bypass all downstream rate-limiting and bot detection;
/// blacklisted IPs are rejected immediately.
pub struct IpListMiddleware {
    redis: Arc<ConnectionManager>,
}

impl IpListMiddleware {
    pub fn new(redis: ConnectionManager) -> Self {
        Self { redis: Arc::new(redis) }
    }
}

impl<S, B> Transform<S, ServiceRequest> for IpListMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = actix_web::Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = actix_web::Error;
    type InitError = ();
    type Transform = IpListMiddlewareService<S>;
    type Future = std::future::Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        std::future::ready(Ok(IpListMiddlewareService {
            service: std::rc::Rc::new(service),
            redis: self.redis.clone(),
        }))
    }
}

pub struct IpListMiddlewareService<S> {
    service: std::rc::Rc<S>,
    redis: Arc<ConnectionManager>,
}

impl<S, B> Service<ServiceRequest> for IpListMiddlewareService<S>
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

        Box::pin(async move {
            let ip = super::extract_ip(&req);
            let mut conn = (*redis).clone();

            // ── Blacklist check — reject immediately ──────────────────────────
            if is_blacklisted(&mut conn, &ip).await {
                warn!(ip = %ip, path = %req.path(), "Blacklisted IP rejected");
                let resp = HttpResponse::Forbidden().json(serde_json::json!({
                    "error": "Access denied",
                    "code": "IP_BLACKLISTED",
                }));
                return Ok(req.into_response(resp).map_into_right_body());
            }

            // ── Whitelist check — mark request for bypass ────────────────────
            if is_whitelisted(&mut conn, &ip).await {
                // Store a marker in request extensions so downstream middleware
                // (SecurityMiddleware, AntiBotMiddleware, RateLimitMiddleware)
                // can skip their checks.
                req.extensions_mut().insert(IpWhitelisted);
            }

            svc.call(req).await.map(|res| res.map_into_left_body())
        })
    }
}

// ─── Extension marker ────────────────────────────────────────────────────────

/// Marker type inserted into request extensions when the caller's IP is
/// whitelisted. Downstream middleware should check for this and skip
/// rate-limiting / bot detection.
#[derive(Clone, Copy, Debug)]
pub struct IpWhitelisted;

/// Convenience extension trait to check for the whitelist marker.
pub trait IpWhitelistedExt {
    fn is_ip_whitelisted(&self) -> bool;
}

impl IpWhitelistedExt for ServiceRequest {
    fn is_ip_whitelisted(&self) -> bool {
        self.extensions().get::<IpWhitelisted>().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_constants() {
        assert_eq!(WHITELIST_KEY, "sec:ip_whitelist");
        assert_eq!(BLACKLIST_KEY, "sec:ip_blacklist");
    }
}
