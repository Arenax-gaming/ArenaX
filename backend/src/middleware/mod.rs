// Middleware module for ArenaX
pub mod anti_bot;
pub mod csrf;
pub mod idempotency_middleware;
pub mod ip_list;
pub mod rate_limit;
pub mod security;
pub mod security_headers;
pub mod tracing_middleware;

pub use anti_bot::AntiBotMiddleware;
pub use csrf::{csrf_protection, csrf_token_handler, CSRF_COOKIE, CSRF_HEADER};
pub use idempotency_middleware::IdempotencyMiddleware;
pub use ip_list::IpListMiddleware;
pub use rate_limit::RateLimitMiddleware;
pub use security::SecurityMiddleware;
pub use security_headers::security_headers;
pub use tracing_middleware::{correlation_id, CorrelationId, RequestTracing};

use actix_cors::Cors;
use actix_web::dev::ServiceRequest;
use actix_web::http::{header, Method};
use std::env;
use tracing::warn;

/// Builds the CORS layer from an explicit origin whitelist.
///
/// Origins are read from the `ALLOWED_ORIGINS` env var (comma-separated).
/// Unlike a permissive `Cors::permissive()` setup, this only allows the
/// specific methods/headers the API actually uses, so a misconfigured or
/// missing env var fails closed (localhost dev origins only) rather than
/// open (reflecting any origin).
pub fn cors_middleware() -> Cors {
    let allowed_origins = env::var("ALLOWED_ORIGINS").unwrap_or_else(|_| {
        warn!(
            "ALLOWED_ORIGINS is not set; falling back to localhost-only CORS origins. \
             Set ALLOWED_ORIGINS explicitly in production."
        );
        "http://localhost:3000,http://localhost:5173".to_string()
    });

    let origins: Vec<String> = allowed_origins
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let mut cors = Cors::default();
    for origin in origins {
        cors = cors.allowed_origin(&origin);
    }

    cors.allowed_methods(vec![
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::PATCH,
        Method::DELETE,
        Method::OPTIONS,
    ])
    .allowed_headers(vec![
        header::AUTHORIZATION,
        header::ACCEPT,
        header::CONTENT_TYPE,
        header::HeaderName::from_static("x-csrf-token"),
        header::HeaderName::from_static("x-correlation-id"),
        header::HeaderName::from_static("idempotency-key"),
    ])
    .supports_credentials()
    .max_age(3600)
}

/// Extract the client IP from a request.
///
/// Checks `X-Forwarded-For` first (set by a trusted reverse proxy), then
/// falls back to the connection's real remote address, and finally to
/// `"unknown"`.
pub(crate) fn extract_ip(req: &ServiceRequest) -> String {
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

/// Current time in milliseconds since UNIX epoch.
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
