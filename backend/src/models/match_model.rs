use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Match {
    pub id: Uuid,
    pub tournament_id: Option<Uuid>,
    pub player1_id: Uuid,
    pub player2_id: Uuid,
    pub game_type: String,
    pub status: String,
    pub winner_id: Option<Uuid>,
    pub score_player1: Option<i32>,
    pub score_player2: Option<i32>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMatchRequest {
    pub tournament_id: Option<Uuid>,
    pub player1_id: Uuid,
    pub player2_id: Uuid,
    pub game_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchResult {
    pub match_id: Uuid,
    pub winner_id: Uuid,
    pub score_player1: i32,
    pub score_player2: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchResponse {
    #[serde(flatten)]
    pub match_data: Match,
    pub player1_username: String,
    pub player2_username: String,
    pub tournament_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MatchStatus {
    Pending,
    InProgress,
    Completed,
    Disputed,
    Cancelled,
}

impl std::fmt::Display for MatchStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MatchStatus::Pending => write!(f, "pending"),
            MatchStatus::InProgress => write!(f, "in_progress"),
            MatchStatus::Completed => write!(f, "completed"),
            MatchStatus::Disputed => write!(f, "disputed"),
            MatchStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}