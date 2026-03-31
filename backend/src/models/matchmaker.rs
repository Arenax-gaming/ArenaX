use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

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
    pub matched_at: Option<DateTime<Utc>>,
    pub status: QueueStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "queue_status", rename_all = "lowercase")]
pub enum QueueStatus {
    Waiting,
    Matched,
    Expired,
    Left,
    Cancelled,
}

impl From<String> for QueueStatus {
    fn from(s: String) -> Self {
        match s.as_str() {
            "waiting" => QueueStatus::Waiting,
            "matched" => QueueStatus::Matched,
            "expired" => QueueStatus::Expired,
            "left" => QueueStatus::Left,
            "cancelled" => QueueStatus::Cancelled,
            _ => QueueStatus::Waiting,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserElo {
    pub id: Uuid,
    pub user_id: Uuid,
    pub game: String,
    pub current_rating: i32,
    pub peak_rating: i32,
    pub wins: i32,
    pub losses: i32,
    pub draws: i32,
    pub win_rate: f64,
    pub win_streak: i32,
    pub loss_streak: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EloHistory {
    pub id: Uuid,
    pub user_id: Uuid,
    pub game: String,
    pub old_rating: i32,
    pub new_rating: i32,
    pub change_amount: i32,
    pub match_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueEntry {
    pub user_id: Uuid,
    pub game: String,
    pub game_mode: String,
    pub current_elo: i32,
    pub min_elo: i32,
    pub max_elo: i32,
    pub joined_at: DateTime<Utc>,
    pub wait_time_multiplier: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchCandidate {
    pub player1: QueueEntry,
    pub player2: QueueEntry,
    pub match_quality: f64,
    pub elo_gap: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchmakingConfig {
    pub elo_bucket_size: i32,
    pub max_elo_gap: i32,
    pub expansion_intervals: Vec<i64>, // in seconds
    pub max_wait_time: i64,            // in seconds
    pub min_players_per_match: usize,
    pub max_players_per_match: usize,
}

impl Default for MatchmakingConfig {
    fn default() -> Self {
        Self {
            elo_bucket_size: 100,
            max_elo_gap: 500,
            expansion_intervals: vec![30, 60, 120, 300], // 30s, 1m, 2m, 5m
            max_wait_time: 600,                          // 10 minutes
            min_players_per_match: 2,
            max_players_per_match: 2,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchmakingStats {
    pub total_players_in_queue: usize,
    pub games: Vec<GameQueueStats>,
    pub matches_created_last_hour: i64,
    pub average_wait_time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameQueueStats {
    pub game: String,
    pub game_modes: Vec<GameModeStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameModeStats {
    pub game_mode: String,
    pub players_in_queue: usize,
    pub average_wait_time: Option<i32>,
    pub matches_per_hour: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EloResponse {
    pub user_id: Uuid,
    pub game: String,
    pub current_rating: i32,
    pub peak_rating: i32,
    pub wins: i32,
    pub losses: i32,
    pub draws: i32,
    pub win_rate: f64,
    pub win_streak: i32,
    pub loss_streak: i32,
    pub rank: Option<i32>,
    pub percentile: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchmakingStatusResponse {
    pub in_queue: bool,
    pub queue_entry: Option<QueueEntry>,
    pub queue_size: usize,
    pub estimated_wait_time: Option<i32>,
    pub wait_time_so_far: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinQueueRequest {
    pub game: String,
    pub game_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinQueueResponse {
    pub success: bool,
    pub queue_position: Option<usize>,
    pub estimated_wait_time: Option<i32>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaveQueueRequest {
    pub game: String,
    pub game_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaveQueueResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStatusRequest {
    pub game: String,
    pub game_mode: String,
}

// Match-related models (reusing from existing models)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Match {
    pub id: Uuid,
    pub tournament_id: Option<Uuid>,
    pub round_id: Option<Uuid>,
    pub match_type: MatchType,
    pub status: MatchStatus,
    pub player1_id: Uuid,
    pub player2_id: Option<Uuid>,
    pub player1_elo_before: i32,
    pub player2_elo_before: Option<i32>,
    pub player1_elo_after: Option<i32>,
    pub player2_elo_after: Option<i32>,
    pub player1_score: Option<i32>,
    pub player2_score: Option<i32>,
    pub winner_id: Option<Uuid>,
    pub game_mode: String,
    pub scheduled_time: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "match_type", rename_all = "lowercase")]
pub enum MatchType {
    Casual,
    Ranked,
    Tournament,
    Practice,
}

impl From<String> for MatchType {
    fn from(s: String) -> Self {
        match s.as_str() {
            "casual" => MatchType::Casual,
            "ranked" => MatchType::Ranked,
            "tournament" => MatchType::Tournament,
            "practice" => MatchType::Practice,
            _ => MatchType::Casual,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "match_status", rename_all = "lowercase")]
pub enum MatchStatus {
    Pending,
    Scheduled,
    InProgress,
    Completed,
    Cancelled,
    Disputed,
}

impl From<String> for MatchStatus {
    fn from(s: String) -> Self {
        match s.as_str() {
            "pending" => MatchStatus::Pending,
            "scheduled" => MatchStatus::Scheduled,
            "in_progress" => MatchStatus::InProgress,
            "completed" => MatchStatus::Completed,
            "cancelled" => MatchStatus::Cancelled,
            "disputed" => MatchStatus::Disputed,
            _ => MatchStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchScore {
    pub id: Uuid,
    pub match_id: Uuid,
    pub player_id: Uuid,
    pub score: i32,
    pub proof_url: Option<String>,
    pub telemetry_data: Option<serde_json::Value>,
    pub submitted_at: DateTime<Utc>,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchDispute {
    pub id: Uuid,
    pub match_id: Uuid,
    pub disputing_player_id: Uuid,
    pub reason: String,
    pub evidence_urls: Vec<String>,
    pub status: DisputeStatus,
    pub admin_reviewer_id: Option<Uuid>,
    pub admin_notes: Option<String>,
    pub resolution: Option<String>,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "dispute_status", rename_all = "lowercase")]
pub enum DisputeStatus {
    Pending,
    UnderReview,
    Resolved,
    Rejected,
}

impl From<String> for DisputeStatus {
    fn from(s: String) -> Self {
        match s.as_str() {
            "pending" => DisputeStatus::Pending,
            "under_review" => DisputeStatus::UnderReview,
            "resolved" => DisputeStatus::Resolved,
            "rejected" => DisputeStatus::Rejected,
            _ => DisputeStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportScoreRequest {
    pub score: i32,
    pub proof_url: Option<String>,
    pub telemetry_data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDisputeRequest {
    pub reason: String,
    pub evidence_urls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchmakingQueueRequest {
    pub game: String,
    pub game_mode: String,
    pub max_wait_time: Option<i32>, // in minutes
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchmakingQueueResponse {
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchResponse {
    pub id: Uuid,
    pub tournament_id: Option<Uuid>,
    pub round_id: Option<Uuid>,
    pub match_type: MatchType,
    pub status: MatchStatus,
    pub player1: PlayerInfo,
    pub player2: Option<PlayerInfo>,
    pub player1_score: Option<i32>,
    pub player2_score: Option<i32>,
    pub winner_id: Option<Uuid>,
    pub game_mode: String,
    pub scheduled_time: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerInfo {
    pub id: Uuid,
    pub username: String,
    pub current_elo: i32,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchHistoryResponse {
    pub matches: Vec<MatchResponse>,
    pub total_count: i64,
    pub page: i32,
    pub per_page: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisputeListResponse {
    pub disputes: Vec<MatchDispute>,
    pub total_count: i64,
    pub page: i32,
    pub per_page: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MatchResult {
    Win,
    Loss,
    Draw,
}

impl From<i32> for MatchResult {
    fn from(score: i32) -> Self {
        match score {
            1 => MatchResult::Win,
            0 => MatchResult::Loss,
            2 => MatchResult::Draw,
            _ => MatchResult::Loss,
        }
    }
}
