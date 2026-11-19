//! Weekly leaderboard backed by a Redis sorted set (Issue #1225), including
//! the automated season rollover with prize distribution (Issue #1572).
//!
//! Each ISO week gets its own key (`leaderboard:weekly:<year>-W<week>`) so
//! rankings reset automatically; keys expire two weeks after creation.
//!
//! # Weekly rollover (Issue #1572)
//!
//! `run_weekly_rollover` snapshots the final standings for the current
//! week, distributes prizes to the top N players via
//! `RewardSettlementService`, notifies every recipient, and publishes a
//! `WeeklyRolloverSummary` event through `LeaderboardSync`. It is
//! idempotent per ISO week — guarded by a Redis `SET ... NX`, so calling it
//! again for a week that already rolled over is a no-op that returns
//! `Ok(None)`. `spawn_weekly_rollover_worker` schedules it to run
//! automatically every Sunday at 23:59 UTC.

use crate::service::leaderboard_sync::LeaderboardSync;
use crate::service::notification_service::{NewNotification, NotificationService};
use crate::service::reward_settlement_service::RewardSettlementService;
use chrono::{DateTime, Datelike, Timelike, Utc, Weekday};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

pub const WIN_POINTS: i64 = 3;
pub const DRAW_POINTS: i64 = 1;
const KEY_TTL_SECONDS: i64 = 14 * 24 * 60 * 60;

/// Asset weekly prizes are settled in.
pub const PRIZE_ASSET: &str = "XLM";
/// Fixed prize table for the top finishers, indexed by `rank - 1`. Amounts
/// are plain integer strings in the smallest unit the settlement contract
/// expects (matching `RewardSettlement`'s existing convention). A rank
/// beyond this table receives no prize.
pub const PRIZE_TABLE: [&str; 5] = ["500", "300", "200", "100", "50"];
/// TTL for the per-week rollover idempotency guard — comfortably longer
/// than a week so a delayed retry within the same week never double-runs.
const ROLLOVER_GUARD_TTL_SECS: i64 = 21 * 24 * 60 * 60;

#[derive(Debug, Clone, Serialize)]
pub struct WeeklyLeaderboardEntry {
    pub rank: i64,
    pub user_id: String,
    pub score: i64,
}

/// A single prize awarded during a weekly rollover.
#[derive(Debug, Clone, Serialize)]
pub struct PrizeAward {
    pub rank: i64,
    pub user_id: String,
    pub amount: String,
    pub asset: String,
}

/// Summary of one week's rollover: the final standings snapshot plus every
/// prize awarded. Published as the `weekly results summary event`.
#[derive(Debug, Clone, Serialize)]
pub struct WeeklyRolloverSummary {
    pub week_key: String,
    pub standings: Vec<WeeklyLeaderboardEntry>,
    pub prizes: Vec<PrizeAward>,
    pub rolled_over_at: DateTime<Utc>,
}

/// Sorted-set key for the current ISO week.
pub fn current_week_key() -> String {
    let week = Utc::now().iso_week();
    format!("leaderboard:weekly:{}-W{:02}", week.year(), week.week())
}

/// Adds `points` to a player's score for the current week.
pub async fn record_points<C: redis::aio::ConnectionLike + Send>(
    conn: &mut C,
    user_id: Uuid,
    points: i64,
) -> redis::RedisResult<()> {
    let key = current_week_key();
    let _: f64 = conn.zincr(&key, user_id.to_string(), points).await?;
    let _: bool = conn.expire(&key, KEY_TTL_SECONDS).await?;
    Ok(())
}

/// Returns one page of the current week's rankings plus the total player count.
pub async fn top_players<C: redis::aio::ConnectionLike + Send>(
    conn: &mut C,
    limit: i64,
    offset: i64,
) -> redis::RedisResult<(Vec<WeeklyLeaderboardEntry>, i64)> {
    let key = current_week_key();
    let total: i64 = conn.zcard(&key).await?;
    let stop = (offset + limit - 1) as isize;
    let rows: Vec<(String, i64)> = conn
        .zrevrange_withscores(&key, offset as isize, stop)
        .await?;

    let entries = rows
        .into_iter()
        .enumerate()
        .map(|(i, (user_id, score))| WeeklyLeaderboardEntry {
            rank: offset + i as i64 + 1,
            user_id,
            score,
        })
        .collect();

    Ok((entries, total))
}

fn rollover_guard_key(week_key: &str) -> String {
    format!("{}:rollover_done", week_key)
}

/// True at the scheduled weekly rollover moment — every Sunday at 23:59
/// UTC. `spawn_weekly_rollover_worker` polls this on a short interval so it
/// reliably lands within that one-minute window.
pub fn is_rollover_moment(now: DateTime<Utc>) -> bool {
    now.weekday() == Weekday::Sun && now.hour() == 23 && now.minute() == 59
}

/// Run the weekly season rollover: snapshot the final standings for the
/// current week, distribute prizes to the top finishers via
/// `RewardSettlementService`, notify every recipient, and publish a
/// `WeeklyRolloverSummary` event through `LeaderboardSync`.
///
/// Idempotent per ISO week: guarded by a Redis `SET ... NX` on
/// `{week_key}:rollover_done`. Calling this again for a week that already
/// rolled over returns `Ok(None)` and performs no further writes.
pub async fn run_weekly_rollover(
    redis: &mut ConnectionManager,
    reward_settlement: &RewardSettlementService,
    notifications: &NotificationService,
    leaderboard_sync: &LeaderboardSync,
    top_n: i64,
) -> Result<Option<WeeklyRolloverSummary>, String> {
    let week_key = current_week_key();
    let guard_key = rollover_guard_key(&week_key);

    // Idempotency: only the first caller for this week proceeds; every
    // later call (a retried tick, a redundant restart) is a safe no-op.
    let acquired: Option<String> = redis::cmd("SET")
        .arg(&guard_key)
        .arg("1")
        .arg("NX")
        .arg("EX")
        .arg(ROLLOVER_GUARD_TTL_SECS)
        .query_async(redis)
        .await
        .map_err(|e| e.to_string())?;

    if acquired.is_none() {
        return Ok(None);
    }

    // Snapshot the final standings before anything resets.
    let (standings, _total) = top_players(redis, top_n, 0)
        .await
        .map_err(|e| e.to_string())?;

    // Distribute prizes to the top finishers and notify each recipient.
    let mut prizes = Vec::with_capacity(standings.len());
    for entry in &standings {
        let Some(amount) = PRIZE_TABLE.get((entry.rank - 1) as usize) else {
            continue;
        };
        let amount = amount.to_string();

        if let Err(e) = reward_settlement
            .settle_weekly_prize(&week_key, entry.rank, &entry.user_id, &amount, PRIZE_ASSET)
            .await
        {
            tracing::warn!(
                week = %week_key,
                user_id = %entry.user_id,
                rank = entry.rank,
                error = %e,
                "Weekly prize settlement failed"
            );
        }

        match Uuid::parse_str(&entry.user_id) {
            Ok(user_uuid) => {
                let notify = notifications
                    .create_and_fan_out(NewNotification {
                        user_id: user_uuid,
                        typ: "weekly_leaderboard_prize".to_string(),
                        title: "Weekly leaderboard results".to_string(),
                        message: format!(
                            "You finished #{} this week and won {} {}!",
                            entry.rank, amount, PRIZE_ASSET
                        ),
                        link: None,
                        link_label: None,
                    })
                    .await;
                if let Err(e) = notify {
                    tracing::warn!(
                        week = %week_key,
                        user_id = %entry.user_id,
                        error = %e,
                        "Failed to notify weekly prize recipient"
                    );
                }
            }
            Err(e) => {
                tracing::warn!(
                    week = %week_key,
                    user_id = %entry.user_id,
                    error = %e,
                    "Weekly prize recipient has a non-UUID user id; skipping notification"
                );
            }
        }

        prizes.push(PrizeAward {
            rank: entry.rank,
            user_id: entry.user_id.clone(),
            amount,
            asset: PRIZE_ASSET.to_string(),
        });
    }

    let summary = WeeklyRolloverSummary {
        week_key: week_key.clone(),
        standings,
        prizes,
        rolled_over_at: Utc::now(),
    };

    if let Err(e) = leaderboard_sync.publish_weekly_summary(&summary).await {
        tracing::warn!(
            week = %week_key,
            error = %e,
            "Failed to publish weekly rollover summary event"
        );
    }

    Ok(Some(summary))
}

/// Spawn a background worker that calls `run_weekly_rollover` automatically
/// every Sunday at 23:59 UTC.
///
/// Ticks every 15 seconds so the ~60s rollover window is reliably hit; the
/// Redis idempotency guard inside `run_weekly_rollover` makes repeated ticks
/// within that window (or a restart-driven re-check) safe no-ops.
pub fn spawn_weekly_rollover_worker(
    mut redis: ConnectionManager,
    reward_settlement: Arc<RewardSettlementService>,
    notifications: Arc<NotificationService>,
    leaderboard_sync: Arc<LeaderboardSync>,
    top_n: i64,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            ticker.tick().await;
            if !is_rollover_moment(Utc::now()) {
                continue;
            }
            match run_weekly_rollover(
                &mut redis,
                &reward_settlement,
                &notifications,
                &leaderboard_sync,
                top_n,
            )
            .await
            {
                Ok(Some(summary)) => {
                    tracing::info!(
                        week = %summary.week_key,
                        prizes = summary.prizes.len(),
                        "Weekly leaderboard rollover completed"
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    tracing::warn!(%error, "Weekly leaderboard rollover failed");
                }
            }
        }
    })
}

#[cfg(test)]
mod rollover_tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn rollover_moment_is_sunday_23_59_utc() {
        let sunday_2359 = Utc.with_ymd_and_hms(2024, 1, 7, 23, 59, 0).unwrap();
        assert!(is_rollover_moment(sunday_2359));
    }

    #[test]
    fn rollover_moment_excludes_other_times() {
        let sunday_2358 = Utc.with_ymd_and_hms(2024, 1, 7, 23, 58, 0).unwrap();
        assert!(!is_rollover_moment(sunday_2358));

        let monday_2359 = Utc.with_ymd_and_hms(2024, 1, 8, 23, 59, 0).unwrap();
        assert!(!is_rollover_moment(monday_2359));
    }

    #[test]
    fn guard_key_is_scoped_per_week() {
        assert_eq!(
            rollover_guard_key("leaderboard:weekly:2024-W01"),
            "leaderboard:weekly:2024-W01:rollover_done"
        );
    }

    #[test]
    fn prize_table_has_no_zero_amounts() {
        assert!(PRIZE_TABLE.iter().all(|amount| *amount != "0"));
    }
}
