use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::idempotency::*;
use chrono::Utc;
use sqlx;
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
