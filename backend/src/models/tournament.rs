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
    pub game_type: String,
    pub tournament_type: String,
    pub entry_fee: Decimal,
    pub prize_pool: Decimal,
    pub max_participants: i32,
    pub current_participants: i32,
    pub min_participants: i32,
    pub status: String,
    pub visibility: String,
    pub registration_start: Option<DateTime<Utc>>,
    pub registration_end: Option<DateTime<Utc>>,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub bracket_generated_at: Option<DateTime<Utc>>,
    pub rules: Option<serde_json::Value>,
    pub metadata: Option<serde_json::Value>,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // Stellar integration fields
    pub stellar_prize_pool_account: Option<String>,
    pub entry_fee_currency: Option<String>,
    pub prize_pool_currency: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TournamentStatus {
    Draft,
    Upcoming,
    RegistrationOpen,
    RegistrationClosed,
    InProgress,
    Completed,
    Cancelled,
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
    pub game_type: String,
    pub tournament_type: TournamentType,
    pub entry_fee: Decimal,
    #[validate(range(min = 2, max = 1000))]
    pub max_participants: i32,
    #[validate(range(min = 2))]
    pub min_participants: i32,
    pub visibility: Option<TournamentVisibility>,
    pub registration_start: Option<DateTime<Utc>>,
    pub registration_end: Option<DateTime<Utc>>,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub rules: Option<serde_json::Value>,
    pub metadata: Option<serde_json::Value>,
    pub entry_fee_currency: Option<String>,
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
    pub game_type: String,
    pub tournament_type: String,
    pub entry_fee: Decimal,
    pub prize_pool: Decimal,
    pub max_participants: i32,
    pub current_participants: i32,
    pub min_participants: i32,
    pub status: String,
    pub visibility: String,
    pub registration_start: Option<DateTime<Utc>>,
    pub registration_end: Option<DateTime<Utc>>,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub bracket_generated_at: Option<DateTime<Utc>>,
    pub rules: Option<serde_json::Value>,
    pub metadata: Option<serde_json::Value>,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub stellar_prize_pool_account: Option<String>,
    pub entry_fee_currency: Option<String>,
    pub prize_pool_currency: Option<String>,
}

impl From<Tournament> for TournamentResponse {
    fn from(tournament: Tournament) -> Self {
        Self {
            id: tournament.id,
            name: tournament.name,
            description: tournament.description,
            game_type: tournament.game_type,
            tournament_type: tournament.tournament_type,
            entry_fee: tournament.entry_fee,
            prize_pool: tournament.prize_pool,
            max_participants: tournament.max_participants,
            current_participants: tournament.current_participants,
            min_participants: tournament.min_participants,
            status: tournament.status,
            visibility: tournament.visibility,
            registration_start: tournament.registration_start,
            registration_end: tournament.registration_end,
            start_time: tournament.start_time,
            end_time: tournament.end_time,
            bracket_generated_at: tournament.bracket_generated_at,
            rules: tournament.rules,
            metadata: tournament.metadata,
            created_by: tournament.created_by,
            created_at: tournament.created_at,
            updated_at: tournament.updated_at,
            stellar_prize_pool_account: tournament.stellar_prize_pool_account,
            entry_fee_currency: tournament.entry_fee_currency,
            prize_pool_currency: tournament.prize_pool_currency,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TournamentParticipant {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub user_id: Uuid,
    pub registration_date: DateTime<Utc>,
    pub status: String,
    pub seed_number: Option<i32>,
    pub payment_status: String,
    pub payment_transaction_id: Option<Uuid>,
    pub stellar_entry_transaction_id: Option<String>,
    pub current_round: Option<i32>,
    pub eliminated_at: Option<DateTime<Utc>>,
    pub final_rank: Option<i32>,
    pub prize_amount: Option<Decimal>,
    pub prize_currency: Option<String>,
    pub stellar_payout_transaction_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ParticipantStatus {
    Registered,
    Confirmed,
    CheckedIn,
    Active,
    Eliminated,
    Disqualified,
    Withdrawn,
}

impl std::fmt::Display for ParticipantStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParticipantStatus::Registered => write!(f, "registered"),
            ParticipantStatus::Confirmed => write!(f, "confirmed"),
            ParticipantStatus::CheckedIn => write!(f, "checked_in"),
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
    pub total_amount: Decimal,
    pub currency: String,
    pub stellar_account: String,
    pub stellar_asset_code: Option<String>,
    pub distribution_percentages: String, // JSON array of percentages for each rank
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JoinTournamentRequest {
    pub payment_method: String, // "fiat" or "arenax_token"
    pub payment_reference: Option<String>, // For fiat payments
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TournamentListResponse {
    pub tournaments: Vec<TournamentResponse>,
    pub total: i64,
    pub page: i32,
    pub per_page: i32,
}