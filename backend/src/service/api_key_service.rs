use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::api_key::{
    ApiKey, ApiKeyRotationHistory, ApiKeySummary, ApiKeyUsageLog, CreateApiKeyRequest,
    CreateApiKeyResponse, GenerateApiKeyRequest, GenerateApiKeyResponse, KeyStatus,
    RevokeApiKeyRequest, RotateApiKeyRequest, RotateApiKeyResponse, UpdateApiKeyRequest,
};
use chrono::{Duration, Utc};
use sha2::{Digest, Sha256};
use std::env;
use tracing::{info, warn};
use uuid::Uuid;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

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

        let key_id = Uuid::new_v4();

        // Insert the API key
        sqlx::query!(
            r#"
            INSERT INTO api_keys (
                id, key, name, description, user_id, key_type, scopes,
                expiration_date, is_active, rotation_enabled, rotation_interval,
                next_rotation_date, max_uses, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12, $13)
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

        let key_id = Uuid::new_v4();

        sqlx::query!(
            r#"
            INSERT INTO api_keys (
                id, key, name, description, user_id, key_type, scopes,
                expiration_date, is_active, rotation_enabled, rotation_interval,
                next_rotation_date, max_uses, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12, $13)
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
                metadata
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
                metadata
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
                updated_at = NOW()
            WHERE id = $9 AND user_id = $10
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

    /// Rotate an API key
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

        // Generate new key
        let new_key = Self::generate_key();
        let new_key_hash_value = key_hash(&new_key);
        let old_key_hash_value = existing_key.key.clone();

        let now = Utc::now();
        let next_rotation_date = if existing_key.rotation_enabled {
            Some(now + Duration::seconds(existing_key.rotation_interval.unwrap_or(7776000)))
        } else {
            None
        };

        // Update existing key to inactive (old key no longer valid)
        sqlx::query!(
            r#"
            UPDATE api_keys
            SET 
                is_active = false,
                updated_at = NOW()
            WHERE id = $1
            "#,
            key_id,
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        // Create new key with same properties
        let new_key_id = Uuid::new_v4();
        sqlx::query!(
            r#"
            INSERT INTO api_keys (
                id, key, name, description, user_id, key_type, scopes,
                expiration_date, is_active, rotation_enabled, rotation_interval,
                next_rotation_date, max_uses, use_count, metadata, created_at
            )
            SELECT 
                $1, $2, name, description, user_id, key_type, scopes,
                expiration_date, true, rotation_enabled, rotation_interval,
                $3, max_uses, 0, metadata, NOW()
            FROM api_keys
            WHERE id = $4
            "#,
            new_key_id,
            &new_key_hash_value,
            next_rotation_date,
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

        info!(key_id = %key_id, new_key_id = %new_key_id, "API key rotated");

        Ok(RotateApiKeyResponse {
            old_key_id: key_id,
            new_key_id,
            new_key,
            rotated_at: now,
        })
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