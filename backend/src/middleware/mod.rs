// Middleware module for ArenaX
pub mod idempotency_middleware;

pub use idempotency_middleware::IdempotencyMiddleware;

use actix_cors::Cors;

pub fn cors_middleware() -> Cors {
    Cors::default()
        .allow_any_origin()
        .allow_any_method()
        .allow_any_header()
        .max_age(3600)
}
