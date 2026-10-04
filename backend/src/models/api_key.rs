use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// API Key types
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "lowercase")]
pub enum KeyType {
    #[serde(rename = "api_key")]
    ApiKey,
    #[serde(rename = "service_key")]
    ServiceKey,
    #[serde(rename = "partner_key")]
    PartnerKey,
}

impl Default for KeyType {
    fn default() -> Self {
        KeyType::ApiKey
    }
}

/// API Key status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyStatus {
    Active,
    Revoked,
    Expired,
    MaxUsesExceeded,
    RotationDue,
}

/// API Key model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ApiKey {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub user_id: Uuid,
    pub key_type: KeyType,
    pub scopes: Vec<String>,
    pub expiration_date: Option<DateTime<Utc>>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub revoked_by: Option<Uuid>,
    pub rotation_enabled: bool,
    pub rotation_interval: Option<i64>,
    pub next_rotation_date: Option<DateTime<Utc>>,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    pub metadata: serde_json::Value,
    /// Overlap window (seconds) during which both old and new key are
    /// accepted after rotation. Default 24h, max 7 days (Issue #1080).
    pub overlap_duration_seconds: i64,
    /// Hash of the key this row replaced; set when this row is the "old" key
    /// in a zero-downtime rotation.
    pub old_key_hash: Option<String>,
    /// Deadline until which this (old) key remains valid after rotation.
    /// Before this instant the key is accepted; afterwards it is expired by
    /// the background job and rejected.
    pub old_key_expires_at: Option<DateTime<Utc>>,
    /// Registered callback URL notified on rotation events.
    pub webhook_url: Option<String>,
}

/// API Key summary (view model)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ApiKeySummary {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub key_type: String,
    pub scopes: Vec<String>,
    pub is_active: bool,
    pub expiration_date: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub use_count: i32,
    pub max_uses: Option<i32>,
    pub rotation_enabled: bool,
    pub next_rotation_date: Option<DateTime<Utc>>,
    pub old_key_expires_at: Option<DateTime<Utc>>,
    pub overlap_duration_seconds: Option<i64>,
    pub webhook_url: Option<String>,
    pub key_preview: Option<String>,
    pub created_by_username: Option<String>,
    pub created_by_email: Option<String>,
    pub status: KeyStatus,
}

/// API Key usage log
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ApiKeyUsageLog {
    pub id: Uuid,
    pub api_key_id: Uuid,
    pub endpoint: String,
    pub method: String,
    pub client_ip: Option<String>,
    pub user_agent: Option<String>,
    pub response_status: Option<i32>,
    pub request_duration_ms: Option<i32>,
    pub scopes_used: Vec<String>,
    pub created_at: DateTime<Utc>,
}

/// API Key rotation history entry
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ApiKeyRotationHistory {
    pub id: Uuid,
    pub api_key_id: Uuid,
    pub old_key_hash: String,
    pub new_key_hash: String,
    pub rotated_by: Option<Uuid>,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ── Request/Response DTOs ─────────────────────────────────────────────────────

/// Create API Key request
#[derive(Debug, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    pub description: Option<String>,
    pub scopes: Vec<String>,
    pub expiration_date: Option<String>,
    pub rotation_enabled: Option<bool>,
    pub rotation_interval: Option<String>,
    pub max_uses: Option<i32>,
    pub metadata: Option<serde_json::Value>,
    /// Overlap window in seconds for zero-downtime rotation
    /// (default 24h = 86400, max 7 days = 604800).
    #[serde(default)]
    pub overlap_duration_seconds: Option<i64>,
    /// Registered callback URL to be notified of rotation events.
    pub webhook_url: Option<String>,
}

/// Create API Key response
#[derive(Debug, Serialize)]
pub struct CreateApiKeyResponse {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub scopes: Vec<String>,
    pub expiration_date: Option<DateTime<Utc>>,
}

/// List API Keys response
#[derive(Debug, Serialize)]
pub struct ListApiKeysResponse {
    pub api_keys: Vec<ApiKeySummary>,
    pub total: usize,
}

/// Update API Key request
#[derive(Debug, Deserialize)]
pub struct UpdateApiKeyRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub scopes: Option<Vec<String>>,
    pub expiration_date: Option<String>,
    pub rotation_enabled: Option<bool>,
    pub rotation_interval: Option<String>,
    pub max_uses: Option<i32>,
    pub metadata: Option<serde_json::Value>,
    /// Overlap window in seconds for zero-downtime rotation.
    #[serde(default)]
    pub overlap_duration_seconds: Option<i64>,
    /// Registered callback URL to be notified of rotation events.
    pub webhook_url: Option<String>,
}

/// Revoke API Key request
#[derive(Debug, Deserialize)]
pub struct RevokeApiKeyRequest {
    pub reason: Option<String>,
}

/// Rotate API Key request
#[derive(Debug, Deserialize)]
pub struct RotateApiKeyRequest {
    pub reason: Option<String>,
    /// Overlap window in seconds during which both old and new key remain
    /// valid (default 24h = 86400, max 7 days = 604800).
    #[serde(default)]
    pub overlap_duration_seconds: Option<i64>,
}

/// API Key usage statistics
#[derive(Debug, Serialize)]
pub struct ApiKeyStats {
    pub total_keys: i64,
    pub active_keys: i64,
    pub expired_keys: i64,
    pub revoked_keys: i64,
    pub keys_needing_rotation: i64,
    pub total_uses: i64,
    pub keys_with_max_uses: i64,
}

/// Rotate API Key response
#[derive(Debug, Serialize)]
pub struct RotateApiKeyResponse {
    pub old_key_id: Uuid,
    pub new_key_id: Uuid,
    pub new_key: String,
    pub rotated_at: DateTime<Utc>,
    /// Deadline until which the old key remains valid (both keys accepted
    /// during the overlap window).
    pub old_key_expires_at: DateTime<Utc>,
    pub overlap_duration_seconds: i64,
}

/// Details returned by `GET /api/api-keys/:id` so integrators can see the
/// rotation deadline (`old_key_expires_at`) and a preview of the key.
#[derive(Debug, Serialize)]
pub struct GetApiKeyResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub key_preview: String,
    pub status: KeyStatus,
    pub is_active: bool,
    pub scopes: Vec<String>,
    pub expiration_date: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub use_count: i32,
    pub max_uses: Option<i32>,
    pub rotation_enabled: bool,
    pub next_rotation_date: Option<DateTime<Utc>>,
    pub overlap_duration_seconds: i64,
    pub old_key_expires_at: Option<DateTime<Utc>>,
    pub webhook_url: Option<String>,
}

impl GetApiKeyResponse {
    /// Build from a summary row; falls back to an empty preview when the view
    /// did not expose one.
    pub fn from_summary(summary: ApiKeySummary) -> Self {
        Self {
            key_preview: summary.key_preview.clone().unwrap_or_else(|| "••••••••".to_string()),
            id: summary.id,
            name: summary.name,
            description: summary.description,
            status: summary.status,
            is_active: summary.is_active,
            scopes: summary.scopes,
            expiration_date: summary.expiration_date,
            created_at: summary.created_at,
            last_used_at: summary.last_used_at,
            use_count: summary.use_count,
            max_uses: summary.max_uses,
            rotation_enabled: summary.rotation_enabled,
            next_rotation_date: summary.next_rotation_date,
            overlap_duration_seconds: summary.overlap_duration_seconds.unwrap_or(86400),
            old_key_expires_at: summary.old_key_expires_at,
            webhook_url: summary.webhook_url,
        }
    }
}

/// Generate new API key request
#[derive(Debug, Deserialize)]
pub struct GenerateApiKeyRequest {
    pub name: String,
    pub description: Option<String>,
    pub scopes: Vec<String>,
    pub expiration_date: Option<String>,
    pub rotation_enabled: Option<bool>,
    pub rotation_interval: Option<String>,
    pub max_uses: Option<i32>,
    pub metadata: Option<serde_json::Value>,
}

/// Generate API key response
#[derive(Debug, Serialize)]
pub struct GenerateApiKeyResponse {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub scopes: Vec<String>,
    pub expiration_date: Option<DateTime<Utc>>,
}