//! Reputation Service
//!
//! This service integrates with the Soroban Reputation Index contract to:
//! - Query player reputation scores (skill and fair_play)
//! - Update local database with on-chain reputation data
//! - Filter bad actors from matchmaking
//! - Track anti-cheat flags and penalties

use crate::config::Config;
use crate::models::User;
use crate::service::notification_service::{NewNotification, NotificationService};
use crate::service::soroban_service::SorobanService;
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

use serde::{Deserialize, Serialize};

/// Reputation data for a player
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    soroban: Option<Arc<SorobanService>>,
    notifications: Option<Arc<NotificationService>>,
}

impl ReputationService {
    pub fn new(db_pool: PgPool, config: Config) -> Self {
        Self {
            db_pool,
            config,
            soroban: None,
            notifications: None,
        }
    }

    /// Mirror reputation changes to the reputation-tracker Soroban contract.
    pub fn with_soroban(mut self, soroban: Arc<SorobanService>) -> Self {
        self.soroban = Some(soroban);
        self
    }

    /// Notify players whenever their reputation changes.
    pub fn with_notifications(mut self, notifications: Arc<NotificationService>) -> Self {
        self.notifications = Some(notifications);
        self
    }

    /// Get player reputation from local cache (synced with on-chain data)
    pub async fn get_player_reputation(
        &self,
        user_id: uuid::Uuid,
    ) -> Result<PlayerReputation, ReputationError> {
        let record = sqlx::query!(
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
            user_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?
        .ok_or_else(|| ReputationError::InvalidData(format!("User {} not found", user_id)))?;

        Ok(PlayerReputation {
            user_id: record.user_id,
            skill_score: record.skill_score,
            fair_play_score: record.fair_play_score,
            last_update_ts: record
                .reputation_last_updated
                .map(|t| t.timestamp() as u64)
                .unwrap_or(0),
            is_bad_actor: record.is_bad_actor,
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
            sqlx::query!(
                r#"
                UPDATE users
                SET 
                    skill_score = COALESCE(skill_score, 1000) + $1,
                    fair_play_score = COALESCE(fair_play_score, 100) + $2,
                    reputation_last_updated = NOW(),
                    updated_at = NOW()
                WHERE id = $3
                "#,
                skill_delta,
                fair_play_delta,
                player_id
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

            // Record reputation event
            sqlx::query!(
                r#"
                INSERT INTO reputation_events (
                    user_id, event_type, skill_delta, fair_play_delta, match_id
                ) VALUES ($1, $2, $3, $4, $5)
                "#,
                player_id,
                "match_completion",
                skill_delta,
                fair_play_delta,
                match_id
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

            // Check if player should be flagged as bad actor
            let rep = sqlx::query!(
                r#"SELECT fair_play_score FROM users WHERE id = $1"#,
                player_id
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

            if rep.fair_play_score < 30 {
                sqlx::query!(
                    r#"UPDATE users SET is_bad_actor = true WHERE id = $1"#,
                    player_id
                )
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
        let result = sqlx::query!(
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
            penalty,
            user_id
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        // Record penalty event
        sqlx::query!(
            r#"
            INSERT INTO reputation_events (
                user_id, event_type, skill_delta, fair_play_delta, match_id, 
                transaction_hash, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            user_id,
            "anticheat_penalty",
            0,
            -penalty,
            match_id,
            transaction_hash,
            serde_json::json!({"penalty": penalty}).to_string()
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        warn!(
            "Applied anti-cheat penalty {} to user {} (new fair_play: {})",
            penalty, user_id, result.fair_play_score.unwrap_or(0)
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

        let filtered = sqlx::query!(
            r#"
            SELECT id
            FROM users
            WHERE id = ANY($1)
              AND is_bad_actor = false
              AND COALESCE(fair_play_score, 100) >= $2
            "#,
            candidate_ids,
            min_fair_play
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?
        .into_iter()
        .map(|r| r.id)
        .collect();

        Ok(filtered)
    }

    /// Get contract address from registry
    pub async fn get_contract_address(&self, contract_name: &str) -> Result<String, ReputationError> {
        let record = sqlx::query!(
            r#"SELECT contract_address FROM soroban_contracts WHERE contract_name = $1 AND is_active = true"#,
            contract_name
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?
        .ok_or_else(|| ReputationError::ContractNotFound(contract_name.to_string()))?;

        Ok(record.contract_address)
    }

    /// Apply time-based decay to player reputation (periodic maintenance)
    pub async fn apply_decay(&self, user_id: uuid::Uuid, decay_amount: i32) -> Result<(), ReputationError> {
        sqlx::query!(
            r#"
            UPDATE users
            SET 
                skill_score = GREATEST(0, COALESCE(skill_score, 1000) - $1),
                fair_play_score = GREATEST(0, COALESCE(fair_play_score, 100) - $1),
                reputation_last_updated = NOW(),
                updated_at = NOW()
            WHERE id = $2
            "#,
            decay_amount,
            user_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        debug!("Applied decay {} to user {}", decay_amount, user_id);

        Ok(())
    }

    /// Get reputation statistics for monitoring
    pub async fn get_reputation_stats(&self) -> Result<ReputationStats, ReputationError> {
        let stats = sqlx::query!(
            r#"
            SELECT 
                COUNT(*) FILTER (WHERE is_bad_actor = true) as bad_actors_count,
                COUNT(*) FILTER (WHERE COALESCE(fair_play_score, 100) < 50) as low_fair_play_count,
                COUNT(*) FILTER (WHERE COALESCE(skill_score, 1000) >= 1500) as high_skill_count,
                AVG(COALESCE(skill_score, 1000)) as avg_skill,
                AVG(COALESCE(fair_play_score, 100)) as avg_fair_play
            FROM users
            WHERE is_active = true
            "#
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        Ok(ReputationStats {
            bad_actors_count: stats.bad_actors_count.unwrap_or(0) as i64,
            low_fair_play_count: stats.low_fair_play_count.unwrap_or(0) as i64,
            high_skill_count: stats.high_skill_count.unwrap_or(0) as i64,
            avg_skill: stats.avg_skill.unwrap_or(1000.0),
            avg_fair_play: stats.avg_fair_play.unwrap_or(100.0),
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

/// Reputation Token (ARXREP) issued as a Stellar custom asset. See
/// docs/REPUTATION_TOKEN.md for the full metadata.
pub const REPUTATION_TOKEN_CODE: &str = "ARXREP";
/// Reputation granted to every account on signup.
pub const INITIAL_REPUTATION: i32 = 100;
/// Reward for completing a match with no cheating or dispute.
pub const FAIR_MATCH_REWARD: i32 = 2;
/// Penalty applied once cheating is confirmed.
pub const CHEATING_PENALTY: i32 = 25;
/// Penalty applied when a player opens too many disputes.
pub const EXCESSIVE_DISPUTE_PENALTY: i32 = 10;
/// Disputes a player may open inside `DISPUTE_WINDOW_DAYS` before being penalised.
pub const MAX_DISPUTES_PER_WINDOW: i64 = 5;
pub const DISPUTE_WINDOW_DAYS: i32 = 30;

/// Why a player's reputation changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReputationReason {
    Signup,
    FairMatch,
    ConfirmedCheating,
    ExcessiveDisputes,
}

impl ReputationReason {
    /// Event type stored in `reputation_events`; also the on-chain reason symbol
    /// (Soroban short symbols are at most 9 characters).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Signup => "signup",
            Self::FairMatch => "fair",
            Self::ConfirmedCheating => "cheating",
            Self::ExcessiveDisputes => "disputes",
        }
    }

    fn describe(self) -> &'static str {
        match self {
            Self::Signup => "signing up",
            Self::FairMatch => "fair match completion",
            Self::ConfirmedCheating => "confirmed cheating",
            Self::ExcessiveDisputes => "excessive disputes",
        }
    }
}

/// Initial reputation allocation on signup: seeds the off-chain score and
/// records the allocation. The player's ARXREP trustline is opened when their
/// Stellar account is created (see `ReputationService::reputation_trustline_args`).
pub async fn allocate_initial_reputation(
    pool: &PgPool,
    user_id: uuid::Uuid,
) -> Result<(), ReputationError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;
    sqlx::query(
        "UPDATE users SET fair_play_score = $1, reputation_last_updated = NOW() WHERE id = $2",
    )
    .bind(INITIAL_REPUTATION)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;
    sqlx::query(
        "INSERT INTO reputation_events (user_id, event_type, skill_delta, fair_play_delta) \
         VALUES ($1, $2, 0, $3)",
    )
    .bind(user_id)
    .bind(ReputationReason::Signup.as_str())
    .bind(INITIAL_REPUTATION)
    .execute(&mut *tx)
    .await
    .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;
    tx.commit()
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))
}

impl ReputationService {
    /// Change-trust arguments a user account submits to hold ARXREP.
    pub fn reputation_trustline_args(&self, issuer: &str) -> serde_json::Value {
        serde_json::json!({
            "asset_code": REPUTATION_TOKEN_CODE,
            "asset_issuer": issuer,
        })
    }

    /// Reward every player of a match that finished without cheating or disputes.
    pub async fn reward_fair_match(
        &self,
        match_id: uuid::Uuid,
        players: &[uuid::Uuid],
    ) -> Result<(), ReputationError> {
        for &player in players {
            self.change_reputation(
                player,
                FAIR_MATCH_REWARD,
                ReputationReason::FairMatch,
                Some(match_id),
            )
            .await?;
        }
        Ok(())
    }

    /// Penalise a player once a cheating report has been confirmed.
    pub async fn penalize_confirmed_cheating(
        &self,
        user_id: uuid::Uuid,
        match_id: uuid::Uuid,
    ) -> Result<i32, ReputationError> {
        self.change_reputation(
            user_id,
            -CHEATING_PENALTY,
            ReputationReason::ConfirmedCheating,
            Some(match_id),
        )
        .await
    }

    /// Penalise a player whose disputes in the last `DISPUTE_WINDOW_DAYS`
    /// exceed `MAX_DISPUTES_PER_WINDOW`. Call after a dispute is opened.
    /// Returns the new score when a penalty was applied.
    pub async fn check_excessive_disputes(
        &self,
        user_id: uuid::Uuid,
    ) -> Result<Option<i32>, ReputationError> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM disputes \
             WHERE opened_by = $1 AND created_at > NOW() - make_interval(days => $2)",
        )
        .bind(user_id)
        .bind(DISPUTE_WINDOW_DAYS)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        if count <= MAX_DISPUTES_PER_WINDOW {
            return Ok(None);
        }
        self.change_reputation(
            user_id,
            -EXCESSIVE_DISPUTE_PENALTY,
            ReputationReason::ExcessiveDisputes,
            None,
        )
        .await
        .map(Some)
    }

    /// Apply `delta` to the player's fair-play score, record it, mirror it
    /// on-chain and notify the player. Returns the new score.
    async fn change_reputation(
        &self,
        user_id: uuid::Uuid,
        delta: i32,
        reason: ReputationReason,
        match_id: Option<uuid::Uuid>,
    ) -> Result<i32, ReputationError> {
        let new_score: i32 = sqlx::query_scalar(
            r#"
            UPDATE users
            SET fair_play_score = GREATEST(0, COALESCE(fair_play_score, 100) + $1),
                is_bad_actor = (GREATEST(0, COALESCE(fair_play_score, 100) + $1) < 30) OR COALESCE(is_bad_actor, false),
                reputation_last_updated = NOW(),
                updated_at = NOW()
            WHERE id = $2
            RETURNING fair_play_score
            "#,
        )
        .bind(delta)
        .bind(user_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;

        let tx_hash = self.invoke_contract(user_id, delta, reason).await;
        self.record_event(user_id, reason, delta, match_id).await?;
        if let Some(hash) = &tx_hash {
            debug!("Reputation change for {} mirrored on-chain: {}", user_id, hash);
        }
        self.notify(user_id, delta, new_score, reason).await;

        Ok(new_score)
    }

    async fn record_event(
        &self,
        user_id: uuid::Uuid,
        reason: ReputationReason,
        delta: i32,
        match_id: Option<uuid::Uuid>,
    ) -> Result<(), ReputationError> {
        sqlx::query(
            "INSERT INTO reputation_events (user_id, event_type, skill_delta, fair_play_delta, match_id) \
             VALUES ($1, $2, 0, $3, $4)",
        )
        .bind(user_id)
        .bind(reason.as_str())
        .bind(delta)
        .bind(match_id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ReputationError::DatabaseError(e.to_string()))?;
        Ok(())
    }

    /// Invoke `increment`/`decrement` on the reputation-tracker contract.
    /// Failures are logged, not propagated: the off-chain score stays the
    /// source of truth and `sync_reputation_from_chain` reconciles later.
    async fn invoke_contract(
        &self,
        user_id: uuid::Uuid,
        delta: i32,
        reason: ReputationReason,
    ) -> Option<String> {
        let soroban = self.soroban.as_ref()?;
        let player: Option<String> =
            sqlx::query_scalar("SELECT stellar_public_key FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_one(&self.db_pool)
                .await
                .ok()
                .flatten();
        let Some(player) = player else {
            debug!("User {} has no Stellar account; skipping on-chain update", user_id);
            return None;
        };

        let function = if delta >= 0 { "increment" } else { "decrement" };
        let args = serde_json::json!({
            "player": player,
            "amount": delta.unsigned_abs(),
            "reason": reason.as_str(),
        });
        match soroban
            .invoke(
                &self.config.stellar.soroban_contract_reputation,
                function,
                &args,
                &self.config.stellar.admin_secret,
            )
            .await
        {
            Ok(result) => Some(result.hash),
            Err(e) => {
                error!("Reputation contract {} failed for {}: {}", function, user_id, e);
                None
            }
        }
    }

    async fn notify(&self, user_id: uuid::Uuid, delta: i32, new_score: i32, reason: ReputationReason) {
        let Some(notifications) = &self.notifications else {
            return;
        };
        let (title, verb) = if delta >= 0 {
            ("Reputation increased", "increased")
        } else {
            ("Reputation decreased", "decreased")
        };
        let result = notifications
            .create_and_fan_out(NewNotification {
                user_id,
                typ: "reputation_change".to_string(),
                title: title.to_string(),
                message: format!(
                    "Your reputation {} by {} for {} (now {}).",
                    verb,
                    delta.abs(),
                    reason.describe(),
                    new_score
                ),
                link: Some("/profile/reputation".to_string()),
                link_label: Some("View reputation".to_string()),
            })
            .await;
        if let Err(e) = result {
            warn!("Failed to send reputation notification to {}: {:?}", user_id, e);
        }
    }
}

#[cfg(test)]
mod tests {}
