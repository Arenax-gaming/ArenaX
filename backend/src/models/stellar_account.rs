use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct StellarAccount {
    pub id: Uuid,
    pub user_id: Uuid,
    pub public_key: String,
    pub secret_key_encrypted: String,
    pub account_type: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StellarAccountType {
    User,
    Admin,
    Escrow,
}

impl std::fmt::Display for StellarAccountType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StellarAccountType::User => write!(f, "user"),
            StellarAccountType::Admin => write!(f, "admin"),
            StellarAccountType::Escrow => write!(f, "escrow"),
        }
    }
}

impl From<String> for StellarAccountType {
    fn from(s: String) -> Self {
        match s.as_str() {
            "admin" => StellarAccountType::Admin,
            "escrow" => StellarAccountType::Escrow,
            _ => StellarAccountType::User,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateStellarAccountRequest {
    pub user_id: Uuid,
    #[validate(length(equal = 56))]
    pub public_key: String,
    pub secret_key_encrypted: String,
    pub account_type: Option<StellarAccountType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StellarAccountResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub public_key: String,
    pub account_type: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

impl From<StellarAccount> for StellarAccountResponse {
    fn from(account: StellarAccount) -> Self {
        Self {
            id: account.id,
            user_id: account.user_id,
            public_key: account.public_key,
            account_type: account.account_type,
            is_active: account.is_active,
            created_at: account.created_at,
        }
    }
}
