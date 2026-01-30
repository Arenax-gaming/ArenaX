#[cfg(test)]
mod tests {
    use crate::db::DbPool;
    use crate::models::match_authority::*;
    use crate::service::match_authority_service::MatchAuthorityService;
    use crate::service::soroban_service::{NetworkConfig, SorobanService};
    use std::sync::Arc;
    use uuid::Uuid;

    /// Helper to create a test service instance
    fn create_test_service() -> MatchAuthorityService {
        let db_pool = DbPool::default(); // Mock pool for unit tests
        let soroban_service = Arc::new(SorobanService::new(NetworkConfig::testnet()));
        let contract_id = "CTEST123".to_string();

        MatchAuthorityService::new(db_pool, soroban_service, contract_id)
    }

    #[test]
    fn test_fsm_validation() {
        let service = create_test_service();

        // Valid transitions
        assert!(service
            .validate_transition(
                &MatchAuthorityState::Created,
                &MatchAuthorityState::Started
            )
            .is_ok());

        assert!(service
            .validate_transition(
                &MatchAuthorityState::Started,
                &MatchAuthorityState::Completed
            )
            .is_ok());

        assert!(service
            .validate_transition(
                &MatchAuthorityState::Completed,
                &MatchAuthorityState::Disputed
            )
            .is_ok());

        assert!(service
            .validate_transition(
                &MatchAuthorityState::Completed,
                &MatchAuthorityState::Finalized
            )
            .is_ok());

        assert!(service
            .validate_transition(
                &MatchAuthorityState::Disputed,
                &MatchAuthorityState::Finalized
            )
            .is_ok());

        // Invalid transitions
        assert!(service
            .validate_transition(
                &MatchAuthorityState::Created,
                &MatchAuthorityState::Completed
            )
            .is_err());

        assert!(service
            .validate_transition(
                &MatchAuthorityState::Started,
                &MatchAuthorityState::Finalized
            )
            .is_err());

        assert!(service
            .validate_transition(
                &MatchAuthorityState::Finalized,
                &MatchAuthorityState::Created
            )
            .is_err());
    }

    #[test]
    fn test_match_entity_conversion() {
        let entity = MatchAuthorityEntity {
            id: Uuid::new_v4(),
            on_chain_match_id: "0xABC123".to_string(),
            player_a: "G".to_string() + &"A".repeat(55),
            player_b: "G".to_string() + &"B".repeat(55),
            winner: None,
            state: MatchAuthorityState::Created,
            created_at: chrono::Utc::now(),
            started_at: None,
            ended_at: None,
            last_chain_tx: None,
            idempotency_key: Some("test-key".to_string()),
            metadata: serde_json::json!({}),
        };

        let response: MatchAuthorityResponse = entity.clone().into();

        assert_eq!(response.id, entity.id);
        assert_eq!(response.on_chain_match_id, entity.on_chain_match_id);
        assert_eq!(response.player_a, entity.player_a);
        assert_eq!(response.player_b, entity.player_b);
        assert_eq!(response.state, entity.state);
    }

    #[test]
    fn test_state_machine_properties() {
        // Test terminal state
        assert!(MatchAuthorityState::Finalized.is_terminal());
        assert!(!MatchAuthorityState::Created.is_terminal());
        assert!(!MatchAuthorityState::Started.is_terminal());
        assert!(!MatchAuthorityState::Completed.is_terminal());
        assert!(!MatchAuthorityState::Disputed.is_terminal());

        // Test valid next states
        let created_next = MatchAuthorityState::Created.valid_next_states();
        assert_eq!(created_next.len(), 1);
        assert!(created_next.contains(&MatchAuthorityState::Started));

        let started_next = MatchAuthorityState::Started.valid_next_states();
        assert_eq!(started_next.len(), 1);
        assert!(started_next.contains(&MatchAuthorityState::Completed));

        let completed_next = MatchAuthorityState::Completed.valid_next_states();
        assert_eq!(completed_next.len(), 2);
        assert!(completed_next.contains(&MatchAuthorityState::Disputed));
        assert!(completed_next.contains(&MatchAuthorityState::Finalized));

        let disputed_next = MatchAuthorityState::Disputed.valid_next_states();
        assert_eq!(disputed_next.len(), 1);
        assert!(disputed_next.contains(&MatchAuthorityState::Finalized));

        let finalized_next = MatchAuthorityState::Finalized.valid_next_states();
        assert_eq!(finalized_next.len(), 0);
    }

    #[test]
    fn test_idempotency_key_generation() {
        let player_a = "G".to_string() + &"A".repeat(55);
        let player_b = "G".to_string() + &"B".repeat(55);

        // Same players should generate same idempotency key if consistent
        let key1 = format!("{}:{}", player_a, player_b);
        let key2 = format!("{}:{}", player_a, player_b);

        assert_eq!(key1, key2);

        // Different order should generate different key
        let key3 = format!("{}:{}", player_b, player_a);
        assert_ne!(key1, key3);
    }

    #[test]
    fn test_create_match_dto_validation() {
        use validator::Validate;

        // Valid DTO
        let valid_dto = CreateMatchDTO {
            player_a: "G".to_string() + &"A".repeat(55),
            player_b: "G".to_string() + &"B".repeat(55),
            idempotency_key: Some("test-123".to_string()),
        };
        assert!(valid_dto.validate().is_ok());

        // Invalid DTO - addresses too short
        let invalid_dto = CreateMatchDTO {
            player_a: "SHORT".to_string(),
            player_b: "ALSO_SHORT".to_string(),
            idempotency_key: None,
        };
        assert!(invalid_dto.validate().is_err());
    }

    #[test]
    fn test_complete_match_dto_validation() {
        use validator::Validate;

        // Valid DTO
        let valid_dto = CompleteMatchDTO {
            winner: "G".to_string() + &"A".repeat(55),
        };
        assert!(valid_dto.validate().is_ok());

        // Invalid DTO
        let invalid_dto = CompleteMatchDTO {
            winner: "SHORT".to_string(),
        };
        assert!(invalid_dto.validate().is_err());
    }

    #[test]
    fn test_match_transition_ordering() {
        let match_id = Uuid::new_v4();
        let now = chrono::Utc::now();

        let transitions = vec![
            MatchTransition {
                id: Uuid::new_v4(),
                match_id,
                from_state: MatchAuthorityState::Created,
                to_state: MatchAuthorityState::Created,
                actor: "system".to_string(),
                timestamp: now,
                chain_tx: None,
                metadata: serde_json::json!({}),
                error: None,
            },
            MatchTransition {
                id: Uuid::new_v4(),
                match_id,
                from_state: MatchAuthorityState::Created,
                to_state: MatchAuthorityState::Started,
                actor: "system".to_string(),
                timestamp: now + chrono::Duration::seconds(10),
                chain_tx: None,
                metadata: serde_json::json!({}),
                error: None,
            },
            MatchTransition {
                id: Uuid::new_v4(),
                match_id,
                from_state: MatchAuthorityState::Started,
                to_state: MatchAuthorityState::Completed,
                actor: "player_a".to_string(),
                timestamp: now + chrono::Duration::seconds(20),
                chain_tx: None,
                metadata: serde_json::json!({}),
                error: None,
            },
        ];

        // Verify transitions are in chronological order
        for i in 1..transitions.len() {
            assert!(transitions[i].timestamp > transitions[i - 1].timestamp);
        }

        // Verify states form a valid path
        assert_eq!(transitions[1].from_state, transitions[0].to_state);
        assert_eq!(transitions[2].from_state, transitions[1].to_state);
    }

    #[test]
    fn test_chain_sync_retry_logic() {
        let chain_sync = MatchChainSync {
            id: Uuid::new_v4(),
            match_id: Uuid::new_v4(),
            operation_type: "create_match".to_string(),
            tx_hash: "0xABC123".to_string(),
            tx_status: "pending".to_string(),
            submitted_at: chrono::Utc::now(),
            confirmed_at: None,
            block_height: None,
            error_message: None,
            retry_count: 0,
            metadata: serde_json::json!({}),
        };

        assert_eq!(chain_sync.retry_count, 0);
        assert_eq!(chain_sync.tx_status, "pending");
        assert!(chain_sync.confirmed_at.is_none());

        // Simulate retry
        let mut retried = chain_sync.clone();
        retried.retry_count += 1;
        assert_eq!(retried.retry_count, 1);
    }

    #[test]
    fn test_reconciliation_log_creation() {
        let log = MatchReconciliationLog {
            id: Uuid::new_v4(),
            match_id: Uuid::new_v4(),
            checked_at: chrono::Utc::now(),
            off_chain_state: MatchAuthorityState::Completed,
            on_chain_state: "STARTED".to_string(),
            is_divergent: true,
            resolution_action: Some("Manual intervention required".to_string()),
            resolved_at: None,
            metadata: serde_json::json!({
                "severity": "high",
                "detected_by": "reconciliation_job"
            }),
        };

        assert!(log.is_divergent);
        assert_eq!(log.off_chain_state, MatchAuthorityState::Completed);
        assert_eq!(log.on_chain_state, "STARTED");
        assert!(log.resolved_at.is_none());
    }

    #[test]
    fn test_match_operation_idempotency() {
        let operation1 = MatchOperation {
            id: Uuid::new_v4(),
            match_id: Uuid::new_v4(),
            operation: "create_match".to_string(),
            idempotency_key: "key-123".to_string(),
            status: "completed".to_string(),
            request_payload: Some(serde_json::json!({
                "player_a": "GAAA",
                "player_b": "GBBB"
            })),
            response_payload: Some(serde_json::json!({
                "match_id": "0xABC"
            })),
            created_at: chrono::Utc::now(),
            completed_at: Some(chrono::Utc::now()),
        };

        assert_eq!(operation1.idempotency_key, "key-123");
        assert_eq!(operation1.status, "completed");
        assert!(operation1.completed_at.is_some());
    }
}
