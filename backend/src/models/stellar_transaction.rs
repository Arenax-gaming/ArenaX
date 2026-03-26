use chrono::{DateTime, Utc};
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
pub enum StellarTransactionType {
    Deposit,
    Withdrawal,
    TournamentEntry,
    PrizePayout,
    Refund,
    EscrowLock,
    EscrowRelease,
}

impl std::fmt::Display for StellarTransactionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StellarTransactionType::Deposit => write!(f, "deposit"),
            StellarTransactionType::Withdrawal => write!(f, "withdrawal"),
            StellarTransactionType::TournamentEntry => write!(f, "tournament_entry"),
            StellarTransactionType::PrizePayout => write!(f, "prize_payout"),
            StellarTransactionType::Refund => write!(f, "refund"),
            StellarTransactionType::EscrowLock => write!(f, "escrow_lock"),
            StellarTransactionType::EscrowRelease => write!(f, "escrow_release"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StellarTransactionStatus {
    Pending,
    Confirmed,
    Failed,
    Cancelled,
}

impl std::fmt::Display for StellarTransactionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StellarTransactionStatus::Pending => write!(f, "pending"),
            StellarTransactionStatus::Confirmed => write!(f, "confirmed"),
            StellarTransactionStatus::Failed => write!(f, "failed"),
            StellarTransactionStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateStellarTransactionRequest {
    pub user_id: Option<Uuid>,
    #[validate(length(equal = 64))]
    pub transaction_hash: String,
    pub transaction_type: StellarTransactionType,
    pub amount: i64,
    pub asset_code: Option<String>,
    pub asset_issuer: Option<String>,
    pub source_account: Option<String>,
    pub destination_account: Option<String>,
    pub operation_type: Option<String>,
    pub memo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StellarTransactionResponse {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub transaction_hash: String,
    pub amount: i64,
    pub asset_code: String,
    pub status: String,
    pub source_account: String,
    pub destination_account: String,
    pub operation_type: String,
    pub memo: Option<String>,
    pub ledger_sequence: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

impl From<StellarTransaction> for StellarTransactionResponse {
    fn from(transaction: StellarTransaction) -> Self {
        Self {
            id: transaction.id,
            user_id: transaction.user_id,
            transaction_hash: transaction.transaction_hash,
            amount: transaction.amount,
            asset_code: transaction.asset_code,
            status: transaction.status,
            source_account: transaction.source_account,
            destination_account: transaction.destination_account,
            operation_type: transaction.operation_type,
            memo: transaction.memo,
            ledger_sequence: transaction.ledger_sequence,
            created_at: transaction.created_at,
            completed_at: transaction.completed_at,
        }
    }
}
