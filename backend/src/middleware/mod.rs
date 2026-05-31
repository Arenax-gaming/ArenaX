// Middleware module for ArenaX
pub mod idempotency_middleware;
pub mod security;

pub use idempotency_middleware::IdempotencyMiddleware;
pub use security::SecurityMiddleware;

use actix_cors::Cors;
use std::env;

pub fn cors_middleware() -> Cors {
    // Get allowed origins from environment variable
    let allowed_origins = env::var("ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:3000,http://localhost:5173".to_string());
    
    let origins: Vec<&str> = allowed_origins.split(',').map(|s| s.trim()).collect();
    
    let mut cors = Cors::default();
    
    // Add each allowed origin
    for origin in origins {
        cors = cors.allowed_origin(origin);
    }
    
    cors.allow_any_method()
        .allow_any_header()
        .supports_credentials()
        .max_age(3600)
}
