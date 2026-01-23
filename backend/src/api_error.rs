#![allow(dead_code)]

use actix_web::{HttpResponse, http::StatusCode};
use serde::{Serialize, Deserialize};
use std::fmt;

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiError {
    pub error: String,
    pub message: String,
    pub code: String,
}

impl ApiError {
    pub fn new(error: impl Into<String>, message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            message: message.into(),
            code: code.into(),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new("Bad Request", message, "BAD_REQUEST")
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("Not Found", message, "NOT_FOUND")
    }

    pub fn internal_error(message: impl Into<String>) -> Self {
        Self::new("Internal Server Error", message, "INTERNAL_ERROR")
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new("Unauthorized", message, "UNAUTHORIZED")
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new("Forbidden", message, "FORBIDDEN")
    }

    pub fn database_error(err: impl std::fmt::Display) -> Self {
        Self::internal_error(format!("Database error: {}", err))
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.error, self.message)
    }
}

impl actix_web::ResponseError for ApiError {
    fn error_response(&self) -> HttpResponse {
        let status_code = match self.code.as_str() {
            "BAD_REQUEST" => StatusCode::BAD_REQUEST,
            "NOT_FOUND" => StatusCode::NOT_FOUND,
            "UNAUTHORIZED" => StatusCode::UNAUTHORIZED,
            "FORBIDDEN" => StatusCode::FORBIDDEN,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };

        HttpResponse::build(status_code).json(self)
    }
}