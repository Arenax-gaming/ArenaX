use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Wallet {
    pub id: Uuid,
    pub user_id: Uuid,
    pub balance: Decimal,
    pub escrow_balance: Decimal,
    pub currency: String,
    // Stellar integration fields
    pub balance_ngn: Option<i64>, // in kobo
    pub balance_arenax_tokens: Option<i64>,
    pub balance_xlm: Option<i64>, // in stroops
    pub stellar_account_id: Option<String>,
    pub stellar_public_key: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Transaction {
    pub id: Uuid,
    pub user_id: Uuid,
    pub transaction_type: TransactionType,
    pub amount: Decimal,
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(i32)]
pub enum TransactionType {
    Deposit = 0,
    Withdrawal = 1,
    Payment = 2,
    Refund = 3,
    Prize = 4,
    EntryFee = 5,
    Fee = 6,
}

impl std::fmt::Display for TransactionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TransactionType::Deposit => write!(f, "deposit"),
            TransactionType::Withdrawal => write!(f, "withdrawal"),
            TransactionType::Payment => write!(f, "payment"),
            TransactionType::Refund => write!(f, "refund"),
            TransactionType::Prize => write!(f, "prize"),
            TransactionType::EntryFee => write!(f, "entry_fee"),
            TransactionType::Fee => write!(f, "fee"),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(i32)]
pub enum TransactionStatus {
    Pending = 0,
    Processing = 1,
    Completed = 2,
    Failed = 3,
    Cancelled = 4,
    Refunded = 5,
}

impl std::fmt::Display for TransactionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TransactionStatus::Pending => write!(f, "pending"),
            TransactionStatus::Processing => write!(f, "processing"),
            TransactionStatus::Completed => write!(f, "completed"),
            TransactionStatus::Failed => write!(f, "failed"),
            TransactionStatus::Cancelled => write!(f, "cancelled"),
            TransactionStatus::Refunded => write!(f, "refunded"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PaymentProvider {
    Paystack,
    Flutterwave,
    Stellar,
    ArenaXToken,
}

impl std::fmt::Display for PaymentProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PaymentProvider::Paystack => write!(f, "paystack"),
            PaymentProvider::Flutterwave => write!(f, "flutterwave"),
            PaymentProvider::Stellar => write!(f, "stellar"),
            PaymentProvider::ArenaXToken => write!(f, "arenax_token"),
        }
    }
}

// DTOs for API requests/responses
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateWalletRequest {
    pub user_id: Uuid,
    #[validate(length(min = 3, max = 10))]
    pub currency: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct UpdateWalletRequest {
    pub balance: Option<Decimal>,
    pub escrow_balance: Option<Decimal>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub balance: Decimal,
    pub escrow_balance: Decimal,
    pub currency: String,
    pub balance_ngn: Option<i64>,
    pub balance_arenax_tokens: Option<i64>,
    pub balance_xlm: Option<i64>,
    pub stellar_public_key: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Wallet> for WalletResponse {
    fn from(wallet: Wallet) -> Self {
        Self {
            id: wallet.id,
            user_id: wallet.user_id,
            balance: wallet.balance,
            escrow_balance: wallet.escrow_balance,
            currency: wallet.currency,
            balance_ngn: wallet.balance_ngn,
            balance_arenax_tokens: wallet.balance_arenax_tokens,
            balance_xlm: wallet.balance_xlm,
            stellar_public_key: wallet.stellar_public_key,
            is_active: wallet.is_active,
            created_at: wallet.created_at,
            updated_at: wallet.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletBalance {
    pub currency: String,
    pub balance: Decimal,
    pub escrow_balance: Decimal,
    pub total_balance: Decimal,
}

impl From<Wallet> for WalletBalance {
    fn from(wallet: Wallet) -> Self {
        Self {
            currency: wallet.currency,
            balance: wallet.balance,
            escrow_balance: wallet.escrow_balance,
            total_balance: wallet.balance + wallet.escrow_balance,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransactionResponse {
    pub id: Uuid,
    pub transaction_type: TransactionType,
    pub amount: Decimal,
    pub currency: String,
    pub status: TransactionStatus,
    pub reference: String,
    pub description: String,
    pub stellar_transaction_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct DepositRequest {
    #[validate(range(min = 1))]
    pub amount: Decimal,
    #[validate(length(min = 3, max = 10))]
    pub currency: String, // "NGN", "XLM", "ARENAX_TOKEN"
    pub payment_method: String, // "paystack", "flutterwave", "stellar"
}

#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct WithdrawalRequest {
    #[validate(range(min = 1))]
    pub amount: Decimal,
    #[validate(length(min = 3, max = 10))]
    pub currency: String,
    #[validate(length(min = 1, max = 255))]
    pub destination: String, // Bank account, Stellar address, etc.
    pub payment_method: String,
}