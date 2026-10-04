use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::api_key::{
    ApiKey, ApiKeyRotationHistory, ApiKeySummary, ApiKeyUsageLog, CreateApiKeyRequest,
    CreateApiKeyResponse, GenerateApiKeyRequest, GenerateApiKeyResponse, GetApiKeyResponse,
    KeyStatus, RevokeApiKeyRequest, RotateApiKeyRequest, RotateApiKeyResponse,
    UpdateApiKeyRequest,
};
use chrono::{Duration, Utc};
use sha2::{Digest, Sha256};
use std::env;
use tracing::{info, warn};
use uuid::Uuid;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

/// Default overlap window (24 hours) during which both old and new API keys
/// are accepted after rotation (zero-downtime, Issue #1080).
pub const DEFAULT_API_KEY_OVERLAP_SECONDS: i64 = 86400; // 24h

/// Maximum configurable overlap window (7 days).
pub const MAX_API_KEY_OVERLAP_SECONDS: i64 = 604800; // 7d

/// Clamp a requested overlap window to the permitted range, falling back to
/// the default when not provided.
fn normalized_overlap(requested: Option<i64>, existing: i64) -> i64 {
    requested
        .or_else(|| Some(existing))
        .unwrap_or(DEFAULT_API_KEY_OVERLAP_SECONDS)
        .clamp(0, MAX_API_KEY_OVERLAP_SECONDS)
}

/// Returns `true` when a rotated (old) key's overlap window has elapsed and
/// the key must be rejected. New keys (`old_key_expires_at = None`) are never
/// expired by this rule.
fn old_key_is_expired(old_key_expires_at: Option<chrono::DateTime<Utc>>, now: chrono::DateTime<Utc>) -> bool {
    old_key_expires_at.map(|deadline| deadline <= now).unwrap_or(false)
}

/// Calculate SHA-256 hash of a key
fn key_hash(key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// API Key Service
///
/// Manages the full lifecycle of API keys including:
/// - Key generation with configurable rotation
/// - Scoped permissions
/// - Expiration tracking
/// - Usage logging
/// - Revocation mechanism
#[derive(Clone)]
pub struct ApiKeyService {
    pool: DbPool,
}

impl ApiKeyService {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    // ── Key Generation ───────────────────────────────────────────────────────

    /// Generate a cryptographically secure API key
    fn generate_key() -> String {
        let mut bytes = [0u8; 32];
        getrandom::getrandom(&mut bytes).expect("Failed to generate random bytes");
        // Use URL-safe base64 encoding without padding
        URL_SAFE_NO_PAD.encode(&bytes)
    }

    /// Create a new API key
    #[tracing::instrument(skip(self, request), fields(user_id = %request.user_id, key_name = %request.name))]
    pub async fn create_key(
        &self,
        request: CreateApiKeyRequest,
        user_id: Uuid,
    ) -> Result<CreateApiKeyResponse, ApiError> {
        let key = Self::generate_key();
        let key_hash_value = key_hash(&key);

        // Parse expiration date if provided
        let expiration_date = request
            .expiration_date
            .as_deref()
            .map(|s| {
                chrono::DateTime::parse_from_rfc3339(s)
                    .map(|dt| dt.with_timezone(&Utc))
                    .map_err(|_| ApiError::bad_request("Invalid expiration date format"))
            })
            .transpose()?;

        // Parse rotation interval if provided
        let rotation_interval = request
            .rotation_interval
            .as_deref()
            .map(|s| Self::parse_duration_str(s))
            .transpose()?;

        let now = Utc::now();
        let next_rotation_date = if request.rotation_enabled.unwrap_or(false) {
            Some(now + Duration::seconds(rotation_interval.unwrap_or(7776000)))
        } else {
            None
        };

        let overlap_duration_seconds = request
            .overlap_duration_seconds
            .unwrap_or(DEFAULT_API_KEY_OVERLAP_SECONDS)
            .clamp(0, MAX_API_KEY_OVERLAP_SECONDS);

        let key_id = Uuid::new_v4();

        // Insert the API key
        sqlx::query!(
            r#"
            INSERT INTO api_keys (
                id, key, name, description, user_id, key_type, scopes,
                expiration_date, is_active, rotation_enabled, rotation_interval,
                next_rotation_date, max_uses, metadata, overlap_duration_seconds, webhook_url
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12, $13, $14, $15)
            "#,
            key_id,
            &key_hash_value,
            request.name,
            request.description,
            user_id,
            "api_key",
            request.scopes.as_slice(),
            expiration_date,
            request.rotation_enabled.unwrap_or(false),
            rotation_interval,
            next_rotation_date,
            request.max_uses,
            request.metadata
                .map(|m| serde_json::to_value(m).unwrap_or_default())
                .unwrap_or_default(),
            overlap_duration_seconds,
            request.webhook_url,
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        info!(key_id = %key_id, "API key created");

        Ok(CreateApiKeyResponse {
            id: key_id,
            key,
            scopes: request.scopes,
            expiration_date,
            name: request.name,
        })
    }

    /// Generate a new API key (for rotation)
    #[tracing::instrument(skip(self, request), fields(key_name = %request.name))]
    pub async fn generate_key(
        &self,
        request: GenerateApiKeyRequest,
        user_id: Uuid,
    ) -> Result<GenerateApiKeyResponse, ApiError> {
        let key = Self::generate_key();
        let key_hash_value = key_hash(&key);

        let expiration_date = request
            .expiration_date
            .as_deref()
            .map(|s| {
                chrono::DateTime::parse_from_rfc3339(s)
                    .map(|dt| dt.with_timezone(&Utc))
                    .map_err(|_| ApiError::bad_request("Invalid expiration date format"))
            })
            .transpose()?;

        let rotation_interval = request
            .rotation_interval
            .as_deref()
            .map(|s| Self::parse_duration_str(s))
            .transpose()?;

        let now = Utc::now();
        let next_rotation_date = if request.rotation_enabled.unwrap_or(false) {
            Some(now + Duration::seconds(rotation_interval.unwrap_or(7776000)))
        } else {
            None
        };

        let overlap_duration_seconds = request
            .overlap_duration_seconds
            .unwrap_or(DEFAULT_API_KEY_OVERLAP_SECONDS)
            .clamp(0, MAX_API_KEY_OVERLAP_SECONDS);

        let key_id = Uuid::new_v4();

        sqlx::query!(
            r#"
            INSERT INTO api_keys (
                id, key, name, description, user_id, key_type, scopes,
                expiration_date, is_active, rotation_enabled, rotation_interval,
                next_rotation_date, max_uses, metadata, overlap_duration_seconds, webhook_url
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12, $13, $14, $15)
            "#,
            key_id,
            &key_hash_value,
            request.name,
            request.description,
            user_id,
            "api_key",
            request.scopes.as_slice(),
            expiration_date,
            request.rotation_enabled.unwrap_or(false),
            rotation_interval,
            next_rotation_date,
            request.max_uses,
            request.metadata
                .map(|m| serde_json::to_value(m).unwrap_or_default())
                .unwrap_or_default(),
            overlap_duration_seconds,
            request.webhook_url,
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        info!(key_id = %key_id, "New API key generated");

        Ok(GenerateApiKeyResponse {
            id: key_id,
            key,
            scopes: request.scopes,
            expiration_date,
            name: request.name,
        })
    }

    // ── Key Retrieval ────────────────────────────────────────────────────────

    /// Get API key by ID
    pub async fn get_key_by_id(&self, key_id: Uuid, user_id: Uuid) -> Result<ApiKey, ApiError> {
        let key = sqlx::query_as!(
            ApiKey,
            r#"
            SELECT 
                id,
                key,
                name,
                description,
                user_id,
                key_type,
                scopes,
                expiration_date,
                is_active,
                created_at,
                updated_at,
                last_used_at,
                revoked_at,
                revoked_by,
                rotation_enabled,
                rotation_interval,
                next_rotation_date,
                max_uses,
                use_count,
                metadata,
                overlap_duration_seconds,
                old_key_hash,
                old_key_expires_at,
                webhook_url
            FROM api_keys
            WHERE id = $1 AND user_id = $2
            "#,
            key_id,
            user_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(ApiError::database_error)?
        .ok_or_else(|| ApiError::not_found("API key not found"))?;

        Ok(key)
    }

    /// Get full API key details (incl. rotation deadline) for a user.
    pub async fn get_key_details(
        &self,
        key_id: Uuid,
        user_id: Uuid,
    ) -> Result<GetApiKeyResponse, ApiError> {
        let summary = self.get_key_summary_by_id(key_id, user_id).await?;
        Ok(GetApiKeyResponse::from_summary(summary))
    }

    /// Get API key summary by ID
    pub async fn get_key_summary_by_id(
        &self,
        key_id: Uuid,
        user_id: Uuid,
    ) -> Result<ApiKeySummary, ApiError> {
        let summary = sqlx::query_as!(
            ApiKeySummary,
            r#"
            SELECT 
                id,
                name,
                description,
                key_type,
                scopes,
                is_active,
                expiration_date,
                created_at,
                last_used_at,
                use_count,
                max_uses,
                rotation_enabled,
                next_rotation_date,
                old_key_expires_at,
                overlap_duration_seconds,
                webhook_url,
                key_preview,
                created_by_username,
                created_by_email,
                status
            FROM api_key_summaries
            WHERE id = $1 AND user_id = $2
            "#,
            key_id,
            user_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(ApiError::database_error)?
        .ok_or_else(|| ApiError::not_found("API key summary not found"))?;

        Ok(summary)
    }

    /// List all API keys for a user
    pub async fn list_keys(&self, user_id: Uuid) -> Result<Vec<ApiKeySummary>, ApiError> {
        let keys = sqlx::query_as!(
            ApiKeySummary,
            r#"
            SELECT 
                id,
                name,
                description,
                key_type,
                scopes,
                is_active,
                expiration_date,
                created_at,
                last_used_at,
                use_count,
                max_uses,
                rotation_enabled,
                next_rotation_date,
                old_key_expires_at,
                overlap_duration_seconds,
                webhook_url,
                key_preview,
                created_by_username,
                created_by_email,
                status
            FROM api_key_summaries
            WHERE user_id = $1
            ORDER BY created_at DESC
            "#,
            user_id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(keys)
    }

    /// Get API key by raw key string (for authentication)
    pub async fn get_key_by_key_string(
        &self,
        key_string: &str,
    ) -> Result<ApiKey, ApiError> {
        let key_hash_value = key_hash(key_string);

        let key = sqlx::query_as!(
            ApiKey,
            r#"
            SELECT 
                id,
                key,
                name,
                description,
                user_id,
                key_type,
                scopes,
                expiration_date,
                is_active,
                created_at,
                updated_at,
                last_used_at,
                revoked_at,
                revoked_by,
                rotation_enabled,
                rotation_interval,
                next_rotation_date,
                max_uses,
                use_count,
                metadata,
                overlap_duration_seconds,
                old_key_hash,
                old_key_expires_at,
                webhook_url
            FROM api_keys
            WHERE key = $1
            "#,
            &key_hash_value,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(ApiError::database_error)?
        .ok_or_else(|| ApiError::unauthorized("Invalid API key"))?;

        // Check if key is active
        if !key.is_active {
            return Err(ApiError::unauthorized("API key has been revoked"));
        }

        // Zero-downtime rotation overlap (Issue #1080): a key that was rotated
        // remains valid until `old_key_expires_at`. Both the old and the new
        // key are accepted during the overlap window; afterwards the old key
        // is rejected (and expired by the background job).
        if old_key_is_expired(key.old_key_expires_at, Utc::now()) {
            return Err(ApiError::unauthorized(
                "API key expired after rotation overlap period",
            ));
        }

        // Check expiration
        if let Some(expiration_date) = key.expiration_date {
            if expiration_date < Utc::now() {
                return Err(ApiError::unauthorized("API key has expired"));
            }
        }

        // Check max uses
        if let Some(max_uses) = key.max_uses {
            if key.use_count >= max_uses {
                return Err(ApiError::unauthorized("API key has reached maximum uses"));
            }
        }

        Ok(key)
    }

    // ── Key Updates ──────────────────────────────────────────────────────────

    /// Update an API key
    pub async fn update_key(
        &self,
        key_id: Uuid,
        user_id: Uuid,
        request: UpdateApiKeyRequest,
    ) -> Result<ApiKey, ApiError> {
        let existing_key = self.get_key_by_id(key_id, user_id).await?;

        let expiration_date = if let Some(date_str) = request.expiration_date {
            Some(
                chrono::DateTime::parse_from_rfc3339(&date_str)
                    .map(|dt| dt.with_timezone(&Utc))?
                    .into(),
            )
        } else {
            None
        };

        let rotation_interval = if let Some(interval_str) = request.rotation_interval {
            Some(Self::parse_duration_str(&interval_str)?)
        } else {
            existing_key.rotation_interval
        };

        let next_rotation_date = if request.rotation_enabled == Some(true) {
            Some(Utc::now() + Duration::seconds(rotation_interval.unwrap_or(7776000)))
        } else {
            existing_key.next_rotation_date
        };

        let updated_key = sqlx::query_as!(
            ApiKey,
            r#"
            UPDATE api_keys
            SET 
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                scopes = COALESCE($3, scopes),
                expiration_date = COALESCE($4, expiration_date),
                rotation_enabled = COALESCE($5, rotation_enabled),
                rotation_interval = COALESCE($6, rotation_interval),
                next_rotation_date = COALESCE($7, next_rotation_date),
                max_uses = COALESCE($8, max_uses),
                overlap_duration_seconds = COALESCE($9, overlap_duration_seconds),
                webhook_url = COALESCE($10, webhook_url),
                updated_at = NOW()
            WHERE id = $11 AND user_id = $12
            RETURNING *
            "#,
            request.name,
            request.description,
            request.scopes.as_deref(),
            expiration_date,
            request.rotation_enabled,
            rotation_interval,
            next_rotation_date,
            request.max_uses,
            request
                .overlap_duration_seconds
                .map(|v| v.clamp(0, MAX_API_KEY_OVERLAP_SECONDS)),
            request.webhook_url,
            key_id,
            user_id,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        info!(key_id = %key_id, "API key updated");

        Ok(updated_key)
    }

    // ── Key Revocation ───────────────────────────────────────────────────────

    /// Revoke an API key
    pub async fn revoke_key(
        &self,
        key_id: Uuid,
        user_id: Uuid,
        request: RevokeApiKeyRequest,
    ) -> Result<(), ApiError> {
        let existing_key = self.get_key_by_id(key_id, user_id).await?;

        if !existing_key.is_active {
            return Err(ApiError::bad_request("API key is already revoked"));
        }

        sqlx::query!(
            r#"
            UPDATE api_keys
            SET 
                is_active = false,
                revoked_at = NOW(),
                revoked_by = $1,
                updated_at = NOW()
            WHERE id = $2
            "#,
            user_id,
            key_id,
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        info!(
            key_id = %key_id,
            reason = %request.reason.unwrap_or("No reason provided"),
            "API key revoked"
        );

        Ok(())
    }

    // ── Key Rotation ─────────────────────────────────────────────────────────

    /// Rotate an API key with a zero-downtime overlap window (Issue #1080).
    ///
    /// Generates a new key, keeps the old key **valid** until
    /// `old_key_expires_at = now() + overlap_duration_seconds` (default 24h,
    /// max 7 days) and returns the deadline so integrators can migrate. Both
    /// the old and the new key authenticate during the overlap period.
    #[tracing::instrument(skip(self, request), fields(key_id = %key_id))]
    pub async fn rotate_key(
        &self,
        key_id: Uuid,
        user_id: Uuid,
        request: RotateApiKeyRequest,
    ) -> Result<RotateApiKeyResponse, ApiError> {
        let existing_key = self.get_key_by_id(key_id, user_id).await?;

        if !existing_key.is_active {
            return Err(ApiError::bad_request("Cannot rotate revoked API key"));
        }

        let overlap_duration_seconds =
            normalized_overlap(request.overlap_duration_seconds, existing_key.overlap_duration_seconds);

        // Generate new key
        let new_key = Self::generate_key();
        let new_key_hash_value = key_hash(&new_key);
        let old_key_hash_value = existing_key.key.clone();

        let now = Utc::now();
        let old_key_expires_at = now + Duration::seconds(overlap_duration_seconds);
        let next_rotation_date = if existing_key.rotation_enabled {
            Some(now + Duration::seconds(existing_key.rotation_interval.unwrap_or(7776000)))
        } else {
            None
        };

        // Instead of deactivating the old key immediately, mark it as the
        // "old" key so it stays valid until `old_key_expires_at`. New key
        // takes over as the primary key for the same properties.
        sqlx::query!(
            r#"
            UPDATE api_keys
            SET 
                old_key_hash = $1,
                old_key_expires_at = $2,
                overlap_duration_seconds = $3,
                updated_at = NOW()
            WHERE id = $4 AND user_id = $5
            "#,
            &old_key_hash_value,
            old_key_expires_at,
            overlap_duration_seconds,
            key_id,
            user_id,
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        // Create new key with same properties (fresh — no overlap markers).
        let new_key_id = Uuid::new_v4();
        sqlx::query!(
            r#"
            INSERT INTO api_keys (
                id, key, name, description, user_id, key_type, scopes,
                expiration_date, is_active, rotation_enabled, rotation_interval,
                next_rotation_date, max_uses, use_count, metadata, created_at,
                overlap_duration_seconds, old_key_hash, old_key_expires_at, webhook_url
            )
            SELECT 
                $1, $2, name, description, user_id, key_type, scopes,
                expiration_date, true, rotation_enabled, rotation_interval,
                $3, max_uses, 0, metadata, NOW(),
                $4, NULL, NULL, webhook_url
            FROM api_keys
            WHERE id = $5
            "#,
            new_key_id,
            &new_key_hash_value,
            next_rotation_date,
            overlap_duration_seconds,
            key_id,
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        // Record rotation history
        sqlx::query!(
            r#"
            INSERT INTO api_key_rotation_history (
                api_key_id, old_key_hash, new_key_hash, rotated_by, reason
            )
            VALUES ($1, $2, $3, $4, $5)
            "#,
            key_id,
            &old_key_hash_value,
            &new_key_hash_value,
            user_id,
            request.reason,
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        // Notify the key owner's registered callback URL that rotation was
        // initiated (best-effort; webhook failures are logged, not fatal).
        if let Some(ref callback) = existing_key.webhook_url {
            Self::notify_webhook(
                callback,
                "api_key.rotation_initiated",
                serde_json::json!({
                    "key_id": key_id,
                    "new_key_id": new_key_id,
                    "old_key_expires_at": old_key_expires_at.to_rfc3339(),
                    "rotated_at": now.to_rfc3339(),
                }),
            )
            .await;
        }

        info!(key_id = %key_id, new_key_id = %new_key_id, overlap_duration_seconds, "API key rotated");

        Ok(RotateApiKeyResponse {
            old_key_id: key_id,
            new_key_id,
            new_key,
            rotated_at: now,
            old_key_expires_at,
            overlap_duration_seconds,
        })
    }

    /// Background job: expire any old (rotated) key whose overlap window has
    /// elapsed. Notifies the registered callback URL before deactivating.
    pub async fn expire_expired_old_keys(&self) -> Result<u64, ApiError> {
        let due = sqlx::query!(
            r#"
            SELECT id, webhook_url
            FROM api_keys
            WHERE old_key_expires_at IS NOT NULL
              AND old_key_expires_at <= NOW()
              AND is_active = true
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        for row in &due {
            if let Some(ref callback) = row.webhook_url {
                Self::notify_webhook(
                    callback,
                    "api_key.old_key_expired",
                    serde_json::json!({
                        "key_id": row.id,
                    }),
                )
                .await;
            }
        }

        let expired = sqlx::query!(
            r#"
            UPDATE api_keys
            SET is_active = false, revoked_at = NOW(), updated_at = NOW()
            WHERE old_key_expires_at IS NOT NULL
              AND old_key_expires_at <= NOW()
              AND is_active = true
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        for row in &due {
            warn!(key_id = %row.id, "Expired old API key after rotation overlap");
        }

        Ok(expired.rows_affected())
    }

    /// Deliver a rotation webhook to the key owner's registered callback URL.
    ///
    /// Fire-and-forget: failures are logged but never fail the calling
    /// operation, since rotation must succeed regardless.
    async fn notify_webhook(callback_url: &str, event: &str, payload: serde_json::Value) {
        let url = callback_url.trim().to_string();
        if url.is_empty() {
            return;
        }
        let body = serde_json::json!({
            "event": event,
            "payload": payload,
            "sent_at": Utc::now().to_rfc3339(),
        });

        let client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                warn!(error = %e, "Failed to build webhook client");
                return;
            }
        };

        match client.post(&url).json(&body).send().await {
            Ok(resp) => {
                info!(url = %url, event, status = %resp.status(), "API key webhook delivered");
            }
            Err(e) => {
                warn!(url = %url, event, error = %e, "API key webhook delivery failed");
            }
        }
    }

    // ── Usage Tracking ───────────────────────────────────────────────────────

    /// Record API key usage
    #[tracing::instrument(skip(self, usage))]
    pub async fn record_usage(&self, usage: ApiKeyUsageLog) -> Result<(), ApiError> {
        // Record the usage log
        sqlx::query!(
            r#"
            INSERT INTO api_key_usage_logs (
                api_key_id, endpoint, method, client_ip, user_agent,
                response_status, request_duration_ms, scopes_used
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
            usage.api_key_id,
            usage.endpoint,
            usage.method,
            usage.client_ip,
            usage.user_agent,
            usage.response_status,
            usage.request_duration_ms,
            usage.scopes_used.as_slice(),
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        // Increment use count
        sqlx::query!(
            r#"
            UPDATE api_keys
            SET 
                use_count = use_count + 1,
                last_used_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            "#,
            usage.api_key_id,
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(())
    }

    /// Get usage logs for an API key
    pub async fn get_usage_logs(
        &self,
        key_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ApiKeyUsageLog>, ApiError> {
        let logs = sqlx::query_as!(
            ApiKeyUsageLog,
            r#"
            SELECT 
                id,
                api_key_id,
                endpoint,
                method,
                client_ip,
                user_agent,
                response_status,
                request_duration_ms,
                scopes_used,
                created_at
            FROM api_key_usage_logs
            WHERE api_key_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
            key_id,
            limit,
            offset,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(logs)
    }

    /// Get API key statistics
    pub async fn get_stats(&self) -> Result<ApiKeyStats, ApiError> {
        let stats = sqlx::query_as!(
            ApiKeyStats,
            r#"
            SELECT 
                COUNT(*) AS total_keys,
                COUNT(*) FILTER (WHERE is_active AND 
                    (expiration_date IS NULL OR expiration_date > NOW()) AND
                    (max_uses IS NULL OR use_count < max_uses)) AS active_keys,
                COUNT(*) FILTER (WHERE expiration_date IS NOT NULL AND expiration_date < NOW()) AS expired_keys,
                COUNT(*) FILTER (WHERE is_active = false) AS revoked_keys,
                COUNT(*) FILTER (WHERE rotation_enabled AND 
                    next_rotation_date IS NOT NULL AND 
                    next_rotation_date < NOW()) AS keys_needing_rotation,
                COALESCE(SUM(use_count), 0) AS total_uses,
                COUNT(*) FILTER (WHERE max_uses IS NOT NULL) AS keys_with_max_uses
            FROM api_keys
            "#,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(stats)
    }

    // ── Helper Functions ─────────────────────────────────────────────────────

    /// Parse duration string (e.g., "30d", "90d", "180d")
    fn parse_duration_str(duration_str: &str) -> Result<i64, ApiError> {
        let duration_str = duration_str.trim().to_lowercase();

        if duration_str.ends_with('d') {
            let days = duration_str
                .trim_end_matches('d')
                .parse::<i64>()
                .map_err(|_| ApiError::bad_request("Invalid duration format"))?;
            Ok(days * 86400)
        } else if duration_str.ends_with('h') {
            let hours = duration_str
                .trim_end_matches('h')
                .parse::<i64>()
                .map_err(|_| ApiError::bad_request("Invalid duration format"))?;
            Ok(hours * 3600)
        } else if duration_str.ends_with('m') {
            let minutes = duration_str
                .trim_end_matches('m')
                .parse::<i64>()
                .map_err(|_| ApiError::bad_request("Invalid duration format"))?;
            Ok(minutes * 60)
        } else {
            Err(ApiError::bad_request(
                "Duration must end with 'd', 'h', or 'm'",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Issue #1080: an old key must stay accepted while the overlap window is
    /// still open, and only be rejected once `old_key_expires_at` passes.
    #[test]
    fn old_key_accepted_during_overlap_and_rejected_after() {
        let now = Utc::now();
        let overlap = DEFAULT_API_KEY_OVERLAP_SECONDS;
        let old_key_expires_at = Some(now + Duration::seconds(overlap));

        // During the overlap window both old and new key are valid.
        assert!(!old_key_is_expired(old_key_expires_at, now), "old key must stay valid inside the overlap window");
        assert!(!old_key_is_expired(None, now), "new key is never expired by the overlap rule");

        // Advance time past `old_key_expires_at` → old key is rejected.
        let later = now + Duration::seconds(overlap + 1);
        assert!(old_key_is_expired(old_key_expires_at, later), "old key must be rejected after the overlap window");
    }

    /// Issue #1080: overlap duration defaults to 24h and is clamped to
    /// [0, 7 days] regardless of the requested value.
    #[test]
    fn overlap_duration_defaults_and_clamps() {
        assert_eq!(normalized_overlap(None, DEFAULT_API_KEY_OVERLAP_SECONDS), 86400);

        let max = normalized_overlap(Some(999999999), DEFAULT_API_KEY_OVERLAP_SECONDS);
        assert_eq!(max, MAX_API_KEY_OVERLAP_SECONDS, "overlap must be capped at 7 days");

        let min = normalized_overlap(Some(-5), DEFAULT_API_KEY_OVERLAP_SECONDS);
        assert_eq!(min, 0, "overlap must never be negative");
    }
}