// Core models
pub mod match_authority;
pub mod match_models;
pub mod reward_settlement;
pub mod stellar_account;
pub mod stellar_transaction;
pub mod tournament;
pub mod user;
pub mod wallet;

// Re-export commonly used types - explicit to avoid ambiguity
pub use stellar_account::StellarAccount;
pub use stellar_transaction::StellarTransaction;
pub use user::User;
pub use wallet::{Transaction, TransactionStatus, TransactionType, Wallet};

/// Generic API response wrapper
#[derive(Debug, serde::Serialize)]
pub struct ApiResponse<T: serde::Serialize> {
    pub success: bool,
    pub data: T,
}

impl<T: serde::Serialize> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data,
        }
    }
}
