use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::idempotency::*;
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use sqlx;
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Mutex;
use thiserror::Error;
use uuid::Uuid;

pub struct IdempotencyService {
    db_pool: DbPool,
    policy: IdempotencyPolicy,
}

impl IdempotencyService {
    pub fn new(db_pool: DbPool, policy: IdempotencyPolicy) -> Self {
        Self { db_pool, policy }
    }

    pub fn default(db_pool: DbPool) -> Self {
        Self::new(db_pool, IdempotencyPolicy::default())
    }

    /// Store a new idempotency key with response data
    pub async fn store_key(
        &self,
        key: String,
        request_hash: String,
        response: CachedResponse,
    ) -> Result<(), ApiError> {
        // Check response size
        if response.size_kb() > self.policy.max_response_size_kb {
            return Err(ApiError::bad_request(&format!(
                "Response too large for idempotency caching (max {}KB)",
                self.policy.max_response_size_kb
            )));
        }

        let expires_at = Utc::now() + chrono::Duration::seconds(self.policy.default_ttl_seconds as i64);

        sqlx::query!(
            r#"
            INSERT INTO idempotency_keys (
                id, key, request_hash, response_status, 
                response_headers, response_body, created_at, expires_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8
            ) ON CONFLICT (key) DO NOTHING
            "#,
            Uuid::new_v4(),
            key,
            request_hash,
            response.status as i16,
            response.headers,
            response.body,
            Utc::now(),
            expires_at
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    /// Get cached response for an idempotency key
    pub async fn get_cached_response(&self, key: &str) -> Result<Option<IdempotencyKey>, ApiError> {
        let result = sqlx::query_as!(
            IdempotencyKey,
            r#"
            SELECT * FROM idempotency_keys 
            WHERE key = $1 
            AND expires_at > NOW()
            AND used_at IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            key
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(result)
    }

    /// Check if there's a conflict with existing idempotency key
    pub async fn check_conflict(
        &self,
        key: &str,
        new_hash: &str,
    ) -> Result<Option<IdempotencyConflict>, ApiError> {
        let result = sqlx::query!(
            r#"
            SELECT key, request_hash, created_at 
            FROM idempotency_keys 
            WHERE key = $1 
            AND expires_at > NOW()
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            key
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if let Some(existing) = result {
            if existing.request_hash != new_hash {
                return Ok(Some(IdempotencyConflict {
                    key: key.to_string(),
                    original_hash: existing.request_hash,
                    new_hash: new_hash.to_string(),
                    original_timestamp: existing.created_at,
                    conflict_type: ConflictType::PayloadMismatch,
                }));
            }
        }

        Ok(None)
    }

    /// Mark an idempotency key as used
    pub async fn mark_key_used(&self, key: &str) -> Result<(), ApiError> {
        sqlx::query!(
            "UPDATE idempotency_keys SET used_at = NOW() WHERE key = $1",
            key
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    /// Clean up expired idempotency keys
    pub async fn cleanup_expired_keys(&self) -> Result<i64, ApiError> {
        let result = sqlx::query!(
            "DELETE FROM idempotency_keys WHERE expires_at <= NOW()"
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(result.rows_affected())
    }

    /// Get statistics about idempotency key usage
    pub async fn get_usage_stats(&self) -> Result<IdempotencyStats, ApiError> {
        let total_keys = sqlx::query_scalar!(
            "SELECT COUNT(*) as count FROM idempotency_keys"
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let active_keys = sqlx::query_scalar!(
            "SELECT COUNT(*) as count FROM idempotency_keys WHERE expires_at > NOW()"
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let used_keys = sqlx::query_scalar!(
            "SELECT COUNT(*) as count FROM idempotency_keys WHERE used_at IS NOT NULL"
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let conflicts_detected = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as count 
            FROM idempotency_keys 
            WHERE created_at > NOW() - INTERVAL '24 hours'
            GROUP BY key 
            HAVING COUNT(*) > 1
            "#
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(IdempotencyStats {
            total_keys: total_keys.unwrap_or(0),
            active_keys: active_keys.unwrap_or(0),
            used_keys: used_keys.unwrap_or(0),
            conflicts_detected: conflicts_detected.unwrap_or(0),
        })
    }

    /// Get idempotency keys for a specific user (for debugging/admin)
    pub async fn get_user_keys(&self, user_id: Uuid, limit: i64, offset: i64) -> Result<Vec<IdempotencyKey>, ApiError> {
        let keys = sqlx::query_as!(
            IdempotencyKey,
            r#"
            SELECT ik.* FROM idempotency_keys ik
            JOIN request_logs rl ON ik.key = rl.idempotency_key
            WHERE rl.user_id = $1
            ORDER BY ik.created_at DESC
            LIMIT $2 OFFSET $3
            "#,
            user_id,
            limit,
            offset
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(keys)
    }

    /// Invalidate an idempotency key (admin function)
    pub async fn invalidate_key(&self, key: &str) -> Result<(), ApiError> {
        sqlx::query!(
            "DELETE FROM idempotency_keys WHERE key = $1",
            key
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    /// Update idempotency policy configuration
    pub async fn update_policy(&self, policy: IdempotencyPolicy) -> Result<(), ApiError> {
        // Update route configurations
        for route in &policy.enabled_routes {
            sqlx::query!(
                r#"
                INSERT INTO idempotency_configs (id, route_pattern, enabled, ttl_seconds, max_response_size_kb, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (route_pattern) 
                DO UPDATE SET 
                    enabled = EXCLUDED.enabled,
                    ttl_seconds = EXCLUDED.ttl_seconds,
                    max_response_size_kb = EXCLUDED.max_response_size_kb,
                    updated_at = EXCLUDED.updated_at
                "#,
                Uuid::new_v4(),
                route,
                true,
                policy.default_ttl_seconds,
                policy.max_response_size_kb,
                Utc::now(),
                Utc::now()
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        }

        Ok(())
    }

    /// Get route-specific configuration
    pub async fn get_route_config(&self, route_pattern: &str) -> Result<Option<IdempotencyConfig>, ApiError> {
        let config = sqlx::query_as!(
            IdempotencyConfig,
            "SELECT * FROM idempotency_configs WHERE route_pattern = $1",
            route_pattern
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(config)
    }

    /// Persistent store for Soroban submission idempotency keys (Issue #1345),
    /// backed by the same pool as the HTTP idempotency keys.
    pub fn submission_store(&self) -> PgSubmissionStore {
        PgSubmissionStore::new(self.db_pool.clone())
    }

    /// Generate a unique idempotency key (for client convenience)
    pub fn generate_key() -> String {
        format!("idemp_{}", Uuid::new_v4().to_string().replace("-", ""))
    }

    /// Validate idempotency key format
    pub fn validate_key_format(key: &str) -> Result<(), ApiError> {
        if key.len() < 8 {
            return Err(ApiError::bad_request("Idempotency key must be at least 8 characters"));
        }

        if key.len() > 255 {
            return Err(ApiError::bad_request("Idempotency key must be less than 255 characters"));
        }

        // Check for valid characters (alphanumeric, hyphens, underscores)
        if !key.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
            return Err(ApiError::bad_request("Idempotency key can only contain alphanumeric characters, hyphens, and underscores"));
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdempotencyStats {
    pub total_keys: i64,
    pub active_keys: i64,
    pub used_keys: i64,
    pub conflicts_detected: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdempotencyKeyRequest {
    pub route_pattern: Option<String>,
    pub ttl_seconds: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdempotencyKeyResponse {
    pub key: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub ttl_seconds: i32,
}

impl IdempotencyKeyResponse {
    pub fn new(key: String, ttl_seconds: i32) -> Self {
        Self {
            key,
            expires_at: Utc::now() + chrono::Duration::seconds(ttl_seconds as i64),
            ttl_seconds,
        }
    }
}

// =============================================================================
// SOROBAN SUBMISSION IDEMPOTENCY (Issue #1345)
// =============================================================================
//
// Lifecycle of one idempotency key:
//
//   reserved ──(signed envelope + tx hash persisted)──▶ signed ──▶ completed
//                                                           └────▶ failed
//
// `reserved` is written before anything touches the network. `signed` is
// written before the first send, so after a crash or a lost response the
// retry knows exactly which transaction it may already have submitted and
// checks the ledger for that hash before re-sending the *same* envelope.
// `completed` / `failed` are terminal and returned as-is for duplicate keys.

/// How long a `reserved` row (nothing persisted to send yet) is treated as
/// owned by an in-flight worker before another attempt may take it over.
pub const SUBMISSION_RESERVATION_LEASE_SECS: i64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubmissionStatus {
    Reserved,
    Signed,
    Completed,
    Failed,
}

impl SubmissionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reserved => "reserved",
            Self::Signed => "signed",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "reserved" => Some(Self::Reserved),
            "signed" => Some(Self::Signed),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmissionRecord {
    pub idempotency_key: String,
    pub request_hash: String,
    pub status: SubmissionStatus,
    pub tx_hash: Option<String>,
    /// Signed envelope, kept so a retry re-sends the identical transaction
    /// (same source sequence number → the network executes it at most once).
    pub signed_envelope: Option<String>,
    /// Terminal result (a serialized `SorobanTxResult`).
    pub result: Option<serde_json::Value>,
    pub attempts: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub enum ReserveOutcome {
    /// The key was new; the caller owns this submission.
    Reserved(SubmissionRecord),
    /// The key already existed with the same payload.
    Existing(SubmissionRecord),
}

#[derive(Debug, Error)]
pub enum SubmissionStoreError {
    #[error("idempotency key '{0}' was already used with a different payload")]
    PayloadMismatch(String),
    #[error("idempotency key '{0}' not found")]
    NotFound(String),
    #[error("submission store error: {0}")]
    Storage(String),
}

impl From<sqlx::Error> for SubmissionStoreError {
    fn from(err: sqlx::Error) -> Self {
        SubmissionStoreError::Storage(err.to_string())
    }
}

/// Durable record of Soroban submissions keyed by idempotency key.
///
/// Futures are boxed (rather than using `async fn` in the trait) so the store
/// can be used as `&dyn SubmissionStore`.
pub trait SubmissionStore: Send + Sync {
    /// Create the key in `reserved` state, or return the existing record.
    /// Fails with [`SubmissionStoreError::PayloadMismatch`] if the key exists
    /// for a different request.
    fn reserve<'a>(
        &'a self,
        key: &'a str,
        request_hash: &'a str,
    ) -> BoxFuture<'a, Result<ReserveOutcome, SubmissionStoreError>>;

    /// Persist the signed envelope and its hash (state → `signed`). Called
    /// before the envelope is first sent, and again if the network reports a
    /// different hash.
    fn mark_signed<'a>(
        &'a self,
        key: &'a str,
        tx_hash: &'a str,
        signed_envelope: &'a str,
    ) -> BoxFuture<'a, Result<(), SubmissionStoreError>>;

    /// Count one network submission attempt.
    fn record_attempt<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), SubmissionStoreError>>;

    /// Store the terminal result. First writer wins: a key that is already
    /// terminal keeps its original result.
    fn mark_finished<'a>(
        &'a self,
        key: &'a str,
        status: SubmissionStatus,
        result: &'a serde_json::Value,
    ) -> BoxFuture<'a, Result<(), SubmissionStoreError>>;

    fn get<'a>(
        &'a self,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Option<SubmissionRecord>, SubmissionStoreError>>;
}

// ── PostgreSQL store ────────────────────────────────────────────────────────

const SUBMISSION_COLUMNS: &str = "idempotency_key, request_hash, status, tx_hash, \
     signed_envelope, result, attempts, created_at, updated_at";

/// [`SubmissionStore`] backed by the `soroban_submissions` table.
#[derive(Clone)]
pub struct PgSubmissionStore {
    pool: DbPool,
}

impl PgSubmissionStore {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    fn row_to_record(row: &sqlx::postgres::PgRow) -> Result<SubmissionRecord, SubmissionStoreError> {
        let status: String = row.try_get("status")?;
        Ok(SubmissionRecord {
            idempotency_key: row.try_get("idempotency_key")?,
            request_hash: row.try_get("request_hash")?,
            status: SubmissionStatus::parse(&status).ok_or_else(|| {
                SubmissionStoreError::Storage(format!("unknown submission status '{}'", status))
            })?,
            tx_hash: row.try_get("tx_hash")?,
            signed_envelope: row.try_get("signed_envelope")?,
            result: row.try_get("result")?,
            attempts: row.try_get("attempts")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

impl SubmissionStore for PgSubmissionStore {
    fn reserve<'a>(
        &'a self,
        key: &'a str,
        request_hash: &'a str,
    ) -> BoxFuture<'a, Result<ReserveOutcome, SubmissionStoreError>> {
        Box::pin(async move {
            // The primary key makes the reservation atomic across workers.
            let inserted = sqlx::query(&format!(
                "INSERT INTO soroban_submissions (idempotency_key, request_hash, status) \
                 VALUES ($1, $2, 'reserved') \
                 ON CONFLICT (idempotency_key) DO NOTHING \
                 RETURNING {}",
                SUBMISSION_COLUMNS
            ))
            .bind(key)
            .bind(request_hash)
            .fetch_optional(&self.pool)
            .await?;

            if let Some(row) = inserted {
                return Ok(ReserveOutcome::Reserved(Self::row_to_record(&row)?));
            }

            let row = sqlx::query(&format!(
                "SELECT {} FROM soroban_submissions WHERE idempotency_key = $1",
                SUBMISSION_COLUMNS
            ))
            .bind(key)
            .fetch_one(&self.pool)
            .await?;
            let existing = Self::row_to_record(&row)?;
            if existing.request_hash != request_hash {
                return Err(SubmissionStoreError::PayloadMismatch(key.to_string()));
            }
            Ok(ReserveOutcome::Existing(existing))
        })
    }

    fn mark_signed<'a>(
        &'a self,
        key: &'a str,
        tx_hash: &'a str,
        signed_envelope: &'a str,
    ) -> BoxFuture<'a, Result<(), SubmissionStoreError>> {
        Box::pin(async move {
            sqlx::query(
                "UPDATE soroban_submissions \
                 SET status = 'signed', tx_hash = $2, signed_envelope = $3, updated_at = NOW() \
                 WHERE idempotency_key = $1 AND status IN ('reserved', 'signed')",
            )
            .bind(key)
            .bind(tx_hash)
            .bind(signed_envelope)
            .execute(&self.pool)
            .await?;
            Ok(())
        })
    }

    fn record_attempt<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), SubmissionStoreError>> {
        Box::pin(async move {
            sqlx::query(
                "UPDATE soroban_submissions SET attempts = attempts + 1, updated_at = NOW() \
                 WHERE idempotency_key = $1",
            )
            .bind(key)
            .execute(&self.pool)
            .await?;
            Ok(())
        })
    }

    fn mark_finished<'a>(
        &'a self,
        key: &'a str,
        status: SubmissionStatus,
        result: &'a serde_json::Value,
    ) -> BoxFuture<'a, Result<(), SubmissionStoreError>> {
        Box::pin(async move {
            sqlx::query(
                "UPDATE soroban_submissions SET status = $2, result = $3, updated_at = NOW() \
                 WHERE idempotency_key = $1 AND status NOT IN ('completed', 'failed')",
            )
            .bind(key)
            .bind(status.as_str())
            .bind(result)
            .execute(&self.pool)
            .await?;
            Ok(())
        })
    }

    fn get<'a>(
        &'a self,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Option<SubmissionRecord>, SubmissionStoreError>> {
        Box::pin(async move {
            let row = sqlx::query(&format!(
                "SELECT {} FROM soroban_submissions WHERE idempotency_key = $1",
                SUBMISSION_COLUMNS
            ))
            .bind(key)
            .fetch_optional(&self.pool)
            .await?;
            row.as_ref().map(Self::row_to_record).transpose()
        })
    }
}

// ── In-memory store ─────────────────────────────────────────────────────────

/// Process-local [`SubmissionStore`] for tests and single-node development.
/// Not durable: use [`PgSubmissionStore`] in production.
#[derive(Debug, Default)]
pub struct InMemorySubmissionStore {
    records: Mutex<HashMap<String, SubmissionRecord>>,
}

impl InMemorySubmissionStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn with_records<R>(&self, f: impl FnOnce(&mut HashMap<String, SubmissionRecord>) -> R) -> R {
        let mut records = self.records.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut records)
    }
}

impl SubmissionStore for InMemorySubmissionStore {
    fn reserve<'a>(
        &'a self,
        key: &'a str,
        request_hash: &'a str,
    ) -> BoxFuture<'a, Result<ReserveOutcome, SubmissionStoreError>> {
        Box::pin(async move {
            self.with_records(|records| {
                if let Some(existing) = records.get(key) {
                    if existing.request_hash != request_hash {
                        return Err(SubmissionStoreError::PayloadMismatch(key.to_string()));
                    }
                    return Ok(ReserveOutcome::Existing(existing.clone()));
                }
                let now = Utc::now();
                let record = SubmissionRecord {
                    idempotency_key: key.to_string(),
                    request_hash: request_hash.to_string(),
                    status: SubmissionStatus::Reserved,
                    tx_hash: None,
                    signed_envelope: None,
                    result: None,
                    attempts: 0,
                    created_at: now,
                    updated_at: now,
                };
                records.insert(key.to_string(), record.clone());
                Ok(ReserveOutcome::Reserved(record))
            })
        })
    }

    fn mark_signed<'a>(
        &'a self,
        key: &'a str,
        tx_hash: &'a str,
        signed_envelope: &'a str,
    ) -> BoxFuture<'a, Result<(), SubmissionStoreError>> {
        Box::pin(async move {
            self.with_records(|records| {
                let record = records
                    .get_mut(key)
                    .ok_or_else(|| SubmissionStoreError::NotFound(key.to_string()))?;
                if !record.status.is_terminal() {
                    record.status = SubmissionStatus::Signed;
                    record.tx_hash = Some(tx_hash.to_string());
                    record.signed_envelope = Some(signed_envelope.to_string());
                    record.updated_at = Utc::now();
                }
                Ok(())
            })
        })
    }

    fn record_attempt<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), SubmissionStoreError>> {
        Box::pin(async move {
            self.with_records(|records| {
                let record = records
                    .get_mut(key)
                    .ok_or_else(|| SubmissionStoreError::NotFound(key.to_string()))?;
                record.attempts += 1;
                record.updated_at = Utc::now();
                Ok(())
            })
        })
    }

    fn mark_finished<'a>(
        &'a self,
        key: &'a str,
        status: SubmissionStatus,
        result: &'a serde_json::Value,
    ) -> BoxFuture<'a, Result<(), SubmissionStoreError>> {
        Box::pin(async move {
            self.with_records(|records| {
                let record = records
                    .get_mut(key)
                    .ok_or_else(|| SubmissionStoreError::NotFound(key.to_string()))?;
                if !record.status.is_terminal() {
                    record.status = status;
                    record.result = Some(result.clone());
                    record.updated_at = Utc::now();
                }
                Ok(())
            })
        })
    }

    fn get<'a>(
        &'a self,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Option<SubmissionRecord>, SubmissionStoreError>> {
        Box::pin(async move { Ok(self.with_records(|records| records.get(key).cloned())) })
    }
}
