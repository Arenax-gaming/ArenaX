use actix_web::{HttpResponse, ResponseError};
use serde::Serialize;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("Internal server error")]
    InternalServerError,

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Forbidden")]
    Forbidden,

    #[error("Not found")]
    NotFound,

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),

    #[error("Redis error: {0}")]
    RedisError(String),

    #[error("Stellar error: {0}")]
    StellarError(String),

    #[error("Validation error: {0}")]
    ValidationError(String),

    #[error("Too many requests: {0}")]
    TooManyRequests(String),
}

impl ApiError {
    // ── constructor helpers ───────────────────────────────────────────────────

    pub fn bad_request(message: impl Into<String>) -> Self {
        ApiError::BadRequest(message.into())
    }

    pub fn internal_error(_message: impl Into<String>) -> Self {
        ApiError::InternalServerError
    }

    pub fn database_error(e: impl Into<sqlx::Error>) -> Self {
        ApiError::DatabaseError(e.into())
    }

    pub fn not_found(_message: impl Into<String>) -> Self {
        ApiError::NotFound
    }

    pub fn unauthorized(_message: impl Into<String>) -> Self {
        ApiError::Unauthorized
    }

    pub fn forbidden(_message: impl Into<String>) -> Self {
        ApiError::Forbidden
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        ApiError::Conflict(message.into())
    }

    // ── classification ────────────────────────────────────────────────────────

    /// Returns `true` for server-side (5xx) errors whose internal details
    /// must never be exposed to API clients.
    fn is_server_error(&self) -> bool {
        matches!(
            self,
            ApiError::InternalServerError
                | ApiError::DatabaseError(_)
                | ApiError::RedisError(_)
                | ApiError::StellarError(_)
        )
    }
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    code: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    correlation_id: Option<String>,
}

impl ResponseError for ApiError {
    fn status_code(&self) -> actix_web::http::StatusCode {
        match self {
            ApiError::InternalServerError
            | ApiError::DatabaseError(_)
            | ApiError::RedisError(_)
            | ApiError::StellarError(_) => actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
            ApiError::BadRequest(_) | ApiError::ValidationError(_) => {
                actix_web::http::StatusCode::BAD_REQUEST
            }
            ApiError::Unauthorized => actix_web::http::StatusCode::UNAUTHORIZED,
            ApiError::Forbidden => actix_web::http::StatusCode::FORBIDDEN,
            ApiError::NotFound => actix_web::http::StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => actix_web::http::StatusCode::CONFLICT,
            ApiError::TooManyRequests(_) => actix_web::http::StatusCode::TOO_MANY_REQUESTS,
        }
    }

    fn error_response(&self) -> HttpResponse {
        let status = self.status_code();

        let (message, correlation_id) = if self.is_server_error() {
            let cid = Uuid::new_v4().to_string();
            tracing::error!(
                correlation_id = %cid,
                error = %self,
                error_kind = ?std::mem::discriminant(self),
                "Internal server error"
            );
            ("An internal error occurred".to_string(), Some(cid))
        } else {
            (self.to_string(), None)
        };

        HttpResponse::build(status).json(ErrorResponse {
            error: message,
            code: status.as_u16(),
            details: None,
            correlation_id,
        })
    }
}
