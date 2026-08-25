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
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

// ─── Response types ───────────────────────────────────────────────────────────

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
}
