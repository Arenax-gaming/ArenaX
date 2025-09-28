use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use validator::Validate;
use rust_decimal::Decimal;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Wallet {
    pub id: Uuid,
    pub user_id: Uuid,
    pub balance: Decimal,
    pub escrow_balance: Decimal,
    pub currency: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

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
