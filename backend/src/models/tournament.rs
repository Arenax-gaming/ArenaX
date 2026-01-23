#![allow(dead_code)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tournament {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub game_type: String,
    pub tournament_type: String,
    pub entry_fee: i32, // TODO: Use Decimal when rust_decimal is added
    pub prize_pool: i32, // TODO: Use Decimal when rust_decimal is added
    pub max_participants: i32,
    pub current_participants: i32,
    pub status: String,
    pub visibility: String,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTournamentRequest {
    pub name: String,
    pub description: Option<String>,
    pub game_type: String,
    pub tournament_type: String,
    pub entry_fee: i32, // TODO: Use Decimal when rust_decimal is added
    pub max_participants: i32,
    pub visibility: String,
    pub start_time: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentResponse {
    #[serde(flatten)]
    pub tournament: Tournament,
    pub participants_count: i32,
    pub can_join: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TournamentStatus {
    Draft,
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
            TournamentStatus::RegistrationOpen => write!(f, "registration_open"),
            TournamentStatus::RegistrationClosed => write!(f, "registration_closed"),
            TournamentStatus::InProgress => write!(f, "in_progress"),
            TournamentStatus::Completed => write!(f, "completed"),
            TournamentStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}