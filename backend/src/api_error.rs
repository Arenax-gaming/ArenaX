use actix_web::{HttpResponse, ResponseError};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
#[allow(dead_code)]
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
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    code: u16,
    details: Option<String>,
}

impl ResponseError for ApiError {
    fn error_response(&self) -> HttpResponse {
        let (status, message) = match self {
            ApiError::InternalServerError => (
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                self.to_string(),
            ),
            ApiError::BadRequest(_) => (actix_web::http::StatusCode::BAD_REQUEST, self.to_string()),
            ApiError::Unauthorized => (actix_web::http::StatusCode::UNAUTHORIZED, self.to_string()),
            ApiError::Forbidden => (actix_web::http::StatusCode::FORBIDDEN, self.to_string()),
            ApiError::NotFound => (actix_web::http::StatusCode::NOT_FOUND, self.to_string()),
            ApiError::Conflict(_) => (actix_web::http::StatusCode::CONFLICT, self.to_string()),
            ApiError::DatabaseError(_) => (
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Database error".to_string(),
            ),
            ApiError::RedisError(_) => (
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Cache error".to_string(),
            ),
            ApiError::StellarError(_) => (
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Blockchain error".to_string(),
            ),
            ApiError::ValidationError(_) => {
                (actix_web::http::StatusCode::BAD_REQUEST, self.to_string())
            }
        };

        let error_response = ErrorResponse {
            error: message,
            code: status.as_u16(),
            details: Some(self.to_string()),
        };

        HttpResponse::build(status).json(error_response)
    }
}
