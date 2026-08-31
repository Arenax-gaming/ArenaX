use actix_web::{HttpResponse, ResponseError};
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
}

// Helper methods for convenience
impl ApiError {
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

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    code: u16,
    details: Option<String>,
    /// Per-field failures. Omitted entirely for non-validation errors so the
    /// response shape stays unchanged for every existing consumer.
    #[serde(skip_serializing_if = "Option::is_none")]
    fields: Option<Vec<FieldError>>,
}

impl ResponseError for ApiError {
    fn error_response(&self) -> HttpResponse {
        let (status, message) = match self {
            ApiError::InternalServerError(_) => (
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".to_string(),
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
            // 422, not 400: the request was well-formed enough to parse — it is
            // the values that were rejected.
            ApiError::ValidationError(_) => (
                actix_web::http::StatusCode::UNPROCESSABLE_ENTITY,
                self.to_string(),
            ),
            ApiError::ValidationFailed(_) => (
                actix_web::http::StatusCode::UNPROCESSABLE_ENTITY,
                self.to_string(),
            ),
            ApiError::TooManyRequests { .. } => (
                actix_web::http::StatusCode::TOO_MANY_REQUESTS,
                self.to_string(),
            ),
            ApiError::ServiceUnavailable(_) => (
                actix_web::http::StatusCode::SERVICE_UNAVAILABLE,
                self.to_string(),
            ),
        };

        let error_response = ErrorResponse {
            error: message,
            code: status.as_u16(),
            // Never echo internal details (DB errors, stack traces, etc.) back to the client.
            details: None,
            // Field errors are the exception: they describe the caller's own
            // input, so returning them leaks nothing and is the only way the
            // caller can fix the request.
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
            builder.insert_header(("Access-Control-Expose-Headers", "RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After"));
        }
        builder.json(error_response)
    }
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

