use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Leaderboard {
    pub id: Uuid,
    pub user_id: Uuid,
    pub tournament_id: Option<Uuid>,
    pub game_type: Option<String>,
    pub rank: i32,
    pub score: Decimal,
    pub points_earned: i32,
    pub reputation_points: i32,
    pub tournaments_won: i32,
    pub tournaments_played: i32,
    pub win_rate: Decimal,
    pub total_earnings: Decimal,
    pub period: String,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LeaderboardPeriod {
    Daily,
    Weekly,
    Monthly,
    Quarterly,
    Yearly,
    AllTime,
}

impl std::fmt::Display for LeaderboardPeriod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LeaderboardPeriod::Daily => write!(f, "daily"),
            LeaderboardPeriod::Weekly => write!(f, "weekly"),
            LeaderboardPeriod::Monthly => write!(f, "monthly"),
            LeaderboardPeriod::Quarterly => write!(f, "quarterly"),
            LeaderboardPeriod::Yearly => write!(f, "yearly"),
            LeaderboardPeriod::AllTime => write!(f, "all_time"),
        }
    }
}

impl From<String> for LeaderboardPeriod {
    fn from(s: String) -> Self {
        match s.as_str() {
            "daily" => LeaderboardPeriod::Daily,
            "weekly" => LeaderboardPeriod::Weekly,
            "monthly" => LeaderboardPeriod::Monthly,
            "quarterly" => LeaderboardPeriod::Quarterly,
            "yearly" => LeaderboardPeriod::Yearly,
            _ => LeaderboardPeriod::AllTime,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateLeaderboardRequest {
    pub user_id: Uuid,
    pub tournament_id: Option<Uuid>,
    pub game_type: Option<String>,
    #[validate(range(min = 1))]
    pub rank: i32,
    pub score: Decimal,
    pub points_earned: Option<i32>,
    pub reputation_points: Option<i32>,
    pub tournaments_won: Option<i32>,
    pub tournaments_played: Option<i32>,
    pub win_rate: Option<Decimal>,
    pub total_earnings: Option<Decimal>,
    pub period: LeaderboardPeriod,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct UpdateLeaderboardRequest {
    #[validate(range(min = 1))]
    pub rank: Option<i32>,
    pub score: Option<Decimal>,
    pub points_earned: Option<i32>,
    pub reputation_points: Option<i32>,
    pub tournaments_won: Option<i32>,
    pub tournaments_played: Option<i32>,
    pub win_rate: Option<Decimal>,
    pub total_earnings: Option<Decimal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub tournament_id: Option<Uuid>,
    pub game_type: Option<String>,
    pub rank: i32,
    pub score: Decimal,
    pub points_earned: i32,
    pub reputation_points: i32,
    pub tournaments_won: i32,
    pub tournaments_played: i32,
    pub win_rate: Decimal,
    pub total_earnings: Decimal,
    pub period: String,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Leaderboard> for LeaderboardResponse {
    fn from(leaderboard: Leaderboard) -> Self {
        Self {
            id: leaderboard.id,
            user_id: leaderboard.user_id,
            tournament_id: leaderboard.tournament_id,
            game_type: leaderboard.game_type,
            rank: leaderboard.rank,
            score: leaderboard.score,
            points_earned: leaderboard.points_earned,
            reputation_points: leaderboard.reputation_points,
            tournaments_won: leaderboard.tournaments_won,
            tournaments_played: leaderboard.tournaments_played,
            win_rate: leaderboard.win_rate,
            total_earnings: leaderboard.total_earnings,
            period: leaderboard.period,
            period_start: leaderboard.period_start,
            period_end: leaderboard.period_end,
            created_at: leaderboard.created_at,
            updated_at: leaderboard.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardEntry {
    pub rank: i32,
    pub user_id: Uuid,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub score: Decimal,
    pub points_earned: i32,
    pub tournaments_won: i32,
    pub tournaments_played: i32,
    pub win_rate: Decimal,
    pub total_earnings: Decimal,
    pub reputation_points: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardQuery {
    pub period: Option<LeaderboardPeriod>,
    pub game_type: Option<String>,
    pub tournament_id: Option<Uuid>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}
