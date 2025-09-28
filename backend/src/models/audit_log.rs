use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::net::IpAddr;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuditLog {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<Uuid>,
    pub old_values: Option<serde_json::Value>,
    pub new_values: Option<serde_json::Value>,
    pub ip_address: Option<sqlx::types::ipnetwork::IpNetwork>,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAuditLogRequest {
    pub user_id: Option<Uuid>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<Uuid>,
    pub old_values: Option<serde_json::Value>,
    pub new_values: Option<serde_json::Value>,
    pub ip_address: Option<IpAddr>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogResponse {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<Uuid>,
    pub old_values: Option<serde_json::Value>,
    pub new_values: Option<serde_json::Value>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<AuditLog> for AuditLogResponse {
    fn from(log: AuditLog) -> Self {
        Self {
            id: log.id,
            user_id: log.user_id,
            action: log.action,
            resource_type: log.resource_type,
            resource_id: log.resource_id,
            old_values: log.old_values,
            new_values: log.new_values,
            ip_address: log.ip_address.map(|ip| ip.to_string()),
            user_agent: log.user_agent,
            created_at: log.created_at,
        }
    }
}

// Common audit actions
pub struct AuditAction;

impl AuditAction {
    pub const CREATE: &'static str = "CREATE";
    pub const UPDATE: &'static str = "UPDATE";
    pub const DELETE: &'static str = "DELETE";
    pub const LOGIN: &'static str = "LOGIN";
    pub const LOGOUT: &'static str = "LOGOUT";
    pub const TOURNAMENT_JOIN: &'static str = "TOURNAMENT_JOIN";
    pub const TOURNAMENT_LEAVE: &'static str = "TOURNAMENT_LEAVE";
    pub const MATCH_SUBMIT_RESULT: &'static str = "MATCH_SUBMIT_RESULT";
    pub const TRANSACTION_CREATE: &'static str = "TRANSACTION_CREATE";
    pub const TRANSACTION_CONFIRM: &'static str = "TRANSACTION_CONFIRM";
    pub const WALLET_BALANCE_UPDATE: &'static str = "WALLET_BALANCE_UPDATE";
}

// Common resource types
pub struct ResourceType;

impl ResourceType {
    pub const USER: &'static str = "USER";
    pub const TOURNAMENT: &'static str = "TOURNAMENT";
    pub const MATCH: &'static str = "MATCH";
    pub const WALLET: &'static str = "WALLET";
    pub const STELLAR_TRANSACTION: &'static str = "STELLAR_TRANSACTION";
    pub const STELLAR_ACCOUNT: &'static str = "STELLAR_ACCOUNT";
    pub const LEADERBOARD: &'static str = "LEADERBOARD";
}
