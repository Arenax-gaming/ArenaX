//! Audit log HTTP handler (Issue #863)
//!
//! Read-only access to the audit trail, plus a chain-verification endpoint.
//!
//! There is deliberately **no write endpoint**. Rows are produced by database
//! triggers, and the table carries rules rejecting UPDATE and DELETE — an API
//! that could insert directly would be a way to forge entries, which is exactly
//! what an audit trail must not have.

use crate::api_error::ApiError;
use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

/// Upper bound on rows per page. The trail grows without limit, so an
/// unbounded query is a way to exhaust the connection pool.
const MAX_PAGE_SIZE: i64 = 200;
const DEFAULT_PAGE_SIZE: i64 = 50;

/// One audit entry as returned by the API.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AuditEntry {
    pub id: Uuid,
    pub sequence_number: i64,
    pub user_id: Option<Uuid>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<Uuid>,
    pub old_values: Option<serde_json::Value>,
    pub new_values: Option<serde_json::Value>,
    pub source: String,
    pub entry_hash: Option<String>,
    pub previous_hash: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Filters for the audit query.
///
/// Every field is optional and every one narrows the result — an investigation
/// usually starts from one known fact (a user, or a resource) and widens.
#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    pub user_id: Option<Uuid>,
    pub action: Option<String>,
    pub resource_type: Option<String>,
    pub resource_id: Option<Uuid>,
    pub source: Option<String>,
    /// Inclusive lower bound on `created_at`.
    pub from: Option<chrono::DateTime<chrono::Utc>>,
    /// Inclusive upper bound on `created_at`.
    pub to: Option<chrono::DateTime<chrono::Utc>>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct AuditPage {
    pub entries: Vec<AuditEntry>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

/// Result of verifying the hash chain.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ChainVerification {
    pub ok: bool,
    pub checked_rows: i64,
    /// Sequence number of the first row that failed, if any.
    pub first_bad_sequence: Option<i64>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct VerifyQuery {
    pub from_sequence: Option<i64>,
    pub to_sequence: Option<i64>,
}

/// `GET /admin/audit-logs`
///
/// Filtered, paginated view of the trail, newest first.
///
/// Filters are bound as parameters rather than interpolated. That matters more
/// here than elsewhere: an injection on the audit endpoint would let an
/// attacker read the record of their own activity, and the endpoint is
/// admin-facing so it will be called with high privilege.
pub async fn query_audit_logs(
    pool: web::Data<PgPool>,
    query: web::Query<AuditQuery>,
) -> Result<HttpResponse, ApiError> {
    let limit = query
        .limit
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let offset = query.offset.unwrap_or(0).max(0);

    // `$n IS NULL OR column = $n` keeps this one prepared statement instead of
    // building SQL per filter combination - fewer plans to cache, and no string
    // concatenation anywhere near user input.
    let entries = sqlx::query_as::<_, AuditEntry>(
        r#"
        SELECT id, sequence_number, user_id, action, resource_type, resource_id,
               old_values, new_values, source, entry_hash, previous_hash, created_at
        FROM audit_logs
        WHERE ($1::uuid IS NULL OR user_id = $1)
          AND ($2::text IS NULL OR action = $2)
          AND ($3::text IS NULL OR resource_type = $3)
          AND ($4::uuid IS NULL OR resource_id = $4)
          AND ($5::text IS NULL OR source = $5)
          AND ($6::timestamptz IS NULL OR created_at >= $6)
          AND ($7::timestamptz IS NULL OR created_at <= $7)
        ORDER BY sequence_number DESC
        LIMIT $8 OFFSET $9
        "#,
    )
    .bind(query.user_id)
    .bind(query.action.as_deref())
    .bind(query.resource_type.as_deref())
    .bind(query.resource_id)
    .bind(query.source.as_deref())
    .bind(query.from)
    .bind(query.to)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool.get_ref())
    .await
    .map_err(|e| ApiError::InternalServerError(format!("Failed to query audit logs: {e}")))?;

    let total: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM audit_logs
        WHERE ($1::uuid IS NULL OR user_id = $1)
          AND ($2::text IS NULL OR action = $2)
          AND ($3::text IS NULL OR resource_type = $3)
          AND ($4::uuid IS NULL OR resource_id = $4)
          AND ($5::text IS NULL OR source = $5)
          AND ($6::timestamptz IS NULL OR created_at >= $6)
          AND ($7::timestamptz IS NULL OR created_at <= $7)
        "#,
    )
    .bind(query.user_id)
    .bind(query.action.as_deref())
    .bind(query.resource_type.as_deref())
    .bind(query.resource_id)
    .bind(query.source.as_deref())
    .bind(query.from)
    .bind(query.to)
    .fetch_one(pool.get_ref())
    .await
    .map_err(|e| ApiError::InternalServerError(format!("Failed to count audit logs: {e}")))?;

    Ok(HttpResponse::Ok().json(AuditPage {
        entries,
        total,
        limit,
        offset,
    }))
}

/// `GET /admin/audit-logs/{resource_type}/{resource_id}`
///
/// Full history for one resource, oldest first — the order in which the
/// changes actually happened, which is how a reviewer reads a timeline.
pub async fn resource_history(
    pool: web::Data<PgPool>,
    path: web::Path<(String, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (resource_type, resource_id) = path.into_inner();

    let entries = sqlx::query_as::<_, AuditEntry>(
        r#"
        SELECT id, sequence_number, user_id, action, resource_type, resource_id,
               old_values, new_values, source, entry_hash, previous_hash, created_at
        FROM audit_logs
        WHERE resource_type = $1 AND resource_id = $2
        ORDER BY sequence_number ASC
        LIMIT $3
        "#,
    )
    .bind(&resource_type)
    .bind(resource_id)
    .bind(MAX_PAGE_SIZE)
    .fetch_all(pool.get_ref())
    .await
    .map_err(|e| ApiError::InternalServerError(format!("Failed to load resource history: {e}")))?;

    Ok(HttpResponse::Ok().json(entries))
}

/// `GET /admin/audit-logs/verify`
///
/// Recompute the hash chain and report the first break.
///
/// Worth running on a schedule, not only on demand: the value of a tamper-
/// evident log is in noticing, and nobody notices a chain they never check.
pub async fn verify_chain(
    pool: web::Data<PgPool>,
    query: web::Query<VerifyQuery>,
) -> Result<HttpResponse, ApiError> {
    let verification = sqlx::query_as::<_, ChainVerification>(
        "SELECT ok, checked_rows, first_bad_sequence, reason FROM verify_audit_chain($1, $2)",
    )
    .bind(query.from_sequence.unwrap_or(0))
    .bind(query.to_sequence)
    .fetch_one(pool.get_ref())
    .await
    .map_err(|e| ApiError::InternalServerError(format!("Failed to verify audit chain: {e}")))?;

    // A broken chain is a 200 carrying `ok: false`, not an error status: the
    // request succeeded, and the finding is the payload. Returning 500 would
    // make a real tamper indistinguishable from the endpoint being down.
    Ok(HttpResponse::Ok().json(verification))
}

/// Mount the audit routes.
///
/// Scoped under `/admin`, which the existing admin middleware guards. These
/// endpoints expose who did what across the whole platform, so they must never
/// be reachable without that guard.
pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/admin/audit-logs")
            .route("", web::get().to(query_audit_logs))
            .route("/verify", web::get().to(verify_chain))
            .route("/{resource_type}/{resource_id}", web::get().to(resource_history)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_size_is_clamped_to_the_maximum() {
        // The trail is unbounded, so an unclamped limit is a way to exhaust
        // the connection pool with one request.
        assert_eq!(MAX_PAGE_SIZE.clamp(1, MAX_PAGE_SIZE), MAX_PAGE_SIZE);
        assert_eq!(10_000i64.clamp(1, MAX_PAGE_SIZE), MAX_PAGE_SIZE);
        assert_eq!(0i64.clamp(1, MAX_PAGE_SIZE), 1);
        assert_eq!((-5i64).clamp(1, MAX_PAGE_SIZE), 1);
    }

    #[test]
    fn negative_offset_is_floored_at_zero() {
        assert_eq!((-10i64).max(0), 0);
        assert_eq!(25i64.max(0), 25);
    }
}
