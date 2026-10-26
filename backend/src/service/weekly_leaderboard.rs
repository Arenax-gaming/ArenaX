//! Weekly leaderboard backed by a Redis sorted set (Issue #1225).
//!
//! Each ISO week gets its own key (`leaderboard:weekly:<year>-W<week>`) so
//! rankings reset automatically; keys expire two weeks after creation.

use chrono::{Datelike, Utc};
use redis::AsyncCommands;
use serde::Serialize;
use uuid::Uuid;

pub const WIN_POINTS: i64 = 3;
pub const DRAW_POINTS: i64 = 1;
const KEY_TTL_SECONDS: i64 = 14 * 24 * 60 * 60;

#[derive(Debug, Clone, Serialize)]
pub struct WeeklyLeaderboardEntry {
    pub rank: i64,
    pub user_id: String,
    pub score: i64,
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
