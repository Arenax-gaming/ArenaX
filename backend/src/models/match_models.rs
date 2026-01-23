use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Match {
    pub id: Uuid,
    pub tournament_id: Option<Uuid>, // None for casual matches
    pub round_id: Option<Uuid>,
    pub match_type: MatchType,
    pub status: MatchStatus,
    pub player1_id: Uuid,
    pub player2_id: Option<Uuid>, // None for bye matches
    pub winner_id: Option<Uuid>,
    pub player1_score: Option<i32>,
    pub player2_score: Option<i32>,
    pub player1_elo_before: Option<i32>,
    pub player2_elo_before: Option<i32>,
    pub player1_elo_after: Option<i32>,
    pub player2_elo_after: Option<i32>,
    pub scheduled_time: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub game_mode: String,
    pub map: Option<String>,
    pub match_duration: Option<i32>, // in seconds
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MatchScore {
    pub id: Uuid,
    pub match_id: Uuid,
    pub player_id: Uuid,
    pub score: i32,
    pub proof_url: Option<String>, // URL to screenshot/video proof
    pub telemetry_data: Option<String>, // JSON string of game telemetry
    pub submitted_at: DateTime<Utc>,
    pub verified: bool,
    pub verified_by: Option<Uuid>, // Admin who verified
    pub verified_at: Option<DateTime<Utc>>,
    pub dispute_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MatchDispute {
    pub id: Uuid,
    pub match_id: Uuid,
    pub disputing_player_id: Uuid,
    pub reason: String,
    pub evidence_urls: Option<String>, // JSON array of URLs
    pub status: DisputeStatus,
    pub admin_reviewer_id: Option<Uuid>,
    pub admin_notes: Option<String>,
    pub resolution: Option<String>,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MatchmakingQueue {
    pub id: Uuid,
    pub user_id: Uuid,
    pub game: String,
    pub game_mode: String,
    pub current_elo: i32,
    pub min_elo: i32,
    pub max_elo: i32,
    pub joined_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub status: QueueStatus,
    pub matched_at: Option<DateTime<Utc>>,
    pub match_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserElo {
    pub id: Uuid,
    pub user_id: Uuid,
    pub game: String,
    pub current_rating: i32,
    pub peak_rating: i32,
    pub games_played: i32,
    pub wins: i32,
    pub losses: i32,
    pub draws: i32,
    pub win_streak: i32,
    pub loss_streak: i32,
    pub last_updated: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EloHistory {
    pub id: Uuid,
    pub user_id: Uuid,
    pub game: String,
    pub match_id: Uuid,
    pub rating_before: i32,
    pub rating_after: i32,
    pub rating_change: i32,
    pub opponent_id: Uuid,
    pub opponent_rating: i32,
    pub result: MatchResult,
    pub created_at: DateTime<Utc>,
}

// Enums
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(i32)]
pub enum MatchType {
    Tournament = 0,
    Casual = 1,
    Ranked = 2,
    Practice = 3,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(i32)]
pub enum MatchStatus {
    Pending = 0,
    Scheduled = 1,
    InProgress = 2,
    Completed = 3,
    Disputed = 4,
    Cancelled = 5,
    Abandoned = 6,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(i32)]
pub enum DisputeStatus {
    Pending = 0,
    UnderReview = 1,
    Resolved = 2,
    Rejected = 3,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(i32)]
pub enum QueueStatus {
    Waiting = 0,
    Matched = 1,
    Expired = 2,
    Cancelled = 3,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(i32)]
pub enum MatchResult {
    Win = 0,
    Loss = 1,
    Draw = 2,
}

// DTOs for API requests/responses
#[derive(Debug, Serialize, Deserialize)]
pub struct ReportScoreRequest {
    pub score: i32,
    pub proof_url: Option<String>,
    pub telemetry_data: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateDisputeRequest {
    pub reason: String,
    pub evidence_urls: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JoinMatchmakingRequest {
    pub game: String,
    pub game_mode: String,
    pub max_wait_time: Option<i32>, // in minutes
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MatchResponse {
    pub id: Uuid,
    pub tournament_id: Option<Uuid>,
    pub match_type: MatchType,
    pub status: MatchStatus,
    pub player1: PlayerInfo,
    pub player2: Option<PlayerInfo>,
    pub winner_id: Option<Uuid>,
    pub player1_score: Option<i32>,
    pub player2_score: Option<i32>,
    pub scheduled_time: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub game_mode: String,
    pub map: Option<String>,
    pub match_duration: Option<i32>,
    pub can_report_score: bool,
    pub can_dispute: bool,
    pub dispute_status: Option<DisputeStatus>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlayerInfo {
    pub id: Uuid,
    pub username: String,
    pub elo_rating: i32,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MatchmakingStatusResponse {
    pub in_queue: bool,
    pub queue_position: Option<i32>,
    pub estimated_wait_time: Option<i32>, // in seconds
    pub current_match: Option<MatchResponse>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EloResponse {
    pub game: String,
    pub current_rating: i32,
    pub peak_rating: i32,
    pub games_played: i32,
    pub wins: i32,
    pub losses: i32,
    pub draws: i32,
    pub win_rate: f64,
    pub win_streak: i32,
    pub loss_streak: i32,
    pub rank: Option<i32>, // Global rank
    pub percentile: Option<f64>, // Top X% of players
}

// ===== Additional Response Types for Complete Match Management =====

#[derive(Debug, Serialize, Deserialize)]
pub struct DisputeListResponse {
    pub disputes: Vec<MatchDispute>,
    pub total: i64,
    pub page: i32,
    pub per_page: i32,
}
