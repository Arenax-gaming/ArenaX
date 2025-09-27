use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Wallet {
    pub id: Uuid,
    pub user_id: Uuid,
    pub balance_ngn: i64, // in kobo
    pub balance_arenax_tokens: i64,
    pub balance_xlm: i64, // in stroops (1 XLM = 10,000,000 stroops)
    pub stellar_account_id: String,
    pub stellar_public_key: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Transaction {
    pub id: Uuid,
    pub user_id: Uuid,
    pub transaction_type: TransactionType,
    pub amount: i64,
    pub currency: String,
    pub status: TransactionStatus,
    pub reference: String, // External payment reference
    pub description: String,
    pub metadata: Option<String>, // JSON object
    pub stellar_transaction_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PaymentMethod {
    pub id: Uuid,
    pub user_id: Uuid,
    pub provider: PaymentProvider,
    pub provider_account_id: String,
    pub is_default: bool,
    pub is_verified: bool,
    pub metadata: Option<String>, // JSON object
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// Enums
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "transaction_type", rename_all = "lowercase")]
pub enum TransactionType {
    Deposit,
    Withdrawal,
    Payment,
    Refund,
    Prize,
    EntryFee,
    Fee,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "transaction_status", rename_all = "lowercase")]
pub enum TransactionStatus {
    Pending,
    Processing,
    Completed,
    Failed,
    Cancelled,
    Refunded,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "payment_provider", rename_all = "lowercase")]
pub enum PaymentProvider {
    Paystack,
    Flutterwave,
    Stellar,
    ArenaXToken,
}

// DTOs for API requests/responses
#[derive(Debug, Serialize, Deserialize)]
pub struct WalletResponse {
    pub id: Uuid,
    pub balance_ngn: i64,
    pub balance_arenax_tokens: i64,
    pub balance_xlm: i64,
    pub stellar_public_key: String,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransactionResponse {
    pub id: Uuid,
    pub transaction_type: TransactionType,
    pub amount: i64,
    pub currency: String,
    pub status: TransactionStatus,
    pub reference: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DepositRequest {
    pub amount: i64,
    pub currency: String, // "NGN" or "XLM"
    pub payment_method: String, // "paystack", "flutterwave", "stellar"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WithdrawalRequest {
    pub amount: i64,
    pub currency: String,
    pub destination: String, // Bank account, Stellar address, etc.
    pub payment_method: String,
}
