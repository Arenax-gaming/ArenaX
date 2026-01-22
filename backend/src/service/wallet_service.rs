#![allow(dead_code)]

use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::wallet::Wallet;
use uuid::Uuid;

#[derive(Clone)]
pub struct WalletService {
    #[allow(dead_code)]
    pool: DbPool,
}

impl WalletService {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    pub async fn get_wallet(&self, _user_id: Uuid) -> Result<Wallet, ApiError> {
        // TODO: Implement wallet retrieval from database
        Err(ApiError::not_found("Wallet not found"))
    }

    pub async fn create_wallet(&self, _user_id: Uuid, _stellar_address: String) -> Result<Wallet, ApiError> {
        // TODO: Implement wallet creation with Stellar integration
        Err(ApiError::internal_error("Wallet service not yet implemented"))
    }

    pub async fn get_wallet_transactions(&self, _wallet_id: Uuid) -> Result<Vec<crate::models::wallet::WalletTransaction>, ApiError> {
        // TODO: Implement transaction history retrieval
        Ok(vec![])
    }
}