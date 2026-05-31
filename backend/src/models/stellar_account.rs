use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

/// Database row for a Stellar account.
///
/// `encrypted_secret_key` is intentionally excluded from `Serialize` and
/// `Debug` output so it can never leak into API responses, logs, or traces.
#[derive(Clone, Deserialize, FromRow)]
pub struct StellarAccount {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub public_key: String,
    /// Opaque versioned ciphertext — never serialised or printed.
    /// Decrypt only via `key_encryption::decrypt_secret_key`.
    #[serde(skip)]
    pub encrypted_secret_key: Option<String>,
    pub account_type: String,
    pub is_funded: bool,
    pub is_active: bool,
    pub balance_xlm: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Manual `Debug` impl that redacts the encrypted secret key.
impl std::fmt::Debug for StellarAccount {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StellarAccount")
            .field("id", &self.id)
            .field("user_id", &self.user_id)
            .field("public_key", &self.public_key)
            .field("encrypted_secret_key", &"[REDACTED]")
            .field("account_type", &self.account_type)
            .field("is_funded", &self.is_funded)
            .field("is_active", &self.is_active)
            .field("balance_xlm", &self.balance_xlm)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
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

/// Request to create a Stellar account.
/// `secret_key_encrypted` accepts the caller-supplied ciphertext; the raw
/// secret key must never be passed through this struct.
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateStellarAccountRequest {
    pub user_id: Uuid,
    #[validate(length(equal = 56))]
    pub public_key: String,
    pub secret_key_encrypted: String,
    pub account_type: Option<StellarAccountType>,
}

/// Public-facing API response — contains no secret material.
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
            user_id: account.user_id.unwrap_or_default(),
            public_key: account.public_key,
            account_type: account.account_type,
            is_active: account.is_active,
            created_at: account.created_at,
        }
    }
}
