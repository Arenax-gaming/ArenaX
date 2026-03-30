use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct IdempotencyKey {
    pub id: Uuid,
    pub key: String,
    pub request_hash: String,
    pub response_status: i16,
    pub response_headers: Option<serde_json::Value>,
    pub response_body: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct IdempotencyConfig {
    pub id: Uuid,
    pub route_pattern: String,
    pub enabled: bool,
    pub ttl_seconds: i32,
    pub max_response_size_kb: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdempotencyResponse {
    pub status: i16,
    pub headers: Option<serde_json::Value>,
    pub body: Option<serde_json::Value>,
    pub is_cached: bool,
    pub cached_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdempotencyConflict {
    pub key: String,
    pub original_hash: String,
    pub new_hash: String,
    pub original_timestamp: DateTime<Utc>,
    pub conflict_type: ConflictType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictType {
    PayloadMismatch,
    MethodMismatch,
    RouteMismatch,
    UserMismatch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdempotencyPolicy {
    pub enabled_routes: Vec<String>,
    pub default_ttl_seconds: i32,
    pub max_response_size_kb: i32,
    pub key_header_name: String,
    pub conflict_status_code: i16,
}

impl Default for IdempotencyPolicy {
    fn default() -> Self {
        Self {
            enabled_routes: vec![
                "/api/payments/create".to_string(),
                "/api/payments/refund".to_string(),
                "/api/wallets/deposit".to_string(),
                "/api/wallets/withdraw".to_string(),
                "/api/tournaments/join".to_string(),
                "/api/matchmaking/join".to_string(),
            ],
            default_ttl_seconds: 86400, // 24 hours
            max_response_size_kb: 1024, // 1MB
            key_header_name: "Idempotency-Key".to_string(),
            conflict_status_code: 409,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedResponse {
    pub status: i16,
    pub headers: serde_json::Value,
    pub body: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

impl CachedResponse {
    pub fn new(status: i16, headers: serde_json::Value, body: serde_json::Value) -> Self {
        Self {
            status,
            headers,
            body,
            created_at: Utc::now(),
        }
    }

    pub fn size_kb(&self) -> i32 {
        let serialized = serde_json::to_string(&self).unwrap_or_default();
        (serialized.len() / 1024) as i32
    }
}
