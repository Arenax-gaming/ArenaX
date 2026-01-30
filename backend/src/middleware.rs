use actix_cors::Cors;

pub fn cors_middleware() -> Cors {
    Cors::default()
        .allow_any_origin()
        .allow_any_method()
        .allow_any_header()
        .max_age(3600)
}

// Placeholder for authentication middleware
// pub fn auth_middleware() -> impl Middleware<...> { ... }

// Placeholder for rate limiting middleware
// pub fn rate_limit_middleware() -> impl Middleware<...> { ... }
