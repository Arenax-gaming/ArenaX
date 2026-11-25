use actix_web::http::StatusCode;
use actix_web::{HttpRequest, HttpResponse, ResponseError};
use serde::Serialize;
use thiserror::Error;
use tracing::error;

/// One field's validation failure.
///
/// `field` is a full path (`profile.email`, `players[1].handle`) rather than a
/// bare name, so a client can point at the input that failed inside a nested or
/// repeated structure instead of guessing which one the message refers to.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FieldError {
    pub field: String,
    /// Machine-readable rule that failed, e.g. `length`, `range`, `email`.
    pub code: String,
    pub message: String,
}

impl FieldError {
    pub fn new(
        field: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            field: field.into(),
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("Internal server error: {0}")]
    InternalServerError(String),

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

    /// Rate limit exceeded. The `RateLimit-*` headers describe the current
    /// window; clients should wait `retry_after` seconds before retrying.
    #[error("Too many requests: {message}")]
    TooManyRequests {
        message: String,
        limit: u64,
        remaining: u64,
        reset: u64,
        retry_after: u64,
    },

    /// One or more fields failed validation. Carries a per-field breakdown and
    /// answers 422, so a client can distinguish "this request was malformed"
    /// from "these specific values were rejected".
    #[error("Validation failed")]
    ValidationFailed(Vec<FieldError>),

    /// A dependency is unavailable and the request cannot be served right now.
    /// Distinct from `InternalServerError`: this says "try again", not
    /// "something is broken in a way retrying will not help".
    #[error("Service unavailable: {0}")]
    ServiceUnavailable(String),

    /// An upstream dependency is temporarily shed (e.g. its circuit breaker is
    /// open). Answers 503 with a `Retry-After` header so clients back off for
    /// `retry_after` seconds instead of hammering a known-down dependency.
    #[error("Service unavailable: {message}")]
    DependencyUnavailable { message: String, retry_after: u64 },
}

// Helper methods for convenience
impl ApiError {
    /// Machine-readable code returned to clients (Issue #1523).
    ///
    /// Every variant has its own code so a client can branch on it without
    /// parsing the human-readable `message`, and without depending on the
    /// numeric HTTP status (which is shared by several variants).
    pub fn code(&self) -> &'static str {
        match self {
            ApiError::InternalServerError(_) => "INTERNAL_ERROR",
            ApiError::BadRequest(_) => "BAD_REQUEST",
            ApiError::Unauthorized => "UNAUTHORIZED",
            ApiError::Forbidden => "FORBIDDEN",
            ApiError::NotFound => "RESOURCE_NOT_FOUND",
            ApiError::Conflict(_) => "CONFLICT",
            ApiError::DatabaseError(_) => "DATABASE_ERROR",
            ApiError::RedisError(_) => "CACHE_ERROR",
            ApiError::StellarError(_) => "STELLAR_ERROR",
            ApiError::ValidationError(_) => "VALIDATION_ERROR",
            ApiError::ValidationFailed(_) => "VALIDATION_FAILED",
            ApiError::TooManyRequests { .. } => "RATE_LIMIT_EXCEEDED",
            ApiError::ServiceUnavailable(_) => "SERVICE_UNAVAILABLE",
            ApiError::DependencyUnavailable { .. } => "DEPENDENCY_UNAVAILABLE",
        }
    }

    /// HTTP status derived from the variant, never chosen ad hoc at the call
    /// site (Issue #1523).
    pub fn status(&self) -> StatusCode {
        match self {
            ApiError::InternalServerError(_)
            | ApiError::DatabaseError(_)
            | ApiError::RedisError(_)
            | ApiError::StellarError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden => StatusCode::FORBIDDEN,
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            // 422, not 400: the request was well-formed enough to parse — it is
            // the values that were rejected.
            ApiError::ValidationError(_) | ApiError::ValidationFailed(_) => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            ApiError::TooManyRequests { .. } => StatusCode::TOO_MANY_REQUESTS,
            ApiError::ServiceUnavailable(_) | ApiError::DependencyUnavailable { .. } => {
                StatusCode::SERVICE_UNAVAILABLE
            }
        }
    }

    /// Message safe to return to the caller. Internal failures are logged with
    /// their real cause but answered generically so infrastructure details do
    /// not leak.
    pub fn public_message(&self) -> String {
        match self {
            ApiError::InternalServerError(_) => "Internal server error".to_string(),
            ApiError::DatabaseError(_) => "Database error".to_string(),
            ApiError::RedisError(_) => "Cache error".to_string(),
            ApiError::StellarError(_) => "Blockchain error".to_string(),
            other => other.to_string(),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        ApiError::BadRequest(message.into())
    }

    /// Creates an `InternalServerError` response.
    ///
    /// The `message` is written to the structured log at ERROR level so
    /// engineers can diagnose the root cause, but it is **never** forwarded
    /// to API consumers — the public response always says "Internal server
    /// error".
    pub fn internal_error(message: impl Into<String>) -> Self {
        let msg = message.into();
        error!(error.message = %msg, "Internal server error");
        ApiError::InternalServerError(msg)
    }

    pub fn internal_server_error(message: impl Into<String>) -> Self {
        Self::internal_error(message)
    }

    pub fn database_error(e: impl Into<sqlx::Error>) -> Self {
        ApiError::DatabaseError(e.into())
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        ApiError::NotFound
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        ApiError::Unauthorized
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        ApiError::Forbidden
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        ApiError::Conflict(message.into())
    }
}

/// Uniform error body returned by every `ApiError` (Issue #1523).
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    /// Machine-readable code, e.g. `RESOURCE_NOT_FOUND`.
    pub code: &'static str,
    /// Human-readable description, safe to show to the caller.
    pub message: String,
    /// Correlation id of the request, taken from the tracing middleware so a
    /// client report can be matched to the server-side log line.
    #[serde(rename = "requestId")]
    pub request_id: String,
    /// Per-field failures. Omitted entirely for non-validation errors.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<FieldError>>,
}

impl ResponseError for ApiError {
    fn status_code(&self) -> StatusCode {
        self.status()
    }

    fn error_response(&self) -> HttpResponse {
        let status = self.status();
        let error_response = ErrorResponse {
            code: self.code(),
            message: self.public_message(),
            request_id: crate::middleware::tracing_middleware::current_request_id()
                .unwrap_or_default(),
            // Field errors are the exception to "never echo internals": they
            // describe the caller's own input, so returning them leaks nothing
            // and is the only way the caller can fix the request.
            fields: match self {
                ApiError::ValidationFailed(fields) => Some(fields.clone()),
                _ => None,
            },
        };

        let mut builder = HttpResponse::build(status);
        if let ApiError::TooManyRequests {
            limit,
            remaining,
            reset,
            retry_after,
            ..
        } = self
        {
            builder.insert_header(("RateLimit-Limit", limit.to_string()));
            builder.insert_header(("RateLimit-Remaining", remaining.to_string()));
            builder.insert_header(("RateLimit-Reset", reset.to_string()));
            builder.insert_header(("Retry-After", retry_after.to_string()));
            builder.insert_header((
                "Access-Control-Expose-Headers",
                "RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After",
            ));
        }
        if let ApiError::DependencyUnavailable { retry_after, .. } = self {
            builder.insert_header(("Retry-After", retry_after.to_string()));
            builder.insert_header(("Access-Control-Expose-Headers", "Retry-After"));
        }
        builder.json(error_response)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extractor / routing fallbacks (Issue #1523)
//
// Actix answers a malformed JSON/query/path payload and an unmatched route
// with a plain-text body by default. These handlers route those failures
// through `ApiError` so every error body has the same JSON shape.
// ─────────────────────────────────────────────────────────────────────────────

fn extractor_error(error: ApiError) -> actix_web::Error {
    actix_web::error::InternalError::from_response(error.public_message(), error.error_response())
        .into()
}

pub fn json_error_handler(
    error: actix_web::error::JsonPayloadError,
    _req: &HttpRequest,
) -> actix_web::Error {
    extractor_error(ApiError::bad_request(format!("Invalid JSON body: {error}")))
}

pub fn query_error_handler(
    error: actix_web::error::QueryPayloadError,
    _req: &HttpRequest,
) -> actix_web::Error {
    extractor_error(ApiError::bad_request(format!(
        "Invalid query parameters: {error}"
    )))
}

pub fn path_error_handler(
    error: actix_web::error::PathError,
    _req: &HttpRequest,
) -> actix_web::Error {
    extractor_error(ApiError::bad_request(format!("Invalid path parameter: {error}")))
}

/// Fallback for requests that match no route.
pub async fn not_found_handler() -> ApiError {
    ApiError::NotFound
}

// ─────────────────────────────────────────────────────────────────────────────
// validator::ValidationErrors → ApiError::ValidationFailed  (Issue #860)
// ─────────────────────────────────────────────────────────────────────────────

/// Flatten `validator`'s nested error tree into a flat list of field paths.
///
/// `validator` reports nested structs and lists as a tree, so a failure inside
/// `players[1].handle` arrives three levels deep. A client cannot act on that
/// shape; it needs the path. This walks the tree and joins the segments, using
/// `parent.child` for structs and `parent[i].child` for lists.
fn flatten_validation_errors(
    prefix: &str,
    errors: &validator::ValidationErrors,
    out: &mut Vec<FieldError>,
) {
    for (field, kind) in errors.errors() {
        let path = if prefix.is_empty() {
            field.to_string()
        } else {
            format!("{prefix}.{field}")
        };

        match kind {
            validator::ValidationErrorsKind::Field(field_errors) => {
                for err in field_errors {
                    let message = err
                        .message
                        .as_ref()
                        .map(|m| m.to_string())
                        // `validator` leaves the message unset for built-in
                        // rules; the code is the only thing that describes the
                        // failure, so fall back to it rather than to an empty
                        // string.
                        .unwrap_or_else(|| format!("failed the '{}' rule", err.code));
                    out.push(FieldError::new(path.clone(), err.code.to_string(), message));
                }
            }
            validator::ValidationErrorsKind::Struct(nested) => {
                flatten_validation_errors(&path, nested, out);
            }
            validator::ValidationErrorsKind::List(items) => {
                for (index, nested) in items {
                    flatten_validation_errors(&format!("{path}[{index}]"), nested, out);
                }
            }
        }
    }
}

impl From<validator::ValidationErrors> for ApiError {
    fn from(errors: validator::ValidationErrors) -> Self {
        let mut fields = Vec::new();
        flatten_validation_errors("", &errors, &mut fields);
        // Deterministic order: the same bad request must produce the same
        // response, and `validator` iterates a hash map.
        fields.sort_by(|a, b| a.field.cmp(&b.field).then(a.code.cmp(&b.code)));
        ApiError::ValidationFailed(fields)
    }
}

#[cfg(test)]
mod validation_tests {
    use super::*;
    use actix_web::ResponseError;
    use validator::{Validate, ValidationErrors};

    #[derive(Debug, Validate)]
    struct Inner {
        #[validate(length(min = 3))]
        handle: String,
    }

    #[derive(Debug, Validate)]
    struct Outer {
        #[validate(email)]
        email: String,
        #[validate(range(min = 1, max = 100))]
        age: u32,
        #[validate(nested)]
        inner: Inner,
    }

    fn errors_for(outer: &Outer) -> ValidationErrors {
        outer.validate().expect_err("expected validation to fail")
    }

    fn fields_of(err: &ApiError) -> Vec<FieldError> {
        match err {
            ApiError::ValidationFailed(fields) => fields.clone(),
            other => panic!("expected ValidationFailed, got {other:?}"),
        }
    }

    #[test]
    fn validation_answers_422_not_400() {
        let err = ApiError::ValidationFailed(vec![FieldError::new("email", "email", "invalid")]);

        assert_eq!(err.error_response().status().as_u16(), 422);
    }

    #[test]
    fn the_legacy_string_variant_also_answers_422() {
        // Same class of failure, so the same status — a caller should not have
        // to know which code path rejected it.
        let err = ApiError::ValidationError("bad input".to_string());

        assert_eq!(err.error_response().status().as_u16(), 422);
    }

    #[test]
    fn reports_one_entry_per_failing_field() {
        let outer = Outer {
            email: "not-an-email".to_string(),
            age: 500,
            inner: Inner { handle: "ok".to_string() },
        };

        let fields = fields_of(&ApiError::from(errors_for(&outer)));

        let names: Vec<&str> = fields.iter().map(|f| f.field.as_str()).collect();
        assert!(names.contains(&"email"));
        assert!(names.contains(&"age"));
    }

    #[test]
    fn nested_failures_carry_the_full_path() {
        let outer = Outer {
            email: "a@example.com".to_string(),
            age: 30,
            inner: Inner { handle: "x".to_string() },
        };

        let fields = fields_of(&ApiError::from(errors_for(&outer)));

        // Not "handle" — a client cannot act on a bare name it cannot locate.
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].field, "inner.handle");
    }

    #[test]
    fn carries_the_rule_that_failed_as_a_machine_readable_code() {
        let outer = Outer {
            email: "nope".to_string(),
            age: 30,
            inner: Inner { handle: "abc".to_string() },
        };

        let fields = fields_of(&ApiError::from(errors_for(&outer)));

        assert_eq!(fields[0].code, "email");
    }

    #[test]
    fn range_violations_are_reported_with_the_range_code() {
        let outer = Outer {
            email: "a@example.com".to_string(),
            age: 0,
            inner: Inner { handle: "abc".to_string() },
        };

        let fields = fields_of(&ApiError::from(errors_for(&outer)));

        assert_eq!(fields[0].field, "age");
        assert_eq!(fields[0].code, "range");
    }

    #[test]
    fn field_order_is_deterministic() {
        let outer = Outer {
            email: "nope".to_string(),
            age: 500,
            inner: Inner { handle: "x".to_string() },
        };

        let first = fields_of(&ApiError::from(errors_for(&outer)));
        let second = fields_of(&ApiError::from(errors_for(&outer)));

        // validator iterates a hash map, so without sorting the same bad
        // request could answer with a different ordering each time.
        assert_eq!(first, second);
        assert_eq!(
            first.iter().map(|f| f.field.as_str()).collect::<Vec<_>>(),
            vec!["age", "email", "inner.handle"]
        );
    }

    #[test]
    fn a_message_is_always_present_even_for_built_in_rules() {
        let outer = Outer {
            email: "nope".to_string(),
            age: 30,
            inner: Inner { handle: "abc".to_string() },
        };

        let fields = fields_of(&ApiError::from(errors_for(&outer)));

        assert!(!fields[0].message.is_empty());
    }

    #[test]
    fn non_validation_errors_carry_no_field_breakdown() {
        let response = ApiError::NotFound.error_response();

        assert_eq!(response.status().as_u16(), 404);
    }
}


#[cfg(test)]
mod error_contract_tests {
    use super::*;
    use actix_web::body::to_bytes;
    use std::collections::HashSet;

    fn all_variants() -> Vec<ApiError> {
        vec![
            ApiError::InternalServerError("boom".into()),
            ApiError::BadRequest("bad".into()),
            ApiError::Unauthorized,
            ApiError::Forbidden,
            ApiError::NotFound,
            ApiError::Conflict("duplicate".into()),
            ApiError::DatabaseError(sqlx::Error::RowNotFound),
            ApiError::RedisError("down".into()),
            ApiError::StellarError("rpc".into()),
            ApiError::ValidationError("invalid".into()),
            ApiError::ValidationFailed(vec![FieldError::new("email", "email", "invalid")]),
            ApiError::TooManyRequests {
                message: "slow down".into(),
                limit: 10,
                remaining: 0,
                reset: 1,
                retry_after: 1,
            },
            ApiError::ServiceUnavailable("maintenance".into()),
            ApiError::DependencyUnavailable {
                message: "breaker open".into(),
                retry_after: 5,
            },
        ]
    }

    #[test]
    fn every_variant_has_a_unique_machine_readable_code() {
        let variants = all_variants();
        let codes: HashSet<&'static str> = variants.iter().map(ApiError::code).collect();

        assert_eq!(codes.len(), variants.len(), "codes must be unique");
        for code in codes {
            assert!(
                code.chars().all(|c| c.is_ascii_uppercase() || c == '_'),
                "{code} must be SCREAMING_SNAKE_CASE"
            );
        }
    }

    #[test]
    fn status_is_derived_from_the_variant() {
        assert_eq!(ApiError::NotFound.status(), StatusCode::NOT_FOUND);
        assert_eq!(ApiError::Forbidden.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            ApiError::ValidationError("x".into()).status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            ApiError::DependencyUnavailable {
                message: "x".into(),
                retry_after: 1
            }
            .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            ApiError::InternalServerError("x".into()).status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn a_missing_resource_is_a_404_with_resource_not_found() {
        let response = ApiError::NotFound.error_response();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(ApiError::NotFound.code(), "RESOURCE_NOT_FOUND");
    }

    #[actix_web::test]
    async fn error_body_uses_the_uniform_code_message_request_id_shape() {
        let response = ApiError::NotFound.error_response();
        let bytes = to_bytes(response.into_body()).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["code"], "RESOURCE_NOT_FOUND");
        assert_eq!(body["message"], "Not found");
        assert_eq!(body["requestId"], "");
        assert!(body.get("error").is_none(), "legacy field must be gone");
        assert!(body.get("details").is_none(), "legacy field must be gone");
    }

    #[actix_web::test]
    async fn request_id_is_taken_from_the_correlation_scope() {
        let body = crate::middleware::tracing_middleware::scope_request_id(
            "corr-123".to_string(),
            async {
                let response = ApiError::Forbidden.error_response();
                let bytes = to_bytes(response.into_body()).await.unwrap();
                serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()
            },
        )
        .await;

        assert_eq!(body["requestId"], "corr-123");
    }

    #[actix_web::test]
    async fn internal_details_are_not_leaked() {
        let response =
            ApiError::InternalServerError("connection string leaked".into()).error_response();
        let bytes = to_bytes(response.into_body()).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["code"], "INTERNAL_ERROR");
        assert_eq!(body["message"], "Internal server error");
        assert!(!body.to_string().contains("connection string leaked"));
    }

    #[actix_web::test]
    async fn validation_failures_keep_the_field_breakdown() {
        let error = ApiError::ValidationFailed(vec![FieldError::new("age", "range", "out of range")]);
        let response = error.error_response();
        let bytes = to_bytes(response.into_body()).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["code"], "VALIDATION_FAILED");
        assert_eq!(body["fields"][0]["field"], "age");
    }
}
