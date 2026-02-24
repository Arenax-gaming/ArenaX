use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

/// Match Authority State - represents the finite state machine states
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, sqlx::Type)]
#[sqlx(
    type_name = "match_authority_state",
    rename_all = "SCREAMING_SNAKE_CASE"
)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MatchAuthorityState {
    Created,
    Started,
    Completed,
    Disputed,
    Finalized,
}

impl MatchAuthorityState {
    /// Check if transition to another state is valid
    pub fn can_transition_to(&self, to: &MatchAuthorityState) -> bool {
        match (self, to) {
            // CREATED -> STARTED
            (MatchAuthorityState::Created, MatchAuthorityState::Started) => true,
            // STARTED -> COMPLETED
            (MatchAuthorityState::Started, MatchAuthorityState::Completed) => true,
            // COMPLETED -> DISPUTED or FINALIZED
            (MatchAuthorityState::Completed, MatchAuthorityState::Disputed) => true,
            (MatchAuthorityState::Completed, MatchAuthorityState::Finalized) => true,
            // DISPUTED -> FINALIZED
            (MatchAuthorityState::Disputed, MatchAuthorityState::Finalized) => true,
            // Same state is allowed (idempotency)
            (a, b) if a == b => true,
            // All other transitions are invalid
            _ => false,
        }
    }

    /// Get all valid next states from current state
    pub fn valid_next_states(&self) -> Vec<MatchAuthorityState> {
        match self {
            MatchAuthorityState::Created => vec![MatchAuthorityState::Started],
            MatchAuthorityState::Started => vec![MatchAuthorityState::Completed],
            MatchAuthorityState::Completed => vec![
                MatchAuthorityState::Disputed,
                MatchAuthorityState::Finalized,
            ],
            MatchAuthorityState::Disputed => vec![MatchAuthorityState::Finalized],
            MatchAuthorityState::Finalized => vec![], // Terminal state
        }
    }

    /// Check if state is terminal
    pub fn is_terminal(&self) -> bool {
        matches!(self, MatchAuthorityState::Finalized)
    }
}

/// Core Match Authority Entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MatchAuthorityEntity {
    pub id: Uuid,
    pub on_chain_match_id: String,
    pub player_a: String,
    pub player_b: String,
    pub winner: Option<String>,
    pub state: MatchAuthorityState,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub last_chain_tx: Option<String>,
    pub idempotency_key: Option<String>,
    pub metadata: serde_json::Value,
}

/// Match State Transition Record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MatchTransition {
    pub id: Uuid,
    pub match_id: Uuid,
    pub from_state: MatchAuthorityState,
    pub to_state: MatchAuthorityState,
    pub actor: String,
    pub timestamp: DateTime<Utc>,
    pub chain_tx: Option<String>,
    pub metadata: serde_json::Value,
    pub error: Option<String>,
}

/// Blockchain Sync Tracking
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MatchChainSync {
    pub id: Uuid,
    pub match_id: Uuid,
    pub operation_type: String,
    pub tx_hash: String,
    pub tx_status: String,
    pub submitted_at: DateTime<Utc>,
    pub confirmed_at: Option<DateTime<Utc>>,
    pub block_height: Option<i64>,
    pub error_message: Option<String>,
    pub retry_count: i32,
    pub metadata: serde_json::Value,
}

/// Reconciliation Log Entry
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MatchReconciliationLog {
    pub id: Uuid,
    pub match_id: Uuid,
    pub checked_at: DateTime<Utc>,
    pub off_chain_state: MatchAuthorityState,
    pub on_chain_state: String,
    pub is_divergent: bool,
    pub resolution_action: Option<String>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub metadata: serde_json::Value,
}

/// Idempotency Operation Tracking
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MatchOperation {
    pub id: Uuid,
    pub match_id: Uuid,
    pub operation: String,
    pub idempotency_key: String,
    pub status: String,
    pub request_payload: Option<serde_json::Value>,
    pub response_payload: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

// ===== API DTOs =====

/// Create Match Request DTO
#[derive(Debug, Deserialize, Serialize, Clone, Validate)]
pub struct CreateMatchDTO {
    #[validate(length(min = 56, max = 56))]
    pub player_a: String,
    #[validate(length(min = 56, max = 56))]
    pub player_b: String,
    pub idempotency_key: Option<String>,
}

/// Complete Match Request DTO
#[derive(Debug, Deserialize, Serialize, Clone, Validate)]
pub struct CompleteMatchDTO {
    #[validate(length(min = 56, max = 56))]
    pub winner: String,
}

/// Match Response DTO
#[derive(Debug, Serialize, Deserialize)]
pub struct MatchAuthorityResponse {
    pub id: Uuid,
    pub on_chain_match_id: String,
    pub player_a: String,
    pub player_b: String,
    pub winner: Option<String>,
    pub state: MatchAuthorityState,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub last_chain_tx: Option<String>,
    pub transitions: Vec<MatchTransition>,
}

impl From<MatchAuthorityEntity> for MatchAuthorityResponse {
    fn from(entity: MatchAuthorityEntity) -> Self {
        Self {
            id: entity.id,
            on_chain_match_id: entity.on_chain_match_id,
            player_a: entity.player_a,
            player_b: entity.player_b,
            winner: entity.winner,
            state: entity.state,
            created_at: entity.created_at,
            started_at: entity.started_at,
            ended_at: entity.ended_at,
            last_chain_tx: entity.last_chain_tx,
            transitions: vec![], // Will be populated by service
        }
    }
}

/// Transition List Response
#[derive(Debug, Serialize, Deserialize)]
pub struct TransitionListResponse {
    pub match_id: Uuid,
    pub transitions: Vec<MatchTransition>,
    pub total: usize,
}

/// Chain Sync Status Response
#[derive(Debug, Serialize, Deserialize)]
pub struct ChainSyncStatusResponse {
    pub match_id: Uuid,
    pub pending_operations: Vec<MatchChainSync>,
    pub last_confirmed_operation: Option<MatchChainSync>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_state_transitions() {
        let created = MatchAuthorityState::Created;
        let started = MatchAuthorityState::Started;
        let completed = MatchAuthorityState::Completed;
        let disputed = MatchAuthorityState::Disputed;
        let finalized = MatchAuthorityState::Finalized;

        // Valid transitions
        assert!(created.can_transition_to(&started));
        assert!(started.can_transition_to(&completed));
        assert!(completed.can_transition_to(&disputed));
        assert!(completed.can_transition_to(&finalized));
        assert!(disputed.can_transition_to(&finalized));

        // Idempotent (same state)
        assert!(created.can_transition_to(&created));
        assert!(started.can_transition_to(&started));

        // Invalid transitions
        assert!(!created.can_transition_to(&completed));
        assert!(!started.can_transition_to(&finalized));
        assert!(!disputed.can_transition_to(&started));
        assert!(!finalized.can_transition_to(&created));
    }

    #[test]
    fn test_terminal_state() {
        assert!(!MatchAuthorityState::Created.is_terminal());
        assert!(!MatchAuthorityState::Started.is_terminal());
        assert!(!MatchAuthorityState::Completed.is_terminal());
        assert!(!MatchAuthorityState::Disputed.is_terminal());
        assert!(MatchAuthorityState::Finalized.is_terminal());
    }

    #[test]
    fn test_valid_next_states() {
        let created = MatchAuthorityState::Created;
        assert_eq!(
            created.valid_next_states(),
            vec![MatchAuthorityState::Started]
        );

        let completed = MatchAuthorityState::Completed;
        let next_states = completed.valid_next_states();
        assert!(next_states.contains(&MatchAuthorityState::Disputed));
        assert!(next_states.contains(&MatchAuthorityState::Finalized));

        let finalized = MatchAuthorityState::Finalized;
        assert_eq!(finalized.valid_next_states(), vec![]);
    }

    #[test]
    fn test_state_serialization() {
        let state = MatchAuthorityState::Created;
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(json, "\"CREATED\"");

        let deserialized: MatchAuthorityState = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, state);
    }

    #[test]
    fn test_create_match_dto_validation() {
        let valid_dto = CreateMatchDTO {
            player_a: "G".to_string() + &"A".repeat(55),
            player_b: "G".to_string() + &"B".repeat(55),
            idempotency_key: Some("unique-key-123".to_string()),
        };

        assert!(Validate::validate(&valid_dto).is_ok());

        let invalid_dto = CreateMatchDTO {
            player_a: "SHORT".to_string(),
            player_b: "ALSO_SHORT".to_string(),
            idempotency_key: None,
        };

        assert!(Validate::validate(&invalid_dto).is_err());
    }

    #[test]
    fn test_match_entity_to_response() {
        let entity = MatchAuthorityEntity {
            id: Uuid::new_v4(),
            on_chain_match_id: "0x123".to_string(),
            player_a: "G".to_string() + &"A".repeat(55),
            player_b: "G".to_string() + &"B".repeat(55),
            winner: None,
            state: MatchAuthorityState::Created,
            created_at: Utc::now(),
            started_at: None,
            ended_at: None,
            last_chain_tx: None,
            idempotency_key: None,
            metadata: serde_json::json!({}),
        };

        let response: MatchAuthorityResponse = entity.clone().into();
        assert_eq!(response.id, entity.id);
        assert_eq!(response.state, entity.state);
        assert_eq!(response.transitions.len(), 0);
    }
}
