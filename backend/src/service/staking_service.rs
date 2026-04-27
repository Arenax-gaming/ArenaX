/// Backend staking service — bridges HTTP layer to Soroban staking contract
/// and maintains a local PostgreSQL mirror for fast queries.
use crate::api_error::ApiError;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

// ─── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct StakeForRewardsRequest {
    pub user_id: Uuid,
    pub stellar_address: String,
    pub amount: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaimRewardsRequest {
    pub user_id: Uuid,
    pub stellar_address: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StakePositionResponse {
    pub user_id: Uuid,
    pub stellar_address: String,
    pub staked_amount: i64,
    pub pending_rewards: i64,
    pub tier: String,
    pub governance_weight: i64,
    pub staked_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StakingStats {
    pub total_staked: i64,
    pub reward_pool: i64,
    pub annual_rate_bps: i32,
    pub staker_count: i64,
}

// ─── DB row ───────────────────────────────────────────────────────────────────

#[derive(Debug, sqlx::FromRow)]
struct StakeRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub stellar_address: String,
    pub staked_amount: i64,
    pub pending_rewards: i64,
    pub tier: String,
    pub governance_weight: i64,
    pub staked_at: chrono::DateTime<Utc>,
    pub last_reward_snapshot: chrono::DateTime<Utc>,
}

// ─── Service ──────────────────────────────────────────────────────────────────

pub struct StakingService {
    db: PgPool,
}

impl StakingService {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    /// Mirror a stake-for-rewards event from the Soroban contract into the DB.
    pub async fn record_stake(
        &self,
        req: &StakeForRewardsRequest,
    ) -> Result<StakePositionResponse, ApiError> {
        crate::middleware::security::validate_positive_amount(req.amount)
            .map_err(|e| ApiError::BadRequest(e.to_string()))?;

        let tier = tier_label(req.amount);
        let governance_weight = governance_weight(req.amount, &tier);
        let now = Utc::now();

        let row = sqlx::query_as!(
            StakeRow,
            r#"
            INSERT INTO staking_positions
                (id, user_id, stellar_address, staked_amount, pending_rewards,
                 tier, governance_weight, staked_at, last_reward_snapshot)
            VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $7)
            ON CONFLICT (user_id) DO UPDATE SET
                staked_amount       = staking_positions.staked_amount + EXCLUDED.staked_amount,
                tier                = EXCLUDED.tier,
                governance_weight   = EXCLUDED.governance_weight,
                last_reward_snapshot = EXCLUDED.last_reward_snapshot
            RETURNING *
            "#,
            Uuid::new_v4(),
            req.user_id,
            req.stellar_address,
            req.amount,
            tier,
            governance_weight,
            now,
        )
        .fetch_one(&self.db)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

        Ok(row_to_response(row))
    }

    /// Mirror a claim-rewards event.
    pub async fn record_claim(
        &self,
        req: &ClaimRewardsRequest,
        claimed_amount: i64,
    ) -> Result<StakePositionResponse, ApiError> {
        let row = sqlx::query_as!(
            StakeRow,
            r#"
            UPDATE staking_positions
            SET pending_rewards = 0,
                last_reward_snapshot = NOW()
            WHERE user_id = $1
            RETURNING *
            "#,
            req.user_id,
        )
        .fetch_one(&self.db)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

        // Audit log
        sqlx::query!(
            r#"
            INSERT INTO staking_events (id, user_id, event_type, amount, created_at)
            VALUES ($1, $2, 'claim_rewards', $3, NOW())
            "#,
            Uuid::new_v4(),
            req.user_id,
            claimed_amount,
        )
        .execute(&self.db)
        .await
        .ok();

        Ok(row_to_response(row))
    }

    /// Mirror an unstake event.
    pub async fn record_unstake(&self, user_id: Uuid) -> Result<(), ApiError> {
        sqlx::query!(
            "DELETE FROM staking_positions WHERE user_id = $1",
            user_id
        )
        .execute(&self.db)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

        sqlx::query!(
            r#"
            INSERT INTO staking_events (id, user_id, event_type, amount, created_at)
            VALUES ($1, $2, 'unstake', 0, NOW())
            "#,
            Uuid::new_v4(),
            user_id,
        )
        .execute(&self.db)
        .await
        .ok();

        Ok(())
    }

    pub async fn get_position(
        &self,
        user_id: Uuid,
    ) -> Result<Option<StakePositionResponse>, ApiError> {
        let row = sqlx::query_as!(
            StakeRow,
            "SELECT * FROM staking_positions WHERE user_id = $1",
            user_id
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

        Ok(row.map(row_to_response))
    }

    pub async fn get_stats(&self) -> Result<StakingStats, ApiError> {
        let row = sqlx::query!(
            r#"
            SELECT
                COALESCE(SUM(staked_amount), 0)::BIGINT AS total_staked,
                COUNT(*)::BIGINT                         AS staker_count
            FROM staking_positions
            "#
        )
        .fetch_one(&self.db)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

        Ok(StakingStats {
            total_staked: row.total_staked.unwrap_or(0),
            reward_pool: 0,   // fetched from Soroban in handler
            annual_rate_bps: 1200,
            staker_count: row.staker_count.unwrap_or(0),
        })
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn tier_label(amount: i64) -> String {
    if amount >= 100_000 { "Platinum".into() }
    else if amount >= 25_000 { "Gold".into() }
    else if amount >= 5_000  { "Silver".into() }
    else if amount >= 1_000  { "Bronze".into() }
    else                     { "None".into() }
}

fn governance_weight(amount: i64, tier: &str) -> i64 {
    let multiplier = match tier {
        "Platinum" => 200,
        "Gold"     => 175,
        "Silver"   => 150,
        "Bronze"   => 125,
        _          => 100,
    };
    amount * multiplier / 100
}

fn row_to_response(r: StakeRow) -> StakePositionResponse {
    StakePositionResponse {
        user_id: r.user_id,
        stellar_address: r.stellar_address,
        staked_amount: r.staked_amount,
        pending_rewards: r.pending_rewards,
        tier: r.tier,
        governance_weight: r.governance_weight,
        staked_at: r.staked_at,
    }
}
