#![allow(dead_code)]

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Tournament {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub game: String, // Changed from game_type for consistency
    pub max_participants: i32,
    pub entry_fee: i64, // Changed from Decimal for database compatibility
    pub entry_fee_currency: String,
    pub prize_pool: i64, // Changed from Decimal
    pub prize_pool_currency: String,
    pub status: TournamentStatus,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub registration_deadline: DateTime<Utc>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub bracket_type: BracketType,
    pub rules: Option<String>,
    pub min_skill_level: Option<i32>, // For skill-based matchmaking
    pub max_skill_level: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TournamentType {
    SingleElimination,
    DoubleElimination,
    RoundRobin,
    Swiss,
}

impl std::fmt::Display for TournamentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TournamentType::SingleElimination => write!(f, "single_elimination"),
            TournamentType::DoubleElimination => write!(f, "double_elimination"),
            TournamentType::RoundRobin => write!(f, "round_robin"),
            TournamentType::Swiss => write!(f, "swiss"),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(i32)]
pub enum TournamentStatus {
    Draft = 0,
    Upcoming = 1,
    RegistrationOpen = 2,
    RegistrationClosed = 3,
    InProgress = 4,
    Completed = 5,
    Cancelled = 6,
}

impl std::fmt::Display for TournamentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TournamentStatus::Draft => write!(f, "draft"),
            TournamentStatus::Upcoming => write!(f, "upcoming"),
            TournamentStatus::RegistrationOpen => write!(f, "registration_open"),
            TournamentStatus::RegistrationClosed => write!(f, "registration_closed"),
            TournamentStatus::InProgress => write!(f, "in_progress"),
            TournamentStatus::Completed => write!(f, "completed"),
            TournamentStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TournamentVisibility {
    Public,
    Private,
    InviteOnly,
}

impl std::fmt::Display for TournamentVisibility {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TournamentVisibility::Public => write!(f, "public"),
            TournamentVisibility::Private => write!(f, "private"),
            TournamentVisibility::InviteOnly => write!(f, "invite_only"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateTournamentRequest {
    #[validate(length(min = 3, max = 255))]
    pub name: String,
    #[validate(length(max = 1000))]
    pub description: Option<String>,
    #[validate(length(min = 1, max = 50))]
    pub game: String,
    pub bracket_type: BracketType,
    pub entry_fee: i64,
    pub entry_fee_currency: String,
    #[validate(range(min = 2, max = 1000))]
    pub max_participants: i32,
    pub start_time: DateTime<Utc>,
    pub registration_deadline: DateTime<Utc>,
    pub rules: Option<String>,
    pub min_skill_level: Option<i32>,
    pub max_skill_level: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct UpdateTournamentRequest {
    #[validate(length(min = 3, max = 255))]
    pub name: Option<String>,
    #[validate(length(max = 1000))]
    pub description: Option<String>,
    pub tournament_type: Option<TournamentType>,
    pub entry_fee: Option<Decimal>,
    #[validate(range(min = 2, max = 1000))]
    pub max_participants: Option<i32>,
    pub visibility: Option<TournamentVisibility>,
    pub registration_start: Option<DateTime<Utc>>,
    pub registration_end: Option<DateTime<Utc>>,
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub rules: Option<serde_json::Value>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TournamentParticipant {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub user_id: Uuid,
    pub registered_at: DateTime<Utc>,
    pub entry_fee_paid: bool,
    pub status: ParticipantStatus,
    pub seed_number: Option<i32>,
    pub current_round: Option<i32>,
    pub eliminated_at: Option<DateTime<Utc>>,
    pub final_rank: Option<i32>,
    pub prize_amount: Option<i64>,
    pub prize_currency: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(i32)]
pub enum ParticipantStatus {
    Registered = 0,
    Paid = 1,
    Active = 2,
    Eliminated = 3,
    Disqualified = 4,
    Withdrawn = 5,
}

impl std::fmt::Display for ParticipantStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParticipantStatus::Registered => write!(f, "registered"),
            ParticipantStatus::Paid => write!(f, "paid"),
            ParticipantStatus::Active => write!(f, "active"),
            ParticipantStatus::Eliminated => write!(f, "eliminated"),
            ParticipantStatus::Disqualified => write!(f, "disqualified"),
            ParticipantStatus::Withdrawn => write!(f, "withdrawn"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TournamentStanding {
    pub tournament_id: Uuid,
    pub tournament_name: String,
    pub user_id: Uuid,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub participation_status: String,
    pub wins: Option<i64>,
    pub matches_played: Option<i64>,
    pub total_score: Option<Decimal>,
    pub current_rank: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PrizePool {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub total_amount: i64,
    pub currency: String,
    pub stellar_account: String,
    pub stellar_asset_code: Option<String>,
    pub distribution_percentages: String, // JSON array of percentages for each rank
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JoinTournamentRequest {
    pub payment_method: String,            // "fiat" or "arenax_token"
    pub payment_reference: Option<String>, // For fiat payments
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TournamentListResponse {
    pub tournaments: Vec<TournamentResponse>,
    pub total: i64,
    pub page: i32,
    pub per_page: i32,
}

// ===== Additional Types for Complete Tournament Management =====

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "bracket_type", rename_all = "lowercase")]
pub enum BracketType {
    SingleElimination,
    DoubleElimination,
    RoundRobin,
    Swiss,
}

impl std::fmt::Display for BracketType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BracketType::SingleElimination => write!(f, "single_elimination"),
            BracketType::DoubleElimination => write!(f, "double_elimination"),
            BracketType::RoundRobin => write!(f, "round_robin"),
            BracketType::Swiss => write!(f, "swiss"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "round_type", rename_all = "lowercase")]
pub enum RoundType {
    Qualification,
    Elimination,
    Semifinal,
    Final,
}

impl std::fmt::Display for RoundType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RoundType::Qualification => write!(f, "qualification"),
            RoundType::Elimination => write!(f, "elimination"),
            RoundType::Semifinal => write!(f, "semifinal"),
            RoundType::Final => write!(f, "final"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "round_status", rename_all = "lowercase")]
pub enum RoundStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

impl std::fmt::Display for RoundStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RoundStatus::Pending => write!(f, "pending"),
            RoundStatus::InProgress => write!(f, "in_progress"),
            RoundStatus::Completed => write!(f, "completed"),
            RoundStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "match_status", rename_all = "lowercase")]
pub enum MatchStatus {
    Pending,
    Scheduled,
    InProgress,
    Completed,
    Disputed,
    Cancelled,
    Abandoned,
}

impl std::fmt::Display for MatchStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MatchStatus::Pending => write!(f, "pending"),
            MatchStatus::Scheduled => write!(f, "scheduled"),
            MatchStatus::InProgress => write!(f, "in_progress"),
            MatchStatus::Completed => write!(f, "completed"),
            MatchStatus::Disputed => write!(f, "disputed"),
            MatchStatus::Cancelled => write!(f, "cancelled"),
            MatchStatus::Abandoned => write!(f, "abandoned"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TournamentRound {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub round_number: i32,
    pub round_type: String,
    pub status: String,
    pub scheduled_start: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TournamentMatch {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub round_id: Uuid,
    pub match_number: i32,
    pub player1_id: Uuid,
    pub player2_id: Option<Uuid>,
    pub winner_id: Option<Uuid>,
    pub player1_score: Option<i32>,
    pub player2_score: Option<i32>,
    pub status: String,
    pub scheduled_time: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ===== Type Conversions =====

impl From<i32> for BracketType {
    fn from(value: i32) -> Self {
        match value {
            0 => BracketType::SingleElimination,
            1 => BracketType::DoubleElimination,
            2 => BracketType::RoundRobin,
            3 => BracketType::Swiss,
            _ => BracketType::SingleElimination,
        }
    }
}

impl From<i32> for RoundType {
    fn from(value: i32) -> Self {
        match value {
            0 => RoundType::Qualification,
            1 => RoundType::Elimination,
            2 => RoundType::Semifinal,
            3 => RoundType::Final,
            _ => RoundType::Elimination,
        }
    }
}

impl From<i32> for RoundStatus {
    fn from(value: i32) -> Self {
        match value {
            0 => RoundStatus::Pending,
            1 => RoundStatus::InProgress,
            2 => RoundStatus::Completed,
            3 => RoundStatus::Cancelled,
            _ => RoundStatus::Pending,
        }
    }
}

impl From<i32> for MatchStatus {
    fn from(value: i32) -> Self {
        match value {
            0 => MatchStatus::Pending,
            1 => MatchStatus::Scheduled,
            2 => MatchStatus::InProgress,
            3 => MatchStatus::Completed,
            4 => MatchStatus::Disputed,
            5 => MatchStatus::Cancelled,
            6 => MatchStatus::Abandoned,
            _ => MatchStatus::Pending,
        }
    }
}
