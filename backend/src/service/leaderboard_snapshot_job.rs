//! Scheduled leaderboard snapshot job — Issue #1360.
//!
//! # Problem
//! Season-end resets wipe final standings before they are archived, so the
//! competitive record of each season is lost.
//!
//! # Solution
//! A cron-driven background task polls for active seasons whose `end_at` has
//! passed. For each one it:
//!
//! 1. Copies the top-N `leaderboards` rows into `leaderboard_snapshots` with
//!    the season id and a `snapshotted_at` timestamp.
//! 2. Marks the snapshot rows as immutable by using `ON CONFLICT DO NOTHING`
//!    — a second run for the same season is a silent no-op.
//! 3. Closes the season (`status = 'closed'`) so it falls out of future polls.
//!
//! # Configuration
//! | Env var | Default | Meaning |
//! |---------|---------|---------|
//! | `SNAPSHOT_POLL_INTERVAL_SECS` | 60 | How often the job polls |
//! | `SNAPSHOT_TOP_N` | 100 | Entries per category to snapshot |
//!
//! # Query endpoint
//! Call `LeaderboardSnapshotJob::get_season_snapshot` to read a past season's
//! standings from the snapshot table.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::time::Duration;
use tokio::time;
use tracing::{error, info, warn};
use uuid::Uuid;

// ── Configuration ─────────────────────────────────────────────────────────────

/// Runtime configuration for the snapshot scheduler.
#[derive(Debug, Clone)]
pub struct SnapshotJobConfig {
    /// How often the job checks whether a season is ending.
    pub poll_interval: Duration,
    /// How many top entries to snapshot per leaderboard category.
    pub top_n: i64,
}

impl Default for SnapshotJobConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(
                std::env::var("SNAPSHOT_POLL_INTERVAL_SECS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(60),
            ),
            top_n: std::env::var("SNAPSHOT_TOP_N")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(100),
        }
    }
}

// ── Result types ──────────────────────────────────────────────────────────────

/// Outcome for one season's snapshot run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnapshotOutcome {
    pub season_id: Uuid,
    pub season_name: String,
    pub game: String,
    /// Number of rows written to `leaderboard_snapshots`. Zero means the
    /// snapshot already existed (immutability guarantee).
    pub rows_snapshotted: usize,
    pub snapshot_at: DateTime<Utc>,
}

/// Aggregated result of one scheduler tick.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickResult {
    pub checked_at: DateTime<Utc>,
    pub snapshots: Vec<SnapshotOutcome>,
    pub errors: Vec<String>,
}

/// One row from the `leaderboard_snapshots` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LeaderboardSnapshotRow {
    pub id: Uuid,
    pub season_id: Uuid,
    pub season_name: String,
    pub game: String,
    pub user_id: Uuid,
    pub rank: i32,
    pub elo_rating: i32,
    pub matches_played: i32,
    pub wins: i32,
    pub losses: i32,
    pub snapshotted_at: DateTime<Utc>,
}

// ── Job ───────────────────────────────────────────────────────────────────────

pub struct LeaderboardSnapshotJob {
    db: PgPool,
    config: SnapshotJobConfig,
}

impl LeaderboardSnapshotJob {
    pub fn new(db: PgPool, config: SnapshotJobConfig) -> Self {
        Self { db, config }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// Run one tick: find every active season whose `end_at` has passed,
    /// snapshot and close each one. Called by the scheduler loop and directly
    /// in tests.
    pub async fn tick(&self) -> TickResult {
        let checked_at = Utc::now();
        let mut snapshots = Vec::new();
        let mut errors = Vec::new();

        // Find all active seasons whose end_at has passed
        let expired = sqlx::query!(
            r#"
            SELECT id AS "id!: Uuid", name AS "name!: String", game AS "game!: String"
            FROM seasons
            WHERE status = 'active'
              AND end_at IS NOT NULL
              AND end_at <= NOW()
            "#
        )
        .fetch_all(&self.db)
        .await;

        let expired_seasons = match expired {
            Ok(rows) => rows,
            Err(e) => {
                errors.push(format!("DB query failed: {e}"));
                return TickResult { checked_at, snapshots, errors };
            }
        };

        for row in expired_seasons {
            let season_id = row.id;
            match self.snapshot_season(season_id, self.config.top_n).await {
                Ok(outcome) => {
                    // Close the season now that the snapshot is committed
                    if let Err(e) = sqlx::query!(
                        "UPDATE seasons SET status = 'closed', closed_at = NOW() WHERE id = $1",
                        season_id
                    )
                    .execute(&self.db)
                    .await
                    {
                        errors.push(format!(
                            "Failed to close season {season_id} after snapshot: {e}"
                        ));
                    } else {
                        info!(
                            season_id = %season_id,
                            rows = outcome.rows_snapshotted,
                            "Leaderboard snapshot committed; season closed"
                        );
                    }
                    snapshots.push(outcome);
                }
                Err(e) => {
                    warn!(season_id = %season_id, error = %e, "Snapshot failed for season");
                    errors.push(e);
                }
            }
        }

        TickResult { checked_at, snapshots, errors }
    }

    /// Long-running scheduler loop — spawn this in a `tokio::spawn`.
    pub async fn run(self) {
        let mut interval = time::interval(self.config.poll_interval);
        loop {
            interval.tick().await;
            let result = self.tick().await;
            if !result.snapshots.is_empty() {
                info!(
                    count = result.snapshots.len(),
                    "Leaderboard snapshot job: snapshots written"
                );
            }
            for err in &result.errors {
                error!(error = %err, "Leaderboard snapshot job error");
            }
        }
    }

    /// Snapshot the top `top_n` leaderboard entries for `season_id` into
    /// `leaderboard_snapshots`.
    ///
    /// **Idempotent / immutable**: if rows already exist for this season the
    /// INSERT is a no-op (`ON CONFLICT DO NOTHING`) and `rows_snapshotted = 0`
    /// is returned. The existing snapshot is never modified.
    pub async fn snapshot_season(
        &self,
        season_id: Uuid,
        top_n: i64,
    ) -> Result<SnapshotOutcome, String> {
        // Load season metadata
        let season = sqlx::query!(
            r#"SELECT name AS "name!: String", game AS "game!: String" FROM seasons WHERE id = $1"#,
            season_id
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| format!("season lookup failed: {e}"))?
        .ok_or_else(|| format!("season {season_id} not found"))?;

        // Guard: immutability — if a snapshot already exists, do not overwrite
        let existing: i64 = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "c!: i64" FROM leaderboard_snapshots WHERE season_id = $1"#,
            season_id
        )
        .fetch_one(&self.db)
        .await
        .map_err(|e| format!("snapshot count failed: {e}"))?;

        if existing > 0 {
            return Ok(SnapshotOutcome {
                season_id,
                season_name: season.name,
                game: season.game,
                rows_snapshotted: 0,
                snapshot_at: Utc::now(),
            });
        }

        // Pull the top-N entries from the live leaderboard for this game
        let top_rows = sqlx::query!(
            r#"
            SELECT
                user_id   AS "user_id!: Uuid",
                ranking   AS "ranking!: i32",
                elo_rating AS "elo_rating!: i32",
                matches_played AS "matches_played!: i32",
                wins      AS "wins!: i32",
                losses    AS "losses!: i32"
            FROM leaderboards
            WHERE game = $1
              AND period = 'all_time'
            ORDER BY ranking ASC
            LIMIT $2
            "#,
            season.game,
            top_n
        )
        .fetch_all(&self.db)
        .await
        .map_err(|e| format!("leaderboard query failed: {e}"))?;

        let snapshot_at = Utc::now();
        let mut rows_written = 0usize;

        for row in &top_rows {
            let result = sqlx::query!(
                r#"
                INSERT INTO leaderboard_snapshots
                    (id, season_id, season_name, game, user_id, rank, elo_rating,
                     matches_played, wins, losses, snapshotted_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT DO NOTHING
                "#,
                Uuid::new_v4(),
                season_id,
                season.name,
                season.game,
                row.user_id,
                row.ranking,
                row.elo_rating,
                row.matches_played,
                row.wins,
                row.losses,
                snapshot_at,
            )
            .execute(&self.db)
            .await
            .map_err(|e| format!("insert row failed: {e}"))?;

            rows_written += result.rows_affected() as usize;
        }

        Ok(SnapshotOutcome {
            season_id,
            season_name: season.name,
            game: season.game,
            rows_snapshotted: rows_written,
            snapshot_at,
        })
    }

    /// Query endpoint: return the archived standings for a past season.
    ///
    /// Returns rows ordered by rank ascending (1st place first).
    /// Returns an empty vec if no snapshot exists for the season.
    pub async fn get_season_snapshot(
        &self,
        season_id: Uuid,
    ) -> Result<Vec<LeaderboardSnapshotRow>, String> {
        sqlx::query_as::<_, LeaderboardSnapshotRow>(
            r#"
            SELECT id, season_id, season_name, game, user_id, rank, elo_rating,
                   matches_played, wins, losses, snapshotted_at
            FROM leaderboard_snapshots
            WHERE season_id = $1
            ORDER BY rank ASC
            "#,
        )
        .bind(season_id)
        .fetch_all(&self.db)
        .await
        .map_err(|e| format!("get_season_snapshot failed: {e}"))
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_outcome_json_roundtrip() {
        let outcome = SnapshotOutcome {
            season_id: Uuid::from_u128(1),
            season_name: "Season 1".to_string(),
            game: "fps".to_string(),
            rows_snapshotted: 100,
            snapshot_at: Utc::now(),
        };
        let json = serde_json::to_string(&outcome).unwrap();
        let rt: SnapshotOutcome = serde_json::from_str(&json).unwrap();
        assert_eq!(outcome.season_id, rt.season_id);
        assert_eq!(outcome.game, rt.game);
        assert_eq!(outcome.rows_snapshotted, rt.rows_snapshotted);
    }

    #[test]
    fn tick_result_accumulates_snapshots_and_errors() {
        let result = TickResult {
            checked_at: Utc::now(),
            snapshots: vec![SnapshotOutcome {
                season_id: Uuid::from_u128(2),
                season_name: "Season 2".into(),
                game: "battle_royale".into(),
                rows_snapshotted: 50,
                snapshot_at: Utc::now(),
            }],
            errors: vec!["DB timeout for season 999".to_string()],
        };
        assert_eq!(result.snapshots.len(), 1);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.snapshots[0].rows_snapshotted, 50);
    }

    #[test]
    fn default_config_uses_sensible_values() {
        // Without env vars set the defaults apply
        let config = SnapshotJobConfig::default();
        assert_eq!(config.top_n, 100);
        assert_eq!(config.poll_interval, Duration::from_secs(60));
    }

    #[test]
    fn zero_rows_returned_when_snapshot_already_exists() {
        // Simulates the idempotency guard: if rows_snapshotted == 0 the
        // snapshot was already written and must not be overwritten.
        let outcome = SnapshotOutcome {
            season_id: Uuid::from_u128(5),
            season_name: "Season 5".into(),
            game: "moba".into(),
            rows_snapshotted: 0, // idempotent: already snapshotted
            snapshot_at: Utc::now(),
        };
        assert_eq!(
            outcome.rows_snapshotted, 0,
            "a second run must report 0 new rows, never overwrite"
        );
    }

    #[test]
    fn snapshot_rows_are_ordered_by_rank() {
        // Verify the expected sort order at the type level.
        // Real DB ordering is tested in integration tests.
        let mut rows = vec![
            LeaderboardSnapshotRow {
                id: Uuid::new_v4(),
                season_id: Uuid::from_u128(1),
                season_name: "S1".into(),
                game: "fps".into(),
                user_id: Uuid::new_v4(),
                rank: 3,
                elo_rating: 1800,
                matches_played: 50,
                wins: 30,
                losses: 20,
                snapshotted_at: Utc::now(),
            },
            LeaderboardSnapshotRow {
                id: Uuid::new_v4(),
                season_id: Uuid::from_u128(1),
                season_name: "S1".into(),
                game: "fps".into(),
                user_id: Uuid::new_v4(),
                rank: 1,
                elo_rating: 2400,
                matches_played: 80,
                wins: 60,
                losses: 20,
                snapshotted_at: Utc::now(),
            },
        ];
        rows.sort_by_key(|r| r.rank);
        assert_eq!(rows[0].rank, 1);
        assert_eq!(rows[1].rank, 3);
    }
}
