use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Match {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub player1_id: Option<Uuid>,
    pub player2_id: Option<Uuid>,
    pub round_number: i32,
    pub bracket_position: Option<i32>,
    pub status: String,
    pub score1: i32,
    pub score2: i32,
    pub best_of: i32,
    pub winner_id: Option<Uuid>,
    pub loser_id: Option<Uuid>,
    pub match_data: Option<serde_json::Value>,
    pub dispute_reason: Option<String>,
    pub admin_notes: Option<String>,
    pub scheduled_time: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MatchStatus {
    Scheduled,
    InProgress,
    Completed,
    Cancelled,
    Disputed,
}

impl std::fmt::Display for MatchStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MatchStatus::Scheduled => write!(f, "scheduled"),
            MatchStatus::InProgress => write!(f, "in_progress"),
            MatchStatus::Completed => write!(f, "completed"),
            MatchStatus::Cancelled => write!(f, "cancelled"),
            MatchStatus::Disputed => write!(f, "disputed"),
        }
    }
}

impl From<String> for MatchStatus {
    fn from(s: String) -> Self {
        match s.as_str() {
            "in_progress" => MatchStatus::InProgress,
            "completed" => MatchStatus::Completed,
            "cancelled" => MatchStatus::Cancelled,
            "disputed" => MatchStatus::Disputed,
            _ => MatchStatus::Scheduled,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateMatchRequest {
    pub tournament_id: Uuid,
    pub player1_id: Option<Uuid>,
    pub player2_id: Option<Uuid>,
    #[validate(range(min = 1))]
    pub round_number: i32,
    pub bracket_position: Option<i32>,
    #[validate(range(min = 1))]
    pub best_of: Option<i32>,
    pub scheduled_time: Option<DateTime<Utc>>,
    pub match_data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct UpdateMatchRequest {
    pub player1_id: Option<Uuid>,
    pub player2_id: Option<Uuid>,
    pub status: Option<MatchStatus>,
    #[validate(range(min = 0))]
    pub score1: Option<i32>,
    #[validate(range(min = 0))]
    pub score2: Option<i32>,
    pub winner_id: Option<Uuid>,
    pub loser_id: Option<Uuid>,
    pub match_data: Option<serde_json::Value>,
    pub dispute_reason: Option<String>,
    pub admin_notes: Option<String>,
    pub scheduled_time: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchResponse {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub player1_id: Option<Uuid>,
    pub player2_id: Option<Uuid>,
    pub round_number: i32,
    pub bracket_position: Option<i32>,
    pub status: String,
    pub score1: i32,
    pub score2: i32,
    pub best_of: i32,
    pub winner_id: Option<Uuid>,
    pub loser_id: Option<Uuid>,
    pub match_data: Option<serde_json::Value>,
    pub dispute_reason: Option<String>,
    pub admin_notes: Option<String>,
    pub scheduled_time: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Match> for MatchResponse {
    fn from(match_model: Match) -> Self {
        Self {
            id: match_model.id,
            tournament_id: match_model.tournament_id,
            player1_id: match_model.player1_id,
            player2_id: match_model.player2_id,
            round_number: match_model.round_number,
            bracket_position: match_model.bracket_position,
            status: match_model.status,
            score1: match_model.score1,
            score2: match_model.score2,
            best_of: match_model.best_of,
            winner_id: match_model.winner_id,
            loser_id: match_model.loser_id,
            match_data: match_model.match_data,
            dispute_reason: match_model.dispute_reason,
            admin_notes: match_model.admin_notes,
            scheduled_time: match_model.scheduled_time,
            started_at: match_model.started_at,
            completed_at: match_model.completed_at,
            created_at: match_model.created_at,
            updated_at: match_model.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchWithPlayers {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub player1_id: Option<Uuid>,
    pub player1_username: Option<String>,
    pub player2_id: Option<Uuid>,
    pub player2_username: Option<String>,
    pub round_number: i32,
    pub bracket_position: Option<i32>,
    pub status: String,
    pub score1: i32,
    pub score2: i32,
    pub best_of: i32,
    pub winner_id: Option<Uuid>,
    pub winner_username: Option<String>,
    pub scheduled_time: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
