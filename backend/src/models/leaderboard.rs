use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

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
