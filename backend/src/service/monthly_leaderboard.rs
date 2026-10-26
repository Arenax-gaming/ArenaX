//! Monthly leaderboard backed by Redis sorted sets (Issue #1226).
//!
//! Scores are recorded into a weekly sorted set scoped to the current month
//! (`leaderboard:weekly:{YYYY-MM}:W{ww}`), so a week spanning two months is
//! split cleanly. Completed weeks are rolled into the monthly set
//! (`leaderboard:monthly:{YYYY-MM}`) by `rollup_completed_weeks`, which runs
//! periodically. Reads merge the monthly set with the in-progress week so
//! rankings stay real-time. Before each rollup the current ranks are
//! snapshotted so responses can report a rank change indicator.

use chrono::{DateTime, Datelike, Duration, Utc};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::Serialize;

const LIVE_TTL_SECS: i64 = 5;

#[derive(Debug, Clone, Serialize)]
pub struct MonthlyLeaderboardEntry {
    pub rank: u64,
    pub player_id: String,
    pub score: f64,
    /// Positions gained (positive) or lost (negative) since the last rollup;
    /// `None` when the player was not ranked at that point.
    pub rank_change: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MonthlyLeaderboard {
    pub period: &'static str,
    pub month: String,
    pub entries: Vec<MonthlyLeaderboardEntry>,
}

pub struct MonthlyLeaderboardService {
    redis: ConnectionManager,
}

fn month_id(at: DateTime<Utc>) -> String {
    format!("{:04}-{:02}", at.year(), at.month())
}

fn monthly_key(month: &str) -> String {
    format!("leaderboard:monthly:{}", month)
}

fn weeks_key(month: &str) -> String {
    format!("leaderboard:monthly:{}:weeks", month)
}

fn prev_ranks_key(month: &str) -> String {
    format!("leaderboard:monthly:{}:prev_ranks", month)
}

fn live_key(month: &str) -> String {
    format!("leaderboard:monthly:{}:live", month)
}

fn weekly_key(at: DateTime<Utc>) -> String {
    format!(
        "leaderboard:weekly:{}:W{:02}",
        month_id(at),
        at.iso_week().week()
    )
}

impl MonthlyLeaderboardService {
    pub fn new(redis: ConnectionManager) -> Self {
        Self { redis }
    }

    /// Add `points` to the player's score for the current week.
    pub async fn record_score(&self, player_id: &str, points: f64) -> redis::RedisResult<()> {
        let now = Utc::now();
        let week = weekly_key(now);
        let mut conn = self.redis.clone();
        redis::pipe()
            .zincr(&week, player_id, points)
            .ignore()
            .sadd(weeks_key(&month_id(now)), &week)
            .ignore()
            .query_async(&mut conn)
            .await
    }

    /// Roll every completed week of the current and previous month into its
    /// monthly set. Safe to call repeatedly: each week is rolled exactly once.
    pub async fn rollup_completed_weeks(&self) -> redis::RedisResult<usize> {
        let now = Utc::now();
        let current_week = weekly_key(now);
        let first_of_month = now - Duration::days(now.day0() as i64);
        let previous_month = month_id(first_of_month - Duration::days(1));

        let mut rolled = 0;
        for month in [previous_month, month_id(now)] {
            let mut conn = self.redis.clone();
            let weeks: Vec<String> = conn.smembers(weeks_key(&month)).await?;
            for week in weeks.into_iter().filter(|w| *w != current_week) {
                self.snapshot_ranks(&month).await?;
                let monthly = monthly_key(&month);
                redis::pipe()
                    .atomic()
                    .zunionstore(&monthly, &[&monthly, &week])
                    .ignore()
                    .srem(weeks_key(&month), &week)
                    .ignore()
                    .del(&week)
                    .ignore()
                    .query_async::<()>(&mut conn)
                    .await?;
                rolled += 1;
            }
        }
        Ok(rolled)
    }

    /// Current monthly standings, including the in-progress week.
    pub async fn get_monthly(&self, limit: isize) -> redis::RedisResult<MonthlyLeaderboard> {
        let now = Utc::now();
        let month = month_id(now);
        let live = live_key(&month);
        let mut conn = self.redis.clone();

        let pending: Vec<String> = conn.smembers(weeks_key(&month)).await?;
        let mut sources = vec![monthly_key(&month)];
        sources.extend(pending);
        redis::pipe()
            .zunionstore(&live, &sources)
            .ignore()
            .expire(&live, LIVE_TTL_SECS)
            .ignore()
            .query_async::<()>(&mut conn)
            .await?;

        let rows: Vec<(String, f64)> = conn.zrevrange_withscores(&live, 0, limit - 1).await?;
        let prev: Vec<Option<i64>> = if rows.is_empty() {
            Vec::new()
        } else {
            let ids: Vec<&str> = rows.iter().map(|(id, _)| id.as_str()).collect();
            redis::cmd("HMGET")
                .arg(prev_ranks_key(&month))
                .arg(&ids)
                .query_async(&mut conn)
                .await?
        };

        let entries = rows
            .into_iter()
            .enumerate()
            .map(|(i, (player_id, score))| {
                let rank = i as u64 + 1;
                MonthlyLeaderboardEntry {
                    rank,
                    player_id,
                    score,
                    rank_change: prev.get(i).copied().flatten().map(|p| p - rank as i64),
                }
            })
            .collect();

        Ok(MonthlyLeaderboard {
            period: "monthly",
            month,
            entries,
        })
    }

    /// Store each player's current monthly rank for rank change indicators.
    async fn snapshot_ranks(&self, month: &str) -> redis::RedisResult<()> {
        let mut conn = self.redis.clone();
        let ids: Vec<String> = conn.zrevrange(monthly_key(month), 0, -1).await?;
        if ids.is_empty() {
            return Ok(());
        }
        let ranks: Vec<(String, i64)> = ids
            .into_iter()
            .enumerate()
            .map(|(i, id)| (id, i as i64 + 1))
            .collect();
        let key = prev_ranks_key(month);
        redis::pipe()
            .atomic()
            .del(&key)
            .ignore()
            .hset_multiple(&key, &ranks)
            .ignore()
            .query_async(&mut conn)
            .await
    }
}
