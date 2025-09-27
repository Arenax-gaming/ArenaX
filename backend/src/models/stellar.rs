use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct StellarAccount {
    pub id: Uuid,
    pub user_id: Uuid,
    pub account_id: String,
    pub public_key: String,
    pub secret_key_encrypted: String, // Encrypted secret key
    pub is_funded: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct StellarTransaction {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub transaction_hash: String,
    pub operation_type: StellarOperationType,
    pub amount: i64,
    pub asset_code: String,
    pub asset_issuer: Option<String>,
    pub from_account: String,
    pub to_account: String,
    pub status: StellarTransactionStatus,
    pub fee: i64,
    pub memo: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CustomAsset {
    pub id: Uuid,
    pub asset_code: String,
    pub asset_issuer: String,
    pub asset_type: AssetType,
    pub total_supply: i64,
    pub circulating_supply: i64,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AssetBalance {
    pub id: Uuid,
    pub user_id: Uuid,
    pub asset_code: String,
    pub asset_issuer: String,
    pub balance: i64,
    pub last_updated: DateTime<Utc>,
}

// Enums
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "stellar_operation_type", rename_all = "lowercase")]
pub enum StellarOperationType {
    Payment,
    CreateAccount,
    ChangeTrust,
    ManageData,
    SetOptions,
    PathPayment,
    CreatePassiveOffer,
    ManageOffer,
    AccountMerge,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "stellar_transaction_status", rename_all = "lowercase")]
pub enum StellarTransactionStatus {
    Pending,
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "asset_type", rename_all = "lowercase")]
pub enum AssetType {
    Native, // XLM
    ArenaXToken,
    ReputationToken,
    Custom,
}

// DTOs for API requests/responses
#[derive(Debug, Serialize, Deserialize)]
pub struct StellarAccountResponse {
    pub account_id: String,
    pub public_key: String,
    pub is_funded: bool,
    pub balances: Vec<AssetBalanceResponse>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AssetBalanceResponse {
    pub asset_code: String,
    pub asset_issuer: Option<String>,
    pub balance: i64,
    pub last_updated: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StellarTransactionResponse {
    pub id: Uuid,
    pub transaction_hash: String,
    pub operation_type: StellarOperationType,
    pub amount: i64,
    pub asset_code: String,
    pub from_account: String,
    pub to_account: String,
    pub status: StellarTransactionStatus,
    pub created_at: DateTime<Utc>,
}
