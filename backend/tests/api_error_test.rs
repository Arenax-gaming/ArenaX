use actix_web::ResponseError;
use arenax_backend::api_error::ApiError;
use serde_json::Value;

// ── helper ────────────────────────────────────────────────────────────────────

fn response_body(err: &ApiError) -> Value {
    let resp = err.error_response();
    let body = resp.into_body();
    let rt = tokio::runtime::Runtime::new().unwrap();
    let bytes = rt
        .block_on(actix_web::body::to_bytes(body))
        .expect("body bytes");
    serde_json::from_slice(&bytes).expect("valid JSON")
}

// ── 5xx: internal details must never leak ────────────────────────────────────

#[test]
fn internal_server_error_hides_details() {
    let err = ApiError::InternalServerError;
    let body = response_body(&err);
    assert_eq!(body["error"], "An internal error occurred");
    assert!(body.get("details").is_none() || body["details"].is_null());
}

#[test]
fn database_error_hides_details() {
    let err = ApiError::DatabaseError(sqlx::Error::RowNotFound);
    let body = response_body(&err);
    assert_eq!(body["error"], "An internal error occurred");
    let raw = body["error"].as_str().unwrap();
    assert!(!raw.contains("RowNotFound"), "DB detail leaked: {raw}");
    assert!(body.get("details").is_none() || body["details"].is_null());
}

#[test]
fn redis_error_hides_details() {
    let err = ApiError::RedisError("connection refused at 127.0.0.1:6379".into());
    let body = response_body(&err);
    assert_eq!(body["error"], "An internal error occurred");
    let raw = body["error"].as_str().unwrap();
    assert!(!raw.contains("6379"), "Redis detail leaked: {raw}");
    assert!(body.get("details").is_none() || body["details"].is_null());
}

#[test]
fn stellar_error_hides_details() {
    let err = ApiError::StellarError("horizon timeout: tx_bad_seq".into());
    let body = response_body(&err);
    assert_eq!(body["error"], "An internal error occurred");
    let raw = body["error"].as_str().unwrap();
    assert!(!raw.contains("tx_bad_seq"), "Stellar detail leaked: {raw}");
}

// ── 5xx: correlation ID is present and is a valid UUID ───────────────────────

#[test]
fn internal_server_error_has_correlation_id() {
    let err = ApiError::InternalServerError;
    let body = response_body(&err);
    let cid = body["correlation_id"].as_str().expect("correlation_id missing");
    uuid::Uuid::parse_str(cid).expect("correlation_id must be a valid UUID");
}

#[test]
fn database_error_has_correlation_id() {
    let err = ApiError::DatabaseError(sqlx::Error::RowNotFound);
    let body = response_body(&err);
    let cid = body["correlation_id"].as_str().expect("correlation_id missing");
    uuid::Uuid::parse_str(cid).expect("correlation_id must be a valid UUID");
}

#[test]
fn each_error_gets_unique_correlation_id() {
    let err1 = ApiError::InternalServerError;
    let err2 = ApiError::InternalServerError;
    let cid1 = response_body(&err1)["correlation_id"]
        .as_str()
        .unwrap()
        .to_string();
    let cid2 = response_body(&err2)["correlation_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_ne!(cid1, cid2, "correlation IDs must be unique per error");
}

// ── 4xx: client-safe messages are preserved ──────────────────────────────────

#[test]
fn bad_request_preserves_message() {
    let err = ApiError::BadRequest("email is required".into());
    let body = response_body(&err);
    assert!(
        body["error"].as_str().unwrap().contains("email is required"),
        "4xx message must be preserved"
    );
    assert!(
        body.get("correlation_id").is_none() || body["correlation_id"].is_null(),
        "4xx must not have a correlation_id"
    );
}

#[test]
fn validation_error_preserves_message() {
    let err = ApiError::ValidationError("username too short".into());
    let body = response_body(&err);
    assert!(body["error"].as_str().unwrap().contains("username too short"));
}

#[test]
fn conflict_preserves_message() {
    let err = ApiError::Conflict("username already taken".into());
    let body = response_body(&err);
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("username already taken"));
}

#[test]
fn too_many_requests_preserves_message() {
    let err = ApiError::TooManyRequests("retry after 60s".into());
    let body = response_body(&err);
    assert!(body["error"].as_str().unwrap().contains("retry after 60s"));
}

// ── status codes ─────────────────────────────────────────────────────────────

#[test]
fn status_codes_are_correct() {
    use actix_web::http::StatusCode;
    let cases: Vec<(ApiError, StatusCode)> = vec![
        (ApiError::InternalServerError, StatusCode::INTERNAL_SERVER_ERROR),
        (ApiError::DatabaseError(sqlx::Error::RowNotFound), StatusCode::INTERNAL_SERVER_ERROR),
        (ApiError::RedisError("x".into()), StatusCode::INTERNAL_SERVER_ERROR),
        (ApiError::StellarError("x".into()), StatusCode::INTERNAL_SERVER_ERROR),
        (ApiError::BadRequest("x".into()), StatusCode::BAD_REQUEST),
        (ApiError::ValidationError("x".into()), StatusCode::BAD_REQUEST),
        (ApiError::Unauthorized, StatusCode::UNAUTHORIZED),
        (ApiError::Forbidden, StatusCode::FORBIDDEN),
        (ApiError::NotFound, StatusCode::NOT_FOUND),
        (ApiError::Conflict("x".into()), StatusCode::CONFLICT),
        (ApiError::TooManyRequests("x".into()), StatusCode::TOO_MANY_REQUESTS),
    ];
    for (err, expected) in &cases {
        assert_eq!(err.status_code(), *expected, "wrong status for {err:?}");
    }
}
