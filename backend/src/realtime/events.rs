use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use crate::models::tournament::*;
use crate::models::match_models::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentEvent {
    pub event_type: TournamentEventType,
    pub tournament_id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub data: TournamentEventData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TournamentEventType {
    Created,
    StatusChanged,
    ParticipantJoined,
    ParticipantLeft,
    RegistrationOpened,
    RegistrationClosed,
    Started,
    RoundStarted,
    RoundCompleted,
    MatchCompleted,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TournamentEventData {
    Created { name: String, game: String, max_participants: i32 },
    StatusChanged { old_status: TournamentStatus, new_status: TournamentStatus },
    ParticipantJoined { user_id: Uuid, username: String, current_count: i32 },
    ParticipantLeft { user_id: Uuid, username: String, current_count: i32 },
    RegistrationOpened,
    RegistrationClosed,
    Started { participant_count: i32 },
    RoundStarted { round_number: i32, round_type: RoundType },
    RoundCompleted { round_number: i32, round_type: RoundType },
    MatchCompleted { match_id: Uuid, winner_id: Uuid, round_number: i32 },
    Completed { winner_id: Uuid, prize_distributed: bool },
    Cancelled { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchEvent {
    pub event_type: MatchEventType,
    pub match_id: Uuid,
    pub tournament_id: Option<Uuid>,
    pub timestamp: DateTime<Utc>,
    pub data: MatchEventData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MatchEventType {
    Created,
    Started,
    ScoreReported,
    Completed,
    Disputed,
    DisputeResolved,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MatchEventData {
    Created { player1_id: Uuid, player2_id: Option<Uuid>, game_mode: String },
    Started { player1_id: Uuid, player2_id: Option<Uuid> },
    ScoreReported { player_id: Uuid, score: i32, both_reported: bool },
    Completed { winner_id: Option<Uuid>, player1_score: i32, player2_score: i32, elo_changes: EloChanges },
    Disputed { disputing_player_id: Uuid, reason: String },
    DisputeResolved { resolution: String, admin_id: Uuid },
    Cancelled { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EloChanges {
    pub player1_id: Uuid,
    pub player1_elo_before: i32,
    pub player1_elo_after: i32,
    pub player1_change: i32,
    pub player2_id: Option<Uuid>,
    pub player2_elo_before: Option<i32>,
    pub player2_elo_after: Option<i32>,
    pub player2_change: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalEvent {
    pub event_type: GlobalEventType,
    pub timestamp: DateTime<Utc>,
    pub data: GlobalEventData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GlobalEventType {
    TournamentCreated,
    MatchCompleted,
    LeaderboardUpdated,
    SystemMaintenance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GlobalEventData {
    TournamentCreated { tournament_id: Uuid, name: String, game: String },
    MatchCompleted { match_id: Uuid, game: String, winner_id: Uuid },
    LeaderboardUpdated { game: String, top_players: Vec<LeaderboardUpdate> },
    SystemMaintenance { message: String, estimated_duration: Option<i32> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardUpdate {
    pub user_id: Uuid,
    pub username: String,
    pub rank: i32,
    pub rating: i32,
    pub change: i32,
}

// Helper functions for creating events
impl TournamentEvent {
    pub fn created(tournament_id: Uuid, name: String, game: String, max_participants: i32) -> Self {
        Self {
            event_type: TournamentEventType::Created,
            tournament_id,
            timestamp: Utc::now(),
            data: TournamentEventData::Created { name, game, max_participants },
        }
    }

    pub fn status_changed(tournament_id: Uuid, old_status: TournamentStatus, new_status: TournamentStatus) -> Self {
        Self {
            event_type: TournamentEventType::StatusChanged,
            tournament_id,
            timestamp: Utc::now(),
            data: TournamentEventData::StatusChanged { old_status, new_status },
        }
    }

    pub fn participant_joined(tournament_id: Uuid, user_id: Uuid, username: String, current_count: i32) -> Self {
        Self {
            event_type: TournamentEventType::ParticipantJoined,
            tournament_id,
            timestamp: Utc::now(),
            data: TournamentEventData::ParticipantJoined { user_id, username, current_count },
        }
    }

    pub fn match_completed(tournament_id: Uuid, match_id: Uuid, winner_id: Uuid, round_number: i32) -> Self {
        Self {
            event_type: TournamentEventType::MatchCompleted,
            tournament_id,
            timestamp: Utc::now(),
            data: TournamentEventData::MatchCompleted { match_id, winner_id, round_number },
        }
    }
}

impl MatchEvent {
    pub fn created(match_id: Uuid, tournament_id: Option<Uuid>, player1_id: Uuid, player2_id: Option<Uuid>, game_mode: String) -> Self {
        Self {
            event_type: MatchEventType::Created,
            match_id,
            tournament_id,
            timestamp: Utc::now(),
            data: MatchEventData::Created { player1_id, player2_id, game_mode },
        }
    }

    pub fn score_reported(match_id: Uuid, tournament_id: Option<Uuid>, player_id: Uuid, score: i32, both_reported: bool) -> Self {
        Self {
            event_type: MatchEventType::ScoreReported,
            match_id,
            tournament_id,
            timestamp: Utc::now(),
            data: MatchEventData::ScoreReported { player_id, score, both_reported },
        }
    }

    pub fn completed(match_id: Uuid, tournament_id: Option<Uuid>, winner_id: Option<Uuid>, player1_score: i32, player2_score: i32, elo_changes: EloChanges) -> Self {
        Self {
            event_type: MatchEventType::Completed,
            match_id,
            tournament_id,
            timestamp: Utc::now(),
            data: MatchEventData::Completed { winner_id, player1_score, player2_score, elo_changes },
        }
    }

    pub fn disputed(match_id: Uuid, tournament_id: Option<Uuid>, disputing_player_id: Uuid, reason: String) -> Self {
        Self {
            event_type: MatchEventType::Disputed,
            match_id,
            tournament_id,
            timestamp: Utc::now(),
            data: MatchEventData::Disputed { disputing_player_id, reason },
        }
    }
}

impl GlobalEvent {
    pub fn tournament_created(tournament_id: Uuid, name: String, game: String) -> Self {
        Self {
            event_type: GlobalEventType::TournamentCreated,
            timestamp: Utc::now(),
            data: GlobalEventData::TournamentCreated { tournament_id, name, game },
        }
    }

    pub fn match_completed(match_id: Uuid, game: String, winner_id: Uuid) -> Self {
        Self {
            event_type: GlobalEventType::MatchCompleted,
            timestamp: Utc::now(),
            data: GlobalEventData::MatchCompleted { match_id, game, winner_id },
        }
    }

    pub fn leaderboard_updated(game: String, top_players: Vec<LeaderboardUpdate>) -> Self {
        Self {
            event_type: GlobalEventType::LeaderboardUpdated,
            timestamp: Utc::now(),
            data: GlobalEventData::LeaderboardUpdated { game, top_players },
        }
    }
}
