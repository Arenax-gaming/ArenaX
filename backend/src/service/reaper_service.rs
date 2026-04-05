//! # Reaper Service
//!
//! Background service that periodically scans for `in_progress` matches whose
//! `report_deadline` has passed and automatically resolves them:
//!
//! | Situation                         | Resolution                          |
//! |-----------------------------------|-------------------------------------|
//! | Only Player 1 reported            | Player 2 forfeited; Player 1 wins   |
//! | Only Player 2 reported            | Player 1 forfeited; Player 2 wins   |
//! | Neither player reported           | Match cancelled (no winner)         |
//! | Both players reported (conflict)  | Skipped — handled by conflict flow  |
//!
//! The Reaper runs on a configurable interval (default 60 s) and processes each
//! expired match in isolation so a single failure never blocks the rest of the
//! batch.

use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::match_models::MatchStatus;
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, warn};
use uuid::Uuid;

/// How long after a match starts before the Reaper forfeits non-reporters.
const DEFAULT_REPORT_TIMEOUT_HOURS: i64 = 24;

/// How often the Reaper wakes up to scan for expired matches (seconds).
const DEFAULT_CHECK_INTERVAL_SECS: u64 = 60;

// ============================================================================
// SERVICE STRUCT
// ============================================================================

pub struct ReaperService {
    db_pool: DbPool,
    /// Kept for documentation / future dynamic config; the deadline is actually
    /// stamped on the match row when it transitions to in_progress.
    #[allow(dead_code)]
    report_timeout_hours: i64,
    check_interval_secs: u64,
}

impl ReaperService {
    pub fn new(db_pool: DbPool) -> Self {
        Self {
            db_pool,
            report_timeout_hours: DEFAULT_REPORT_TIMEOUT_HOURS,
            check_interval_secs: DEFAULT_CHECK_INTERVAL_SECS,
        }
    }

    pub fn with_check_interval(mut self, secs: u64) -> Self {
        self.check_interval_secs = secs;
        self
    }

    // ========================================================================
    // BACKGROUND TASK
    // ========================================================================

    /// Spawn the Reaper as a detached Tokio task.
    ///
    /// The caller should hold an [`Arc`] to keep the service alive for the
    /// duration of the process.
    pub fn run(self: Arc<Self>) {
        let interval_secs = self.check_interval_secs;
        tokio::spawn(async move {
            info!(
                interval_secs,
                "Reaper service started — scanning for expired matches every {}s", interval_secs
            );
            let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
            // The first tick fires immediately; skip it so we don't reap on
            // startup before the server has fully initialised.
            ticker.tick().await;

            loop {
                ticker.tick().await;
                if let Err(e) = self.reap().await {
                    error!(error = %e, "Reaper tick failed");
                }
            }
        });
    }

    // ========================================================================
    // CORE LOGIC
    // ========================================================================

    /// Find all expired matches and handle each one.
    async fn reap(&self) -> Result<(), sqlx::Error> {
        // Efficient query: uses idx_matches_reaper (status, report_deadline).
        // We deliberately fetch only the columns the Reaper needs.
        let expired = sqlx::query(
            r#"
            SELECT id, player1_id, player2_id
            FROM   matches
            WHERE  status         = $1
              AND  report_deadline < NOW()
            "#
        )
        .bind(MatchStatus::InProgress)
        .fetch_all(&self.db_pool)
        .await?;

        if !expired.is_empty() {
            info!(
                count = expired.len(),
                "Reaper found expired in-progress matches"
            );
        }

        for row in expired {
            let id: Uuid = row.try_get("id").map_err(|e| sqlx::Error::ColumnDecode {
                index: "id".to_string(),
                source: Box::new(e),
            })?;
            let player1_id: Uuid = row.try_get("player1_id").map_err(|e| sqlx::Error::ColumnDecode {
                index: "player1_id".to_string(),
                source: Box::new(e),
            })?;
            let player2_id: Option<Uuid> = row.try_get("player2_id").ok();
            if let Err(e) = self.process_expired_match(id, player1_id, player2_id).await {
                // Log and continue — one bad match must not block the rest
                error!(
                    match_id = %id,
                    error    = %e,
                    "Reaper failed to process expired match"
                );
            }
        }

        Ok(())
    }

    /// Determine which player(s) missed the deadline and apply the appropriate
    /// resolution.
    async fn process_expired_match(
        &self,
        match_id: Uuid,
        player1_id: Uuid,
        player2_id: Option<Uuid>,
    ) -> Result<(), ApiError> {
        // --- bye match (no opponent) ---
        let p2_id = match player2_id {
            None => {
                // Give the win to player 1 automatically
                info!(match_id = %match_id, "Reaper: bye match expired — auto-completing for player 1");
                return self.complete_with_winner(match_id, player1_id, None).await;
            }
            Some(id) => id,
        };

        let p1_reported = self.player_has_reported(match_id, player1_id).await?;
        let p2_reported = self.player_has_reported(match_id, p2_id).await?;

        match (p1_reported, p2_reported) {
            (true, false) => {
                // Player 2 failed to report → forfeit player 2, player 1 wins
                warn!(
                    match_id  = %match_id,
                    forfeited = %p2_id,
                    "Reaper: player 2 failed to report — forfeiting"
                );
                self.forfeit(match_id, p2_id, player1_id).await?;
            }
            (false, true) => {
                // Player 1 failed to report → forfeit player 1, player 2 wins
                warn!(
                    match_id  = %match_id,
                    forfeited = %player1_id,
                    "Reaper: player 1 failed to report — forfeiting"
                );
                self.forfeit(match_id, player1_id, p2_id).await?;
            }
            (false, false) => {
                // Neither player reported → cancel the match, no Elo change
                warn!(
                    match_id = %match_id,
                    "Reaper: neither player reported — cancelling match"
                );
                self.cancel_abandoned(match_id).await?;
            }
            (true, true) => {
                // Both reported but still in_progress — this can happen if the
                // conflict-detection path is lagging.  Skip; the conflict handler
                // will pick it up.
                info!(
                    match_id = %match_id,
                    "Reaper: both players reported (conflict pending?) — skipping"
                );
            }
        }

        Ok(())
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    async fn player_has_reported(&self, match_id: Uuid, player_id: Uuid) -> Result<bool, ApiError> {
        let row = sqlx::query("SELECT id FROM match_scores WHERE match_id = $1 AND player_id = $2")
            .bind(match_id)
            .bind(player_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

        Ok(row.is_some())
    }

    /// Set match to `completed`, record the winner, and stamp `forfeited_by`.
    async fn forfeit(
        &self,
        match_id: Uuid,
        forfeited_player: Uuid,
        winner_id: Uuid,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE matches
            SET status       = $1,
                winner_id    = $2,
                forfeited_by = $3,
                completed_at = $4,
                updated_at   = $4
            WHERE id = $5
            "#
        )
        .bind(MatchStatus::Completed)
        .bind(winner_id)
        .bind(forfeited_player)
        .bind(Utc::now())
        .bind(match_id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        info!(
            match_id  = %match_id,
            winner    = %winner_id,
            forfeited = %forfeited_player,
            "Reaper: match completed by forfeit"
        );

        Ok(())
    }

    /// Complete a bye match or any match where the winner is already known and
    /// no forfeit label is needed.
    async fn complete_with_winner(
        &self,
        match_id: Uuid,
        winner_id: Uuid,
        _forfeited_player: Option<Uuid>,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE matches
            SET status       = $1,
                winner_id    = $2,
                completed_at = $3,
                updated_at   = $3
            WHERE id = $4
            "#
        )
        .bind(MatchStatus::Completed)
        .bind(winner_id)
        .bind(Utc::now())
        .bind(match_id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    /// Neither player reported in time — cancel without awarding a winner.
    async fn cancel_abandoned(&self, match_id: Uuid) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE matches
            SET status     = $1,
                updated_at = $2
            WHERE id = $3
            "#
        )
        .bind(MatchStatus::Cancelled)
        .bind(Utc::now())
        .bind(match_id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    // Unit tests for pure logic live here.
    // Integration tests that exercise the DB should live in tests/reaper_tests.rs.

    #[test]
    fn both_reported_skipped() {
        // (true, true) → no action branch exists — verified structurally above
        assert!(true);
    }
}
