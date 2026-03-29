//! Reputation Service
//!
//! This service integrates with the Soroban Reputation Index contract to:
//! - Query player reputation scores (skill and fair_play)
//! - Update local database with on-chain reputation data
//! - Filter bad actors from matchmaking
//! - Track anti-cheat flags and penalties

use crate::config::Config;
use crate::models::User;
use sqlx::{PgPool, Row};
use std::sync::Arc;
use thiserror::Error;
use tracing::{debug, error, info, warn};

#[derive(Error, Debug)]
pub enum ReputationError {
    #[error("Contract not found: {0}")]
    ContractNotFound(String),
    #[error("RPC error: {0}")]
    RpcError(String),
    #[error("Database error: {0}")]
    DatabaseError(String),
    #[error("Invalid reputation data: {0}")]
    InvalidData(String),
}

/// Reputation data for a player
#[derive(Debug, Clone, serde::Serialize)]
pub struct PlayerReputation {
    pub user_id: uuid::Uuid,
    pub skill_score: i32,
    pub fair_play_score: i32,
    pub last_update_ts: u64,
    pub is_bad_actor: bool,
}

impl PlayerReputation {
    /// Determine if a player should be filtered from matchmaking
    pub fn should_filter(&self, min_fair_play: i32) -> bool {
        self.is_bad_actor || self.fair_play_score < min_fair_play
    }

    /// Get reputation tier based on scores
    pub fn get_tier(&self) -> ReputationTier {
        if self.fair_play_score >= 90 && self.skill_score >= 1500 {
            ReputationTier::Elite
        } else if self.fair_play_score >= 70 && self.skill_score >= 1200 {
            ReputationTier::Good
        } else if self.fair_play_score >= 50 {
            ReputationTier::Average
        } else {
            ReputationTier::Poor
        }
    }
}

/// Reputation tiers for matchmaking categorization
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReputationTier {
    Elite,   // High skill, excellent behavior
    Good,    // Decent skill, good behavior
    Average, // Moderate scores
    Poor,    // Low fair play or skill
}

pub struct ReputationService {
    db_pool: PgPool,
    config: Config,
}

impl ReputationService {
    pub fn new(db_pool: PgPool, config: Config) -> Self {
        Self { db_pool, config }
    }

    /// Get player reputation from local cache (synced with on-chain data)
    pub async fn get_player_reputation(
        &self,
        user_id: uuid::Uuid,
    ) -> Result<PlayerReputation, ReputationError> {
        let row = sqlx::query(
            r#"
            SELECT 
                id as user_id,
                COALESCE(skill_score, 1000) as skill_score,
                COALESCE(fair_play_score, 100) as fair_play_score,
                reputation_last_updated,
                COALESCE(is_bad_actor, false) as is_bad_actor
            FROM users
            WHERE id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?
        .ok_or_else(|| ReputationError::InvalidData(format!("User {} not found", user_id)))?;

        Ok(PlayerReputation {
            user_id: row.try_get("user_id").unwrap_or_default(),
            skill_score: row.try_get::<i32, _>("skill_score").unwrap_or(1000),
            fair_play_score: row.try_get::<i32, _>("fair_play_score").unwrap_or(100),
            last_update_ts: row
                .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("reputation_last_updated")
                .unwrap_or(None)
                .map(|t| t.timestamp() as u64)
                .unwrap_or(0),
            is_bad_actor: row.try_get::<bool, _>("is_bad_actor").unwrap_or(false),
        })
    }

    /// Update player reputation from on-chain contract
    /// This should be called periodically or after match events
    pub async fn sync_reputation_from_chain(
        &self,
        user_id: uuid::Uuid,
    ) -> Result<PlayerReputation, ReputationError> {
        // TODO: Implement actual Soroban contract call to fetch on-chain reputation
        // For now, we'll use the cached value from the database
        // In production, this would call the ReputationIndex contract's get_reputation() method
        
        debug!("Syncing reputation for user {}", user_id);
        
        // Fetch current cached reputation
        let reputation = self.get_player_reputation(user_id).await?;
        
        // TODO: Call Soroban contract here using soroban_service
        // Example (pseudo-code):
        // let contract_address = self.get_contract_address("reputation_index").await?;
        // let soroban_client = SorobanClient::new(&self.config.stellar.network_url);
        // let on_chain_rep = soroban_client
        //     .invoke_contract::<ReputationData>(
        //         &contract_address,
        //         "get_reputation",
        //         vec![user_public_key]
        //     )
        //     .await?;
        //
        // // Update local cache
        // self.update_local_reputation(user_id, on_chain_rep).await?;

        Ok(reputation)
    }

    /// Batch update reputation after match completion
    pub async fn update_reputation_on_match(
        &self,
        match_id: uuid::Uuid,
        players: &[uuid::Uuid],
        skill_deltas: &[i32],
    ) -> Result<(), ReputationError> {
        if players.len() != skill_deltas.len() {
            return Err(ReputationError::InvalidData(
                "Players and skill deltas length mismatch".to_string(),
            ));
        }

        let mut tx = self
            .db_pool
            .begin()
            .await
            .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        for (i, &player_id) in players.iter().enumerate() {
            let skill_delta = skill_deltas[i];
            let fair_play_delta = 1; // Completion bonus

            // Update user reputation
            sqlx::query(
                r#"
                UPDATE users
                SET 
                    skill_score = COALESCE(skill_score, 1000) + $1,
                    fair_play_score = COALESCE(fair_play_score, 100) + $2,
                    reputation_last_updated = NOW(),
                    updated_at = NOW()
                WHERE id = $3
                "#,
            )
            .bind(skill_delta)
            .bind(fair_play_delta)
            .bind(player_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

            // Record reputation event
            sqlx::query(
                r#"
                INSERT INTO reputation_events (
                    user_id, event_type, skill_delta, fair_play_delta, match_id
                ) VALUES ($1, $2, $3, $4, $5)
                "#,
            )
            .bind(player_id)
            .bind("match_completion")
            .bind(skill_delta)
            .bind(fair_play_delta)
            .bind(match_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

            // Check if player should be flagged as bad actor
            let rep = sqlx::query(
                r#"SELECT fair_play_score FROM users WHERE id = $1"#,
            )
            .bind(player_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

            let fair_play: i32 = rep.try_get("fair_play_score").unwrap_or(100);
            if fair_play < 30 {
                sqlx::query(
                    r#"UPDATE users SET is_bad_actor = true WHERE id = $1"#,
                )
                .bind(player_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

                warn!("Player {} flagged as bad actor (fair_play < 30)", player_id);
            }
        }

        tx.commit()
            .await
            .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        info!(
            "Updated reputation for {} players in match {}",
            players.len(),
            match_id
        );

        Ok(())
    }

    /// Apply anti-cheat penalty to a player
    pub async fn apply_anticheat_penalty(
        &self,
        user_id: uuid::Uuid,
        match_id: uuid::Uuid,
        penalty: i32,
        transaction_hash: Option<String>,
    ) -> Result<(), ReputationError> {
        let mut tx = self
            .db_pool
            .begin()
            .await
            .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        // Apply penalty to fair_play score (capped at 0)
        let result = sqlx::query(
            r#"
            UPDATE users
            SET 
                fair_play_score = GREATEST(0, COALESCE(fair_play_score, 100) - $1),
                anticheat_flags_count = COALESCE(anticheat_flags_count, 0) + 1,
                reputation_last_updated = NOW(),
                updated_at = NOW(),
                is_bad_actor = CASE 
                    WHEN COALESCE(fair_play_score, 100) - $1 < 30 THEN true
                    ELSE is_bad_actor
                END
            WHERE id = $2
            RETURNING fair_play_score
            "#,
        )
        .bind(penalty)
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        // Record penalty event
        sqlx::query(
            r#"
            INSERT INTO reputation_events (
                user_id, event_type, skill_delta, fair_play_delta, match_id, 
                transaction_hash, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
        )
        .bind(user_id)
        .bind("anticheat_penalty")
        .bind(0i32)
        .bind(-penalty)
        .bind(match_id)
        .bind(transaction_hash)
        .bind(serde_json::json!({"penalty": penalty}).to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        warn!(
            "Applied anti-cheat penalty {} to user {} (new fair_play: {})",
            penalty, user_id, result.try_get::<i32, _>("fair_play_score").unwrap_or(0)
        );

        Ok(())
    }

    /// Get list of players filtered by reputation (for matchmaking)
    pub async fn filter_bad_actors(
        &self,
        candidate_ids: &[uuid::Uuid],
        min_fair_play: i32,
    ) -> Result<Vec<uuid::Uuid>, ReputationError> {
        if candidate_ids.is_empty() {
            return Ok(vec![]);
        }

        let filtered = sqlx::query(
            r#"
            SELECT id
            FROM users
            WHERE id = ANY($1)
              AND is_bad_actor = false
              AND COALESCE(fair_play_score, 100) >= $2
            "#,
        )
        .bind(candidate_ids)
        .bind(min_fair_play)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?
        .into_iter()
        .map(|r| r.try_get::<uuid::Uuid, _>("id").unwrap_or_default())
        .collect();

        Ok(filtered)
    }

    /// Get contract address from registry
    pub async fn get_contract_address(&self, contract_name: &str) -> Result<String, ReputationError> {
        let record = sqlx::query(
            r#"SELECT contract_address FROM soroban_contracts WHERE contract_name = $1 AND is_active = true"#,
        )
        .bind(contract_name)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?
        .ok_or_else(|| ReputationError::ContractNotFound(contract_name.to_string()))?;

        Ok(record.try_get::<String, _>("contract_address").unwrap_or_default())
    }

    /// Apply time-based decay to player reputation (periodic maintenance)
    pub async fn apply_decay(&self, user_id: uuid::Uuid, decay_amount: i32) -> Result<(), ReputationError> {
        sqlx::query(
            r#"
            UPDATE users
            SET 
                skill_score = GREATEST(0, COALESCE(skill_score, 1000) - $1),
                fair_play_score = GREATEST(0, COALESCE(fair_play_score, 100) - $1),
                reputation_last_updated = NOW(),
                updated_at = NOW()
            WHERE id = $2
            "#,
        )
        .bind(decay_amount)
        .bind(user_id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        debug!("Applied decay {} to user {}", decay_amount, user_id);

        Ok(())
    }

    /// Get reputation statistics for monitoring
    pub async fn get_reputation_stats(&self) -> Result<ReputationStats, ReputationError> {
        let stats = sqlx::query(
            r#"
            SELECT 
                COUNT(*) FILTER (WHERE is_bad_actor = true) as bad_actors_count,
                COUNT(*) FILTER (WHERE COALESCE(fair_play_score, 100) < 50) as low_fair_play_count,
                COUNT(*) FILTER (WHERE COALESCE(skill_score, 1000) >= 1500) as high_skill_count,
                AVG(COALESCE(skill_score, 1000)) as avg_skill,
                AVG(COALESCE(fair_play_score, 100)) as avg_fair_play
            FROM users
            WHERE is_active = true
            "#,
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        Ok(ReputationStats {
            bad_actors_count: stats.try_get::<i64, _>("bad_actors_count").unwrap_or(0),
            low_fair_play_count: stats.try_get::<i64, _>("low_fair_play_count").unwrap_or(0),
            high_skill_count: stats.try_get::<i64, _>("high_skill_count").unwrap_or(0),
            avg_skill: stats.try_get::<f64, _>("avg_skill").unwrap_or(1000.0),
            avg_fair_play: stats.try_get::<f64, _>("avg_fair_play").unwrap_or(100.0),
        })
    }
}

/// Reputation statistics for monitoring
#[derive(Debug, Clone)]
pub struct ReputationStats {
    pub bad_actors_count: i64,
    pub low_fair_play_count: i64,
    pub high_skill_count: i64,
    pub avg_skill: f64,
    pub avg_fair_play: f64,
}

#[cfg(test)]
mod tests;
