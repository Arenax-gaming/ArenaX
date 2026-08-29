// Middleware module for ArenaX
pub mod anti_bot;
pub mod authorization;
pub mod circuit_breaker;
pub mod csrf;
pub mod idempotency_middleware;
pub mod metrics_middleware;
pub mod rate_limit;
pub mod security;
pub mod security_headers;
pub mod tracing_middleware;

pub use anti_bot::AntiBotMiddleware;
pub use authorization::{
    AccessControlEngine, AuditDecision, AuditLogEntry, AuthorizationMiddleware,
    Permission, PermissionAuditLogger, RoleHierarchy, RoleTemplate, RoleTemplateRegistry,
};
pub use circuit_breaker::{
    CircuitBreaker, CircuitBreakerConfig, CircuitBreakerError, CircuitBreakerRegistry,
    CircuitBreakerStats, CircuitState, ExternalCircuitBreakerMiddleware,
};
pub use csrf::{csrf_protection, csrf_token_handler, CSRF_COOKIE, CSRF_HEADER};
pub use idempotency_middleware::IdempotencyMiddleware;
pub use metrics_middleware::RequestMetrics;
pub use rate_limit::RateLimitMiddleware;
pub use security::SecurityMiddleware;
pub use security_headers::security_headers;
pub use tracing_middleware::{correlation_id, CorrelationId, RequestTracing};

use actix_cors::Cors;
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
