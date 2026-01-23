use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct StellarTransaction {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub transaction_hash: String,
    pub source_account: String,
    pub destination_account: String,
    pub amount: i64, // in stroops
    pub asset_code: String,
    pub asset_issuer: Option<String>,
    pub operation_type: String,
    pub memo: Option<String>,
    pub status: String,
    pub ledger_sequence: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TransactionType {
    Deposit,
    Withdrawal,
    TournamentEntry,
    PrizePayout,
    Refund,
    EscrowLock,
    EscrowRelease,
}

impl std::fmt::Display for TransactionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TransactionType::Deposit => write!(f, "deposit"),
            TransactionType::Withdrawal => write!(f, "withdrawal"),
            TransactionType::TournamentEntry => write!(f, "tournament_entry"),
            TransactionType::PrizePayout => write!(f, "prize_payout"),
            TransactionType::Refund => write!(f, "refund"),
            TransactionType::EscrowLock => write!(f, "escrow_lock"),
            TransactionType::EscrowRelease => write!(f, "escrow_release"),
        }
    }
}

impl From<String> for TransactionType {
    fn from(s: String) -> Self {
        match s.as_str() {
            "withdrawal" => TransactionType::Withdrawal,
            "tournament_entry" => TransactionType::TournamentEntry,
            "prize_payout" => TransactionType::PrizePayout,
            "refund" => TransactionType::Refund,
            "escrow_lock" => TransactionType::EscrowLock,
            "escrow_release" => TransactionType::EscrowRelease,
            _ => TransactionType::Deposit,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TransactionStatus {
    Pending,
    Confirmed,
    Failed,
    Cancelled,
}

impl std::fmt::Display for TransactionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TransactionStatus::Pending => write!(f, "pending"),
            TransactionStatus::Confirmed => write!(f, "confirmed"),
            TransactionStatus::Failed => write!(f, "failed"),
            TransactionStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl From<String> for TransactionStatus {
    fn from(s: String) -> Self {
        match s.as_str() {
            "confirmed" => TransactionStatus::Confirmed,
            "failed" => TransactionStatus::Failed,
            "cancelled" => TransactionStatus::Cancelled,
            _ => TransactionStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateStellarTransactionRequest {
    pub user_id: Option<Uuid>,
    pub wallet_id: Option<Uuid>,
    #[validate(length(equal = 64))]
    pub transaction_hash: String,
    pub transaction_type: TransactionType,
    pub amount: Decimal,
    pub fee: Option<Decimal>,
    #[validate(length(min = 3, max = 10))]
    pub currency: Option<String>,
    pub stellar_sequence_number: Option<i64>,
    #[validate(length(equal = 56))]
    pub source_account: Option<String>,
    #[validate(length(equal = 56))]
    pub destination_account: Option<String>,
    pub memo: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct UpdateStellarTransactionRequest {
    pub status: Option<TransactionStatus>,
    pub stellar_sequence_number: Option<i64>,
    pub memo: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub confirmed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StellarTransactionResponse {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub wallet_id: Option<Uuid>,
    pub transaction_hash: String,
    pub transaction_type: String,
    pub amount: Decimal,
    pub fee: Decimal,
    pub currency: String,
    pub status: String,
    pub stellar_sequence_number: Option<i64>,
    pub source_account: Option<String>,
    pub destination_account: Option<String>,
    pub memo: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub confirmed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<StellarTransaction> for StellarTransactionResponse {
    fn from(transaction: StellarTransaction) -> Self {
        Self {
            id: transaction.id,
            user_id: transaction.user_id,
            wallet_id: transaction.wallet_id,
            transaction_hash: transaction.transaction_hash,
            transaction_type: transaction.transaction_type,
            amount: transaction.amount,
            fee: transaction.fee,
            currency: transaction.currency,
            status: transaction.status,
            stellar_sequence_number: transaction.stellar_sequence_number,
            source_account: transaction.source_account,
            destination_account: transaction.destination_account,
            memo: transaction.memo,
            metadata: transaction.metadata,
            confirmed_at: transaction.confirmed_at,
            created_at: transaction.created_at,
            updated_at: transaction.updated_at,
        }
    }
}
