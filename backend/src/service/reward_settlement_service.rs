#![allow(dead_code)]

use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::reward_settlement::{RewardSettlement, SettlementStatus};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

/// Service responsible for calculating rewards and triggering payouts after match completion.
/// Integrates with escrow and token contracts.
#[derive(Clone)]
pub struct RewardSettlementService {
    #[allow(dead_code)]
    pool: DbPool,
}

/// In-memory storage for settlement records (placeholder for database)
/// Thread-safe for concurrent access
static SETTLEMENTS: std::sync::LazyLock<RwLock<HashMap<String, RewardSettlement>>> =
    std::sync::LazyLock::new(|| RwLock::new(HashMap::new()));

impl RewardSettlementService {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Settle rewards for a completed match.
    /// Idempotent: will not recompute or resettle if already confirmed.
    pub async fn settle_match_reward(
        &self,
        match_id: String,
        winner: String,
        stake_amount: String,
        asset: String,
    ) -> Result<RewardSettlement, ApiError> {
        // Check for existing settlement (idempotent execution)
        if let Some(existing) = self.get_settlement(&match_id).await? {
            // Never recompute rewards after on-chain settlement
            if existing.is_settled() {
                return Ok(existing);
            }
            // If previously failed, allow retry
            if existing.status != Some(SettlementStatus::Failed) {
                return Ok(existing);
            }
        }

        // Compute rewards deterministically
        let reward_amount = self.compute_reward(&stake_amount)?;

        // Create settlement record
        let mut settlement = RewardSettlement::new(
            match_id.clone(),
            winner.clone(),
            reward_amount,
            asset.clone(),
        );

        // Persist initial settlement record
        self.persist_settlement(&settlement)?;

        // Call settlement contract
        match self.call_settlement_contract(&settlement).await {
            Ok(tx_hash) => {
                settlement.tx_hash = Some(tx_hash);
                settlement.status = Some(SettlementStatus::Confirmed);
                settlement.settled_at = Some(Utc::now());
                // Persist settlement proof
                self.persist_settlement(&settlement)?;
                Ok(settlement)
            }
            Err(e) => {
                // Handle partial failure
                settlement.status = Some(SettlementStatus::Failed);
                self.persist_settlement(&settlement)?;
                Err(e)
            }
        }
    }

    /// Compute rewards deterministically based on stake amount.
    /// Winner receives the full stake amount (deterministic calculation).
    fn compute_reward(&self, stake_amount: &str) -> Result<String, ApiError> {
        // Parse and validate stake amount
        let amount: u128 = stake_amount
            .parse()
            .map_err(|_| ApiError::bad_request("Invalid stake amount format"))?;

        // Deterministic reward calculation: winner gets full stake
        // Additional logic (e.g., platform fees) can be added here
        Ok(amount.to_string())
    }

    /// Call the settlement contract to execute the payout.
    async fn call_settlement_contract(
        &self,
        settlement: &RewardSettlement,
    ) -> Result<String, ApiError> {
        // Update status to submitted before contract call
        let mut updated = settlement.clone();
        updated.status = Some(SettlementStatus::Submitted);
        self.persist_settlement(&updated)?;

        // TODO: Implement actual contract call to escrow/token contracts
        // This would use Stellar SDK or Soroban client
        // For now, return a placeholder transaction hash
        let _pool = &self.pool;
        let tx_hash = format!(
            "tx_{}_{}_{}",
            settlement.match_id,
            settlement.winner,
            Utc::now().timestamp()
        );

        Ok(tx_hash)
    }

    /// Get existing settlement by match ID.
    pub async fn get_settlement(&self, match_id: &str) -> Result<Option<RewardSettlement>, ApiError> {
        let settlements = SETTLEMENTS
            .read()
            .map_err(|_| ApiError::internal_error("Failed to read settlements"))?;
        Ok(settlements.get(match_id).cloned())
    }

    /// Persist settlement record (proof of settlement).
    fn persist_settlement(&self, settlement: &RewardSettlement) -> Result<(), ApiError> {
        let mut settlements = SETTLEMENTS
            .write()
            .map_err(|_| ApiError::internal_error("Failed to write settlement"))?;
        settlements.insert(settlement.match_id.clone(), settlement.clone());
        // TODO: Persist to database using self.pool
        Ok(())
    }

    /// Get all settlements (for administrative purposes).
    pub async fn get_all_settlements(&self) -> Result<Vec<RewardSettlement>, ApiError> {
        let settlements = SETTLEMENTS
            .read()
            .map_err(|_| ApiError::internal_error("Failed to read settlements"))?;
        Ok(settlements.values().cloned().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_service() -> RewardSettlementService {
        RewardSettlementService::new(DbPool)
    }

    #[test]
    fn test_compute_reward_deterministic() {
        let service = create_test_service();
        let result1 = service.compute_reward("1000").unwrap();
        let result2 = service.compute_reward("1000").unwrap();
        assert_eq!(result1, result2, "Reward computation must be deterministic");
        assert_eq!(result1, "1000");
    }

    #[test]
    fn test_compute_reward_invalid_amount() {
        let service = create_test_service();
        let result = service.compute_reward("invalid");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_idempotent_settlement() {
        let service = create_test_service();
        let match_id = format!("test_match_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));
        
        // First settlement
        let result1 = service
            .settle_match_reward(
                match_id.clone(),
                "winner1".to_string(),
                "1000".to_string(),
                "XLM".to_string(),
            )
            .await
            .unwrap();

        // Second settlement attempt should return same result (idempotent)
        let result2 = service
            .settle_match_reward(
                match_id.clone(),
                "winner1".to_string(),
                "1000".to_string(),
                "XLM".to_string(),
            )
            .await
            .unwrap();

        assert_eq!(result1.match_id, result2.match_id);
        assert_eq!(result1.tx_hash, result2.tx_hash);
    }

    #[tokio::test]
    async fn test_settlement_persisted() {
        let service = create_test_service();
        let match_id = format!("persist_test_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));
        
        service
            .settle_match_reward(
                match_id.clone(),
                "winner1".to_string(),
                "500".to_string(),
                "USDC".to_string(),
            )
            .await
            .unwrap();

        let retrieved = service.get_settlement(&match_id).await.unwrap();
        assert!(retrieved.is_some());
        let settlement = retrieved.unwrap();
        assert_eq!(settlement.winner, "winner1");
        assert!(settlement.tx_hash.is_some());
    }
}
