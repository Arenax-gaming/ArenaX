use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, NaiveDate, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardEntry {
    pub id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub ranking: i32,
    pub elo_rating: i32,
    pub matches_played: i32,
    pub wins: i32,
    pub losses: i32,
    pub win_rate: f64,
    pub period: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardResponse {
    pub entries: Vec<LeaderboardEntry>,
    pub total_count: i64,
    pub period: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerRankResponse {
    pub user_id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub current_rank: i32,
    pub elo_rating: i32,
    pub matches_played: i32,
    pub wins: i32,
    pub losses: i32,
    pub win_rate: f64,
    pub rank_change: Option<i32>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankHistory {
    pub user_id: Uuid,
    pub username: String,
    pub history: Vec<RankHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankHistoryEntry {
    pub rank: i32,
    pub elo_rating: i32,
    pub period: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeasonalLeaderboard {
    pub season_id: String,
    pub season_name: String,
    pub start_date: DateTime<Utc>,
    pub end_date: DateTime<Utc>,
    pub entries: Vec<LeaderboardEntry>,
    pub total_participants: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardCategory {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshLeaderboardRequest {
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardStats {
    pub total_players: i64,
    pub average_elo: f64,
    pub median_elo: i32,
    pub top_player_elo: i32,
    pub last_updated: DateTime<Utc>,
}

/// A single day's end-of-day ELO rating for a player.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EloSnapshot {
    pub date: NaiveDate,
    pub elo_rating: i32,
}

/// A point in an ELO progression chart, including the change since the previous snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EloProgressionPoint {
    pub date: NaiveDate,
    pub elo_rating: i32,
    pub change_from_previous: i32,
}

/// A single highest/lowest ELO record, with when it happened and the match that caused it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EloRecord {
    pub elo_rating: i32,
    pub recorded_at: DateTime<Utc>,
    pub match_id: Option<Uuid>,
}

/// Volatility metrics describing how much a player's ELO swings over a period.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EloVolatility {
    pub std_deviation: f64,
    pub average_change: f64,
    pub max_swing: i32,
    pub sample_size: i64,
}

/// Full historical ELO analytics for a player over a date range.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EloHistoryResponse {
    pub user_id: Uuid,
    pub username: String,
    pub category: String,
    pub start_date: DateTime<Utc>,
    pub end_date: DateTime<Utc>,
    pub snapshots: Vec<EloSnapshot>,
    pub progression: Vec<EloProgressionPoint>,
    pub highest: Option<EloRecord>,
    pub lowest: Option<EloRecord>,
    pub volatility: EloVolatility,
}

/// Query params for date-range-scoped ELO history endpoints.
#[derive(Debug, Clone, Deserialize)]
pub struct EloHistoryQuery {
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
}
