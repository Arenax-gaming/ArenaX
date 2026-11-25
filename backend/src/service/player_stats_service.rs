//! Player statistics aggregation service — Issue #904.
//!
//! Aggregates win/loss/draw data already stored in `user_elo`, `elo_history`,
//! and `matches` into four new views:
//!
//! 1. **Summary**       — lifetime totals, streaks, favourite mode, per-mode breakdown
//! 2. **Daily snapshots** — win/loss/draw grouped by calendar day
//! 3. **Win-rate by mode** — breakdown per `game_mode`
//! 4. **Head-to-head**  — record between two specific players
//!
//! All heavy queries read from existing tables (no schema changes needed for
//! the core queries). The migration `20260824000001_player_stats_snapshots`
//! adds a `player_stats_daily` materialised-view cache table for the daily
//! snapshot query so it stays fast at scale.

use crate::api_error::ApiError;
use crate::service::elo_decay::{
    evaluate_player_decay, AppliedEloDecay, DecaySweepBatch, EloDecayConfig,
    PendingDecayNotification, PlayerDecayState,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

// ─── Response types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerComparisonStats {
    pub player_id: Uuid,
    pub win_rate: f64,
    pub average_elo: f64,
    pub matches_played: i64,
    pub tournament_wins: i64,
    pub reputation_score: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchPlayerStatsResponse {
    pub players: HashMap<String, PlayerComparisonStats>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WinRateByMode {
    pub game_mode: String,
    pub matches_played: i64,
    pub wins: i64,
    pub losses: i64,
    pub draws: i64,
    pub win_rate_pct: f64,
}

#[derive(Debug, Serialize)]
pub struct PlayerStatsSummary {
    pub user_id: Uuid,
    pub total_matches: i64,
    pub total_wins: i64,
    pub total_losses: i64,
    pub total_draws: i64,
    pub overall_win_rate_pct: f64,
    pub current_win_streak: i32,
    pub best_win_streak: i32,
    pub favorite_game_mode: Option<String>,
    pub avg_session_secs: i64,
    pub win_rate_by_mode: Vec<WinRateByMode>,
}

#[derive(Debug, Serialize)]
pub struct PlayerStatsSnapshot {
    pub user_id: Uuid,
    pub snapshot_date: DateTime<Utc>,
    pub game_mode: String,
    pub wins: i64,
    pub losses: i64,
    pub draws: i64,
    pub matches_played: i64,
    pub win_rate_pct: f64,
    pub avg_session_secs: i64,
}

#[derive(Debug, Serialize)]
pub struct HeadToHeadRecord {
    pub player_id: Uuid,
    pub opponent_id: Uuid,
    pub wins: i64,
    pub losses: i64,
    pub draws: i64,
    pub total_matches: i64,
    pub win_rate_pct: f64,
    pub last_played: Option<DateTime<Utc>>,
}

// ─── Service ──────────────────────────────────────────────────────────────────

pub struct PlayerStatsService {
    db: PgPool,
}

impl PlayerStatsService {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    // ── 1. Lifetime summary ───────────────────────────────────────────────────

    /// Returns the player's all-time stats summary with per-mode breakdown.
    ///
    /// Pulls from `user_elo` (aggregates across all game entries per user) and
    /// `analytics_player_behaviour` for avg session data.
    pub async fn get_player_stats_summary(
        &self,
        user_id: Uuid,
    ) -> Result<PlayerStatsSummary, ApiError> {
        // Lifetime totals across all games from user_elo
        let totals = sqlx::query!(
            r#"
            SELECT
                COALESCE(SUM(games_played), 0)  AS "total_matches!: i64",
                COALESCE(SUM(wins), 0)           AS "total_wins!: i64",
                COALESCE(SUM(losses), 0)         AS "total_losses!: i64",
                COALESCE(SUM(draws), 0)          AS "total_draws!: i64",
                COALESCE(MAX(win_streak), 0)     AS "current_win_streak!: i32"
            FROM user_elo
            WHERE user_id = $1
            "#,
            user_id
        )
        .fetch_one(&self.db)
        .await
        .map_err(ApiError::database_error)?;

        // Best ever win streak — scan elo_history result sequence
        let best_streak = self.compute_best_win_streak(user_id).await?;

        // Average session seconds from analytics_player_behaviour
        let avg_session: i64 = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(
                (SUM(avg_session_secs * matches_played)::float / NULLIF(SUM(matches_played), 0))::bigint,
                0
            ) AS "avg_secs!: i64"
            FROM analytics_player_behaviour
            WHERE user_id = $1
            "#,
            user_id
        )
        .fetch_one(&self.db)
        .await
        .map_err(ApiError::database_error)?;

        // Favourite game mode = game with most matches in user_elo
        let fav_mode: Option<String> = sqlx::query_scalar!(
            r#"
            SELECT game
            FROM user_elo
            WHERE user_id = $1
            ORDER BY games_played DESC
            LIMIT 1
            "#,
            user_id
        )
        .fetch_optional(&self.db)
        .await
        .map_err(ApiError::database_error)?;

        // Per-mode breakdown
        let win_rate_by_mode = self.get_win_rate_by_mode(user_id, 1).await?;

        let total_matches = totals.total_matches;
        let total_wins = totals.total_wins;
        let overall_win_rate_pct = if total_matches > 0 {
            (total_wins as f64 / total_matches as f64 * 100.0 * 10.0).round() / 10.0
        } else {
            0.0
        };

        Ok(PlayerStatsSummary {
            user_id,
            total_matches,
            total_wins,
            total_losses: totals.total_losses,
            total_draws: totals.total_draws,
            overall_win_rate_pct,
            current_win_streak: totals.current_win_streak,
            best_win_streak: best_streak,
            favorite_game_mode: fav_mode,
            avg_session_secs: avg_session,
            win_rate_by_mode,
        })
    }

    /// Compute the best consecutive win streak from elo_history (ordered chronologically).
    async fn compute_best_win_streak(&self, user_id: Uuid) -> Result<i32, ApiError> {
        // result: 0=win, 1=loss, 2=draw
        let results: Vec<i32> = sqlx::query_scalar!(
            r#"
            SELECT result AS "result!: i32"
            FROM elo_history
            WHERE user_id = $1
            ORDER BY created_at ASC
            "#,
            user_id
        )
        .fetch_all(&self.db)
        .await
        .map_err(ApiError::database_error)?;

        let mut best = 0i32;
        let mut current = 0i32;
        for r in results {
            if r == 0 {
                current += 1;
                if current > best {
                    best = current;
                }
            } else {
                current = 0;
            }
        }
        Ok(best)
    }

    // ── 2. Daily snapshots ────────────────────────────────────────────────────

    /// Returns daily win/loss/draw snapshots for the last `days` calendar days.
    ///
    /// Queries `matches` + `elo_history` to group outcomes by UTC calendar day.
    /// An optional `game_mode` filter narrows results to a single mode.
    pub async fn get_daily_snapshots(
        &self,
        user_id: Uuid,
        days: i32,
        game_mode: Option<&str>,
    ) -> Result<Vec<PlayerStatsSnapshot>, ApiError> {
        // Pull per-day win/loss/draw counts from elo_history joined to matches
        struct DayRow {
            day: DateTime<Utc>,
            game_mode: String,
            wins: i64,
            losses: i64,
            draws: i64,
        }

        let rows = if let Some(gm) = game_mode {
            sqlx::query!(
                r#"
                SELECT
                    date_trunc('day', eh.created_at)                     AS "day!: DateTime<Utc>",
                    m.game_mode                                           AS "game_mode!: String",
                    COUNT(*) FILTER (WHERE eh.result = 0)                AS "wins!: i64",
                    COUNT(*) FILTER (WHERE eh.result = 1)                AS "losses!: i64",
                    COUNT(*) FILTER (WHERE eh.result = 2)                AS "draws!: i64"
                FROM elo_history eh
                JOIN matches m ON eh.match_id = m.id
                WHERE eh.user_id = $1
                  AND m.game_mode = $2
                  AND eh.created_at >= NOW() - ($3 || ' days')::interval
                GROUP BY 1, 2
                ORDER BY 1 DESC
                "#,
                user_id,
                gm,
                days.to_string()
            )
            .fetch_all(&self.db)
            .await
            .map_err(ApiError::database_error)?
            .into_iter()
            .map(|r| DayRow {
                day: r.day,
                game_mode: r.game_mode,
                wins: r.wins,
                losses: r.losses,
                draws: r.draws,
            })
            .collect::<Vec<_>>()
        } else {
            sqlx::query!(
                r#"
                SELECT
                    date_trunc('day', eh.created_at)                     AS "day!: DateTime<Utc>",
                    m.game_mode                                           AS "game_mode!: String",
                    COUNT(*) FILTER (WHERE eh.result = 0)                AS "wins!: i64",
                    COUNT(*) FILTER (WHERE eh.result = 1)                AS "losses!: i64",
                    COUNT(*) FILTER (WHERE eh.result = 2)                AS "draws!: i64"
                FROM elo_history eh
                JOIN matches m ON eh.match_id = m.id
                WHERE eh.user_id = $1
                  AND eh.created_at >= NOW() - ($2 || ' days')::interval
                GROUP BY 1, 2
                ORDER BY 1 DESC
                "#,
                user_id,
                days.to_string()
            )
            .fetch_all(&self.db)
            .await
            .map_err(ApiError::database_error)?
            .into_iter()
            .map(|r| DayRow {
                day: r.day,
                game_mode: r.game_mode,
                wins: r.wins,
                losses: r.losses,
                draws: r.draws,
            })
            .collect::<Vec<_>>()
        };

        // Avg session per day from analytics_player_behaviour (approximated per game_mode)
        let snapshots = rows
            .into_iter()
            .map(|r| {
                let total = r.wins + r.losses + r.draws;
                let win_rate_pct = if total > 0 {
                    (r.wins as f64 / total as f64 * 100.0 * 10.0).round() / 10.0
                } else {
                    0.0
                };
                PlayerStatsSnapshot {
                    user_id,
                    snapshot_date: r.day,
                    game_mode: r.game_mode,
                    wins: r.wins,
                    losses: r.losses,
                    draws: r.draws,
                    matches_played: total,
                    win_rate_pct,
                    avg_session_secs: 0, // enriched below when behaviour data available
                }
            })
            .collect();

        Ok(snapshots)
    }

    // ── 3. Win rate by game mode ───────────────────────────────────────────────

    /// Returns win rate broken down by `game_mode` from `user_elo`.
    /// Modes with fewer than `min_matches` matches are excluded.
    pub async fn get_win_rate_by_mode(
        &self,
        user_id: Uuid,
        min_matches: i64,
    ) -> Result<Vec<WinRateByMode>, ApiError> {
        let rows = sqlx::query!(
            r#"
            SELECT
                game                                                AS "game_mode!: String",
                games_played                                        AS "matches_played!: i32",
                wins                                               AS "wins!: i32",
                losses                                             AS "losses!: i32",
                draws                                              AS "draws!: i32"
            FROM user_elo
            WHERE user_id = $1
              AND games_played >= $2
            ORDER BY games_played DESC
            "#,
            user_id,
            min_matches as i32
        )
        .fetch_all(&self.db)
        .await
        .map_err(ApiError::database_error)?;

        let result = rows
            .into_iter()
            .map(|r| {
                let mp = r.matches_played as i64;
                let w = r.wins as i64;
                let l = r.losses as i64;
                let d = r.draws as i64;
                let win_rate_pct = if mp > 0 {
                    (w as f64 / mp as f64 * 100.0 * 10.0).round() / 10.0
                } else {
                    0.0
                };
                WinRateByMode {
                    game_mode: r.game_mode,
                    matches_played: mp,
                    wins: w,
                    losses: l,
                    draws: d,
                    win_rate_pct,
                }
            })
            .collect();

        Ok(result)
    }

    // ── 4. Head-to-head ───────────────────────────────────────────────────────

    /// Returns the head-to-head record between `player_id` and `opponent_id`.
    ///
    /// Queries `elo_history` where the opponent is the known `opponent_id`
    /// from the player's own history row.
    pub async fn get_head_to_head(
        &self,
        player_id: Uuid,
        opponent_id: Uuid,
    ) -> Result<HeadToHeadRecord, ApiError> {
        let row = sqlx::query!(
            r#"
            SELECT
                COUNT(*)                                    AS "total_matches!: i64",
                COUNT(*) FILTER (WHERE result = 0)          AS "wins!: i64",
                COUNT(*) FILTER (WHERE result = 1)          AS "losses!: i64",
                COUNT(*) FILTER (WHERE result = 2)          AS "draws!: i64",
                MAX(created_at)                             AS "last_played: DateTime<Utc>"
            FROM elo_history
            WHERE user_id     = $1
              AND opponent_id = $2
            "#,
            player_id,
            opponent_id
        )
        .fetch_one(&self.db)
        .await
        .map_err(ApiError::database_error)?;

        if row.total_matches == 0 {
            return Err(ApiError::not_found("No matches found between these players"));
        }

        let win_rate_pct = (row.wins as f64 / row.total_matches as f64 * 100.0 * 10.0).round()
            / 10.0;

        Ok(HeadToHeadRecord {
            player_id,
            opponent_id,
            wins: row.wins,
            losses: row.losses,
            draws: row.draws,
            total_matches: row.total_matches,
            win_rate_pct,
            last_played: row.last_played,
        })
    }

    // ── 5. Batch player stats comparison (Issue #1398) ─────────────────────────

    /// Retrieve the five comparison stats for a batch of player IDs in a single query:
    /// 1. Win rate
    /// 2. Average ELO
    /// 3. Matches played
    /// 4. Tournament wins
    /// 5. Reputation score
    pub async fn get_batch_player_stats(
        &self,
        player_ids: &[Uuid],
    ) -> Result<BatchPlayerStatsResponse, ApiError> {
        let mut players = HashMap::new();
        for &user_id in player_ids {
            let totals = sqlx::query!(
                r#"
                SELECT
                    COALESCE(SUM(games_played), 0)                 AS "total_matches!: i64",
                    COALESCE(SUM(wins), 0)                         AS "total_wins!: i64",
                    COALESCE(AVG(current_rating), 1200.0)::float8  AS "avg_elo!: f64"
                FROM user_elo
                WHERE user_id = $1
                "#,
                user_id
            )
            .fetch_one(&self.db)
            .await
            .map_err(ApiError::database_error)?;

            let win_rate = if totals.total_matches > 0 {
                (totals.total_wins as f64 / totals.total_matches as f64 * 100.0 * 10.0).round()
                    / 10.0
            } else {
                0.0
            };

            let tournament_wins: i64 = sqlx::query_scalar!(
                r#"
                SELECT COALESCE(COUNT(*), 0) AS "wins!: i64"
                FROM tournament_participants
                WHERE user_id = $1 AND final_rank = 1
                "#,
                user_id
            )
            .fetch_one(&self.db)
            .await
            .map_err(ApiError::database_error)?;

            let reputation_score: i32 = sqlx::query_scalar!(
                r#"
                SELECT COALESCE(fair_play_score, 100) AS "score!: i32"
                FROM users
                WHERE id = $1
                "#,
                user_id
            )
            .fetch_optional(&self.db)
            .await
            .map_err(ApiError::database_error)?
            .unwrap_or(100);

            players.insert(
                user_id.to_string(),
                PlayerComparisonStats {
                    player_id: user_id,
                    win_rate,
                    average_elo: totals.avg_elo,
                    matches_played: totals.total_matches,
                    tournament_wins,
                    reputation_score,
                },
            );
        }

        Ok(BatchPlayerStatsResponse { players })
    }

    // ── 6. Inactivity ELO decay persistence & ranked-match reset (Issue #1533) ─

    /// Scan `user_elo` rows with at least one unapplied 7-day decay interval
    /// past the 30-day grace period, evaluate pure decay math, and persist new
    /// ratings using an optimistic CAS predicate so concurrent ranked matches
    /// or multi-replica sweeps can never clobber post-match ratings.
    pub async fn apply_inactivity_elo_decay(
        &self,
        now: DateTime<Utc>,
        config: &EloDecayConfig,
    ) -> Result<DecaySweepBatch, ApiError> {
        if !config.is_valid() {
            return Ok(DecaySweepBatch::default());
        }

        let Some(min_inactive_days) = config
            .grace_period_days
            .checked_add(config.interval_days)
            .and_then(chrono::Duration::try_days)
        else {
            return Ok(DecaySweepBatch::default());
        };
        let cutoff = now - min_inactive_days;

        #[derive(sqlx::FromRow)]
        struct CandidateRow {
            id: Uuid,
            user_id: Uuid,
            game: String,
            current_rating: i32,
            last_ranked_match_at: DateTime<Utc>,
            last_decay_at: Option<DateTime<Utc>>,
            decay_intervals_applied: i32,
            decay_notified: bool,
        }

        // Uses exact 86,400-second day math in `bigint` (matching `elo_decay.rs`
        // with zero `int4` overflow or session-timezone DST drift) and bounds each
        // sweep with `LIMIT` so initial backfills never starve the Reaper loop.
        let candidates = sqlx::query_as::<_, CandidateRow>(
            r#"
            SELECT
                id,
                user_id,
                game,
                current_rating,
                last_ranked_match_at,
                last_decay_at,
                decay_intervals_applied,
                decay_notified
            FROM user_elo
            WHERE user_id IS NOT NULL
              AND last_ranked_match_at IS NOT NULL
              AND last_ranked_match_at <= $1
              AND current_rating > $2
              AND EXTRACT(EPOCH FROM ($5 - last_ranked_match_at))
                  >= ($3::numeric + $4::numeric * (GREATEST(decay_intervals_applied, 0)::numeric + 1)) * 86400
            ORDER BY last_ranked_match_at ASC
            LIMIT $6
            "#,
        )
        .bind(cutoff)
        .bind(config.floor_elo)
        .bind(config.grace_period_days)
        .bind(config.interval_days)
        .bind(now)
        .bind(crate::service::elo_decay::DEFAULT_DECAY_SWEEP_BATCH_SIZE)
        .fetch_all(&self.db)
        .await
        .map_err(ApiError::database_error)?;

        let candidates_scanned = candidates.len();
        let mut applied = Vec::new();

        for row in candidates {
            let state = PlayerDecayState {
                user_elo_id: row.id,
                user_id: row.user_id,
                game: row.game.clone(),
                current_rating: row.current_rating,
                last_ranked_match_at: row.last_ranked_match_at,
                last_decay_at: row.last_decay_at,
                decay_intervals_applied: row.decay_intervals_applied,
                decay_notified: row.decay_notified,
            };

            let eval = evaluate_player_decay(&state, now, config);
            if eval.actual_deduction <= 0 {
                continue;
            }

            // Optimistic CAS guard: if a concurrent ranked match or another
            // replica modified this row since SELECT, rows_affected() == 0 and
            // we skip without overwriting or emitting a false notification.
            let res = sqlx::query(
                r#"
                UPDATE user_elo
                SET current_rating          = $1,
                    last_decay_at           = $2,
                    decay_intervals_applied = $3
                WHERE id = $4
                  AND current_rating = $5
                  AND decay_intervals_applied = $6
                  AND last_ranked_match_at = $7
                "#,
            )
            .bind(eval.new_rating)
            .bind(now)
            .bind(eval.new_intervals_applied)
            .bind(row.id)
            .bind(row.current_rating)
            .bind(row.decay_intervals_applied)
            .bind(row.last_ranked_match_at)
            .execute(&self.db)
            .await;

            match res {
                Ok(done) if done.rows_affected() == 1 => {
                    applied.push(AppliedEloDecay {
                        user_elo_id: row.id,
                        user_id: row.user_id,
                        game: row.game,
                        previous_rating: eval.previous_rating,
                        new_rating: eval.new_rating,
                        points_deducted: eval.actual_deduction,
                        intervals_applied: eval.new_intervals_applied,
                        last_decay_at: now,
                        should_notify_first_decay: eval.should_notify_first_decay,
                    });
                }
                Ok(_) => {
                    tracing::debug!(
                        user_elo_id = %row.id,
                        user_id = %row.user_id,
                        "Skipped ELO decay CAS update due to concurrent row modification"
                    );
                }
                Err(e) => {
                    // Isolate per-row DB errors so already-committed rows still
                    // receive notifications and leaderboard synchronization.
                    tracing::warn!(
                        user_elo_id = %row.id,
                        user_id = %row.user_id,
                        error = %e,
                        "Failed to persist ELO decay for row; continuing sweep"
                    );
                }
            }
        }

        Ok(DecaySweepBatch {
            candidates_scanned,
            applied,
        })
    }

    /// Find decayed rows whose first-decay push notification was not yet marked
    /// delivered (for example after a transient delivery failure or crash),
    /// including rows that hit the 100-ELO floor on their first deduction.
    pub async fn find_pending_first_decay_notifications(
        &self,
    ) -> Result<Vec<PendingDecayNotification>, ApiError> {
        #[derive(sqlx::FromRow)]
        struct PendingRow {
            id: Uuid,
            user_id: Uuid,
            game: String,
            current_rating: i32,
            last_decay_at: DateTime<Utc>,
        }

        let rows = sqlx::query_as::<_, PendingRow>(
            r#"
            SELECT id, user_id, game, current_rating, last_decay_at
            FROM user_elo
            WHERE user_id IS NOT NULL
              AND last_decay_at IS NOT NULL
              AND decay_intervals_applied > 0
              AND decay_notified = FALSE
            ORDER BY last_decay_at ASC
            LIMIT $1
            "#,
        )
        .bind(crate::service::elo_decay::DEFAULT_DECAY_SWEEP_BATCH_SIZE)
        .fetch_all(&self.db)
        .await
        .map_err(ApiError::database_error)?;

        Ok(rows
            .into_iter()
            .map(|r| PendingDecayNotification {
                user_elo_id: r.id,
                user_id: r.user_id,
                game: r.game,
                current_rating: r.current_rating,
                last_decay_at: r.last_decay_at,
            })
            .collect())
    }

    /// Record that the first-decay push notification has been delivered for
    /// this inactivity spell. Guarded by `last_decay_at` so a concurrent ranked
    /// match reset cannot be overwritten by a late notification callback.
    pub async fn mark_decay_notified(
        &self,
        user_elo_id: Uuid,
        expected_last_decay_at: DateTime<Utc>,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE user_elo
            SET decay_notified = TRUE
            WHERE id = $1
              AND decay_intervals_applied > 0
              AND last_decay_at = $2
            "#,
        )
        .bind(user_elo_id)
        .bind(expected_last_decay_at)
        .execute(&self.db)
        .await
        .map_err(ApiError::database_error)?;
        Ok(())
    }

    /// Pool-level helper so match completion paths (`MatchService`, `EloEngine`,
    /// `ReaperService` ranked forfeits/byes) can monotonically reset inactivity
    /// tracking without duplicating SQL.
    pub async fn reset_inactivity_timer_with_pool(
        db: &PgPool,
        user_id: Uuid,
        game: &str,
        match_completed_at: DateTime<Utc>,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE user_elo
            SET last_ranked_match_at    = $1,
                last_decay_at           = NULL,
                decay_intervals_applied = 0,
                decay_notified          = FALSE
            WHERE user_id = $2
              AND game = $3
              AND (last_ranked_match_at IS NULL OR last_ranked_match_at <= $1)
            "#,
        )
        .bind(match_completed_at)
        .bind(user_id)
        .bind(game)
        .execute(db)
        .await
        .map_err(ApiError::database_error)?;
        Ok(())
    }
}
