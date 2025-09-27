use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Tournament {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub game: String,
    pub max_participants: i32,
    pub entry_fee: i64, // in kobo (Nigerian currency smallest unit)
    pub entry_fee_currency: String, // "NGN" or "ARENAX_TOKEN"
    pub prize_pool: i64, // in kobo or ArenaX tokens
    pub prize_pool_currency: String,
    pub stellar_prize_pool_account: Option<String>, // Stellar account for prize pool
    pub status: TournamentStatus,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub registration_deadline: DateTime<Utc>,
    pub created_by: Uuid, // User ID of creator
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub bracket_type: BracketType,
    pub rules: Option<String>, // JSON string of tournament rules
    pub min_skill_level: Option<i32>, // Minimum Elo rating required
    pub max_skill_level: Option<i32>, // Maximum Elo rating allowed
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TournamentParticipant {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub user_id: Uuid,
    pub registered_at: DateTime<Utc>,
    pub entry_fee_paid: bool,
    pub entry_fee_transaction_id: Option<String>,
    pub stellar_entry_transaction_id: Option<String>,
    pub status: ParticipantStatus,
    pub current_round: Option<i32>,
    pub eliminated_at: Option<DateTime<Utc>>,
    pub final_rank: Option<i32>,
    pub prize_amount: Option<i64>,
    pub prize_currency: Option<String>,
    pub stellar_payout_transaction_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TournamentRound {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub round_number: i32,
    pub round_type: RoundType,
    pub status: RoundStatus,
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TournamentMatch {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub round_id: Uuid,
    pub match_number: i32,
    pub player1_id: Uuid,
    pub player2_id: Option<Uuid>, // None for bye matches
    pub status: MatchStatus,
    pub winner_id: Option<Uuid>,
    pub player1_score: Option<i32>,
    pub player2_score: Option<i32>,
    pub scheduled_time: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PrizePool {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub total_amount: i64,
    pub currency: String,
    pub stellar_account: String,
    pub stellar_asset_code: Option<String>, // For custom tokens
    pub distribution_percentages: String, // JSON array of percentages for each rank
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// Enums
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "tournament_status", rename_all = "lowercase")]
pub enum TournamentStatus {
    Draft,
    Upcoming,
    RegistrationOpen,
    RegistrationClosed,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "participant_status", rename_all = "lowercase")]
pub enum ParticipantStatus {
    Registered,
    Paid,
    Active,
    Eliminated,
    Disqualified,
    Withdrawn,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "bracket_type", rename_all = "lowercase")]
pub enum BracketType {
    SingleElimination,
    DoubleElimination,
    RoundRobin,
    Swiss,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "round_type", rename_all = "lowercase")]
pub enum RoundType {
    Qualifier,
    Group,
    Elimination,
    Final,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "round_status", rename_all = "lowercase")]
pub enum RoundStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "match_status", rename_all = "lowercase")]
pub enum MatchStatus {
    Pending,
    Scheduled,
    InProgress,
    Completed,
    Disputed,
    Cancelled,
}

// DTOs for API requests/responses
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTournamentRequest {
    pub name: String,
    pub description: String,
    pub game: String,
    pub max_participants: i32,
    pub entry_fee: i64,
    pub entry_fee_currency: String,
    pub start_time: DateTime<Utc>,
    pub registration_deadline: DateTime<Utc>,
    pub bracket_type: BracketType,
    pub rules: Option<String>,
    pub min_skill_level: Option<i32>,
    pub max_skill_level: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JoinTournamentRequest {
    pub payment_method: String, // "fiat" or "arenax_token"
    pub payment_reference: Option<String>, // For fiat payments
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TournamentResponse {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub game: String,
    pub max_participants: i32,
    pub current_participants: i32,
    pub entry_fee: i64,
    pub entry_fee_currency: String,
    pub prize_pool: i64,
    pub prize_pool_currency: String,
    pub status: TournamentStatus,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub registration_deadline: DateTime<Utc>,
    pub bracket_type: BracketType,
    pub can_join: bool,
    pub is_participant: bool,
    pub participant_status: Option<ParticipantStatus>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TournamentListResponse {
    pub tournaments: Vec<TournamentResponse>,
    pub total: i64,
    pub page: i32,
    pub per_page: i32,
}
