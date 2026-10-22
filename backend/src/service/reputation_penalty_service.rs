//! Reputation penalties for cheating and dispute abuse (Issue #1231).
//!
//! A penalty reduces the player's fair-play score locally, burns the same
//! amount of Reputation Tokens via the Soroban reputation contract, notifies
//! the player and suspends them from competition once their score falls
//! below [`SUSPENSION_THRESHOLD`]. Moderators may override the rule amount.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use tracing::{error, warn};
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::service::soroban_service::SorobanService;
use crate::service::suspension_service::{RestrictionScope, SuspensionService};

/// Fair-play score below which a player is suspended from competition.
pub const SUSPENSION_THRESHOLD: i32 = 30;
/// Length of the automatic competition suspension.
pub const SUSPENSION_HOURS: i64 = 24 * 7;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PenaltyRule {
    /// Cheating confirmed by anti-cheat review or a resolved dispute.
    ConfirmedCheating,
    /// Dispute rejected as unfounded.
    FalseDispute,
    /// Too many disputes raised in a short window.
    ExcessiveDisputes,
}

impl PenaltyRule {
    /// Reputation points deducted when no override is supplied.
    pub fn default_amount(self) -> i32 {
        match self {
            PenaltyRule::ConfirmedCheating => 50,
            PenaltyRule::FalseDispute => 10,
            PenaltyRule::ExcessiveDisputes => 20,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            PenaltyRule::ConfirmedCheating => "confirmed_cheating",
            PenaltyRule::FalseDispute => "false_dispute",
            PenaltyRule::ExcessiveDisputes => "excessive_disputes",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct PenaltyOutcome {
    pub user_id: Uuid,
    pub rule: PenaltyRule,
    pub amount: i32,
    pub fair_play_score: i32,
    pub transaction_hash: Option<String>,
    pub suspended: bool,
}

pub struct ReputationPenaltyService {
    db_pool: PgPool,
    soroban: Arc<SorobanService>,
    reputation_contract: String,
    signer_secret: String,
}

impl ReputationPenaltyService {
    pub fn new(
        db_pool: PgPool,
        soroban: Arc<SorobanService>,
        reputation_contract: String,
        signer_secret: String,
    ) -> Self {
        Self { db_pool, soroban, reputation_contract, signer_secret }
    }

    /// Applies `rule` to `user_id`. `override_amount` (moderators only) replaces
    /// the rule's default deduction; `0` records the penalty without deducting.
    pub async fn apply_penalty(
        &self,
        user_id: Uuid,
        rule: PenaltyRule,
        match_id: Option<Uuid>,
        override_amount: Option<i32>,
        issued_by: Option<Uuid>,
    ) -> Result<PenaltyOutcome, ApiError> {
        let amount = override_amount.unwrap_or_else(|| rule.default_amount()).max(0);

        let public_key: Option<String> =
            sqlx::query_scalar("SELECT stellar_public_key FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_optional(&self.db_pool)
                .await?
                .ok_or(ApiError::NotFound)?;

        // Burn on-chain first so the local record carries the tx hash. A chain
        // failure is logged but does not block the off-chain penalty.
        let transaction_hash = match (&public_key, amount > 0) {
            (Some(pk), true) => match self
                .soroban
                .invoke(
                    &self.reputation_contract,
                    "reduce_reputation",
                    &serde_json::json!({ "player": pk, "amount": amount, "reason": rule.as_str() }),
                    &self.signer_secret,
                )
                .await
            {
                Ok(res) => Some(res.hash),
                Err(e) => {
                    error!(%user_id, error = %e, "Reputation token reduction failed on-chain");
                    None
                }
            },
            _ => None,
        };

        let mut tx = self.db_pool.begin().await?;

        let fair_play_score: i32 = sqlx::query(
            r#"
            UPDATE users
            SET fair_play_score = GREATEST(0, COALESCE(fair_play_score, 100) - $1),
                is_bad_actor = is_bad_actor OR COALESCE(fair_play_score, 100) - $1 < $3,
                reputation_last_updated = NOW(),
                updated_at = NOW()
            WHERE id = $2
            RETURNING fair_play_score
            "#,
        )
        .bind(amount)
        .bind(user_id)
        .bind(SUSPENSION_THRESHOLD)
        .fetch_one(&mut *tx)
        .await?
        .try_get("fair_play_score")?;

        sqlx::query(
            r#"
            INSERT INTO reputation_events (
                user_id, event_type, skill_delta, fair_play_delta, match_id,
                transaction_hash, metadata
            ) VALUES ($1, 'penalty', 0, $2, $3, $4, $5)
            "#,
        )
        .bind(user_id)
        .bind(-amount)
        .bind(match_id)
        .bind(&transaction_hash)
        .bind(
            serde_json::json!({
                "rule": rule.as_str(),
                "amount": amount,
                "override": override_amount.is_some(),
                "issued_by": issued_by,
            })
            .to_string(),
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1, 'reputation_penalty', $2, $3, $4)",
        )
        .bind(user_id)
        .bind("Reputation penalty applied")
        .bind(format!(
            "{} reputation points were deducted ({}). Your fair-play score is now {}.",
            amount,
            rule.as_str().replace('_', " "),
            fair_play_score
        ))
        .bind("/profile")
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        let suspended = fair_play_score < SUSPENSION_THRESHOLD;
        if suspended {
            SuspensionService::new(self.db_pool.clone())
                .suspend_temporarily(
                    user_id,
                    RestrictionScope::Competition,
                    "Fair-play score fell below the suspension threshold",
                    SUSPENSION_HOURS,
                    issued_by,
                )
                .await?;
            warn!(%user_id, fair_play_score, "Player suspended after reputation penalty");
        }

        Ok(PenaltyOutcome {
            user_id,
            rule,
            amount,
            fair_play_score,
            transaction_hash,
            suspended,
        })
    }
}
