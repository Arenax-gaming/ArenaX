#![allow(dead_code)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wallet {
    pub id: Uuid,
    pub user_id: Uuid,
    pub stellar_address: String,
    pub balance: i64, // TODO: Use Decimal when rust_decimal is added
    pub currency: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletTransaction {
    pub id: Uuid,
    pub wallet_id: Uuid,
    pub transaction_type: String,
    pub amount: i64, // TODO: Use Decimal when rust_decimal is added
    pub currency: String,
    pub description: String,
    pub stellar_transaction_hash: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWalletRequest {
    pub stellar_address: String,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletResponse {
    #[serde(flatten)]
    pub wallet: Wallet,
    pub recent_transactions: Vec<WalletTransaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TransactionType {
    Deposit,
    Withdrawal,
    TournamentEntry,
    TournamentPrize,
    Transfer,
}

impl std::fmt::Display for TransactionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TransactionType::Deposit => write!(f, "deposit"),
            TransactionType::Withdrawal => write!(f, "withdrawal"),
            TransactionType::TournamentEntry => write!(f, "tournament_entry"),
            TransactionType::TournamentPrize => write!(f, "tournament_prize"),
            TransactionType::Transfer => write!(f, "transfer"),
        }
    }
}