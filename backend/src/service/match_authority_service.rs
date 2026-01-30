use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::match_authority::*;
use crate::service::soroban_service::{SorobanService, SorobanTxResult};
use chrono::Utc;
use sqlx::Row;
use std::sync::Arc;
use tracing::{debug, error, info, warn};
use uuid::Uuid;
use validator::Validate;

/// Match Authority Service - FSM enforcer and blockchain coordinator
pub struct MatchAuthorityService {
    db_pool: DbPool,
    soroban_service: Arc<SorobanService>,
    match_lifecycle_contract: String,
}

impl MatchAuthorityService {
    /// Create a new Match Authority Service
    pub fn new(
        db_pool: DbPool,
        soroban_service: Arc<SorobanService>,
        match_lifecycle_contract: String,
    ) -> Self {
        Self {
            db_pool,
            soroban_service,
            match_lifecycle_contract,
        }
    }

    // =============================================================================
    // CREATE MATCH
    // =============================================================================

    /// Create a new match (CREATED state)
    /// Idempotent: same idempotency_key returns existing match
    pub async fn create_match(
        &self,
        dto: CreateMatchDTO,
        signer_secret: &str,
    ) -> Result<MatchAuthorityResponse, ApiError> {
        // Validate DTO
        validator::Validate::validate(&dto)
            .map_err(|e| ApiError::bad_request(format!("Validation error: {}", e)))?;

        // Check for idempotency
        if let Some(ref key) = dto.idempotency_key {
            if let Some(existing) = self.get_match_by_idempotency_key(key).await? {
                info!(
                    idempotency_key = key,
                    match_id = %existing.id,
                    "Returning existing match for idempotent request"
                );
                return self.get_match_with_transitions(existing.id).await;
            }
        }

        info!(
            player_a = %dto.player_a,
            player_b = %dto.player_b,
            "Creating new match"
        );

        // Step 1: Create match on blockchain
        let chain_result = self
            .create_match_on_chain(&dto, signer_secret)
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to create match on blockchain");
                ApiError::internal_error(format!("Blockchain creation failed: {}", e))
            })?;

        // Step 2: Create match entity in database
        let match_id = Uuid::new_v4();
        let match_entity = sqlx::query_as!(
            MatchAuthorityEntity,
            r#"
            INSERT INTO match_authority (
                id, on_chain_match_id, player_a, player_b, state,
                last_chain_tx, idempotency_key, metadata
            ) VALUES (
                $1, $2, $3, $4, 'CREATED'::match_authority_state, $5, $6, $7
            )
            RETURNING
                id, on_chain_match_id, player_a, player_b, winner,
                state as "state: MatchAuthorityState",
                created_at, started_at, ended_at, last_chain_tx,
                idempotency_key, metadata
            "#,
            match_id,
            chain_result.hash,
            dto.player_a,
            dto.player_b,
            chain_result.hash.clone(),
            dto.idempotency_key,
            serde_json::json!({})
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Step 3: Record blockchain sync
        self.record_chain_sync(
            match_id,
            "create_match",
            &chain_result.hash,
            "pending",
            None,
        )
        .await?;

        // Step 4: Record state transition
        self.record_transition(
            match_id,
            MatchAuthorityState::Created,
            MatchAuthorityState::Created,
            &dto.player_a,
            Some(&chain_result.hash),
            None,
        )
        .await?;

        info!(
            match_id = %match_id,
            on_chain_id = %chain_result.hash,
            "Match created successfully"
        );

        self.get_match_with_transitions(match_id).await
    }

    // =============================================================================
    // START MATCH
    // =============================================================================

    /// Start a match (CREATED -> STARTED transition)
    pub async fn start_match(
        &self,
        match_id: Uuid,
        signer_secret: &str,
    ) -> Result<MatchAuthorityResponse, ApiError> {
        // Get match
        let match_entity = self.get_match_entity(match_id).await?;

        // Validate FSM transition
        self.validate_transition(&match_entity.state, &MatchAuthorityState::Started)?;

        info!(
            match_id = %match_id,
            from_state = ?match_entity.state,
            "Starting match"
        );

        // Step 1: Submit start_match transaction to blockchain
        let chain_result = self
            .start_match_on_chain(&match_entity.on_chain_match_id, signer_secret)
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to start match on blockchain");
                ApiError::internal_error(format!("Blockchain start failed: {}", e))
            })?;

        // Step 2: Update match state
        sqlx::query!(
            r#"
            UPDATE match_authority
            SET state = 'STARTED'::match_authority_state,
                last_chain_tx = $1,
                started_at = NOW()
            WHERE id = $2
            "#,
            chain_result.hash,
            match_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Step 3: Record blockchain sync
        self.record_chain_sync(match_id, "start_match", &chain_result.hash, "pending", None)
            .await?;

        // Step 4: Record transition (trigger will auto-create, but we record explicitly)
        self.record_transition(
            match_id,
            match_entity.state,
            MatchAuthorityState::Started,
            "system",
            Some(&chain_result.hash),
            None,
        )
        .await?;

        info!(match_id = %match_id, "Match started successfully");

        self.get_match_with_transitions(match_id).await
    }

    // =============================================================================
    // COMPLETE MATCH
    // =============================================================================

    /// Complete a match (STARTED -> COMPLETED transition)
    pub async fn complete_match(
        &self,
        match_id: Uuid,
        dto: CompleteMatchDTO,
        signer_secret: &str,
    ) -> Result<MatchAuthorityResponse, ApiError> {
        // Validate DTO
        validator::Validate::validate(&dto)
            .map_err(|e| ApiError::bad_request(format!("Validation error: {}", e)))?;

        // Get match
        let match_entity = self.get_match_entity(match_id).await?;

        // Validate FSM transition
        self.validate_transition(&match_entity.state, &MatchAuthorityState::Completed)?;

        // Validate winner is one of the players
        if dto.winner != match_entity.player_a && dto.winner != match_entity.player_b {
            return Err(ApiError::bad_request(
                "Winner must be one of the match players",
            ));
        }

        info!(
            match_id = %match_id,
            winner = %dto.winner,
            "Completing match"
        );

        // Step 1: Submit complete_match transaction to blockchain
        let chain_result = self
            .complete_match_on_chain(&match_entity.on_chain_match_id, &dto.winner, signer_secret)
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to complete match on blockchain");
                ApiError::internal_error(format!("Blockchain completion failed: {}", e))
            })?;

        // Step 2: Update match state
        sqlx::query!(
            r#"
            UPDATE match_authority
            SET state = 'COMPLETED'::match_authority_state,
                winner = $1,
                last_chain_tx = $2,
                ended_at = NOW()
            WHERE id = $3
            "#,
            dto.winner,
            chain_result.hash,
            match_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Step 3: Record blockchain sync
        self.record_chain_sync(
            match_id,
            "complete_match",
            &chain_result.hash,
            "pending",
            None,
        )
        .await?;

        // Step 4: Record transition
        self.record_transition(
            match_id,
            match_entity.state,
            MatchAuthorityState::Completed,
            &dto.winner,
            Some(&chain_result.hash),
            None,
        )
        .await?;

        info!(match_id = %match_id, "Match completed successfully");

        self.get_match_with_transitions(match_id).await
    }

    // =============================================================================
    // DISPUTE MATCH
    // =============================================================================

    /// Raise a dispute for a match (COMPLETED -> DISPUTED transition)
    pub async fn raise_dispute(
        &self,
        match_id: Uuid,
        actor: &str,
        reason: String,
        signer_secret: &str,
    ) -> Result<MatchAuthorityResponse, ApiError> {
        // Get match
        let match_entity = self.get_match_entity(match_id).await?;

        // Validate FSM transition
        self.validate_transition(&match_entity.state, &MatchAuthorityState::Disputed)?;

        // Validate actor is one of the players
        if actor != match_entity.player_a && actor != match_entity.player_b {
            return Err(ApiError::forbidden("Only match players can raise disputes"));
        }

        info!(
            match_id = %match_id,
            actor = %actor,
            "Raising dispute"
        );

        // Step 1: Submit raise_dispute transaction to blockchain
        let chain_result = self
            .raise_dispute_on_chain(&match_entity.on_chain_match_id, actor, signer_secret)
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to raise dispute on blockchain");
                ApiError::internal_error(format!("Blockchain dispute failed: {}", e))
            })?;

        // Step 2: Update match state
        sqlx::query!(
            r#"
            UPDATE match_authority
            SET state = 'DISPUTED'::match_authority_state,
                last_chain_tx = $1
            WHERE id = $2
            "#,
            chain_result.hash,
            match_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Step 3: Record blockchain sync
        self.record_chain_sync(
            match_id,
            "raise_dispute",
            &chain_result.hash,
            "pending",
            None,
        )
        .await?;

        // Step 4: Record transition
        self.record_transition(
            match_id,
            match_entity.state,
            MatchAuthorityState::Disputed,
            actor,
            Some(&chain_result.hash),
            Some(serde_json::json!({ "reason": reason })),
        )
        .await?;

        info!(match_id = %match_id, "Dispute raised successfully");

        self.get_match_with_transitions(match_id).await
    }

    // =============================================================================
    // FINALIZE MATCH
    // =============================================================================

    /// Finalize a match (COMPLETED/DISPUTED -> FINALIZED transition)
    /// This performs on-chain settlement
    pub async fn finalize_match(
        &self,
        match_id: Uuid,
        signer_secret: &str,
    ) -> Result<MatchAuthorityResponse, ApiError> {
        // Get match
        let match_entity = self.get_match_entity(match_id).await?;

        // Validate FSM transition
        self.validate_transition(&match_entity.state, &MatchAuthorityState::Finalized)?;

        info!(
            match_id = %match_id,
            from_state = ?match_entity.state,
            "Finalizing match"
        );

        // Step 1: Submit finalize transaction to blockchain (settlement)
        let chain_result = self
            .finalize_match_on_chain(&match_entity.on_chain_match_id, signer_secret)
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to finalize match on blockchain");
                ApiError::internal_error(format!("Blockchain finalization failed: {}", e))
            })?;

        // Step 2: Update match state
        sqlx::query!(
            r#"
            UPDATE match_authority
            SET state = 'FINALIZED'::match_authority_state,
                last_chain_tx = $1
            WHERE id = $2
            "#,
            chain_result.hash,
            match_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Step 3: Record blockchain sync
        self.record_chain_sync(
            match_id,
            "finalize_match",
            &chain_result.hash,
            "pending",
            None,
        )
        .await?;

        // Step 4: Record transition
        self.record_transition(
            match_id,
            match_entity.state,
            MatchAuthorityState::Finalized,
            "system",
            Some(&chain_result.hash),
            None,
        )
        .await?;

        info!(match_id = %match_id, "Match finalized successfully");

        self.get_match_with_transitions(match_id).await
    }

    // =============================================================================
    // QUERY METHODS
    // =============================================================================

    /// Get match by ID
    pub async fn get_match(
        &self,
        match_id: Uuid,
    ) -> Result<MatchAuthorityResponse, ApiError> {
        self.get_match_with_transitions(match_id).await
    }

    /// Get match entity (internal)
    async fn get_match_entity(
        &self,
        match_id: Uuid,
    ) -> Result<MatchAuthorityEntity, ApiError> {
        sqlx::query_as!(
            MatchAuthorityEntity,
            r#"
            SELECT
                id, on_chain_match_id, player_a, player_b, winner,
                state as "state: MatchAuthorityState",
                created_at, started_at, ended_at, last_chain_tx,
                idempotency_key, metadata
            FROM match_authority
            WHERE id = $1
            "#,
            match_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or_else(|| ApiError::not_found("Match not found"))
    }

    /// Get match with transitions
    async fn get_match_with_transitions(
        &self,
        match_id: Uuid,
    ) -> Result<MatchAuthorityResponse, ApiError> {
        let entity = self.get_match_entity(match_id).await?;

        let transitions = self.get_match_transitions(match_id).await?;

        let mut response: MatchAuthorityResponse = entity.into();
        response.transitions = transitions;

        Ok(response)
    }

    /// Get match transitions
    async fn get_match_transitions(
        &self,
        match_id: Uuid,
    ) -> Result<Vec<MatchTransition>, ApiError> {
        sqlx::query_as!(
            MatchTransition,
            r#"
            SELECT
                id, match_id,
                from_state as "from_state: MatchAuthorityState",
                to_state as "to_state: MatchAuthorityState",
                actor, timestamp, chain_tx, metadata, error
            FROM match_transitions
            WHERE match_id = $1
            ORDER BY timestamp ASC
            "#,
            match_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))
    }

    /// Get match by idempotency key
    async fn get_match_by_idempotency_key(
        &self,
        key: &str,
    ) -> Result<Option<MatchAuthorityEntity>, ApiError> {
        sqlx::query_as!(
            MatchAuthorityEntity,
            r#"
            SELECT
                id, on_chain_match_id, player_a, player_b, winner,
                state as "state: MatchAuthorityState",
                created_at, started_at, ended_at, last_chain_tx,
                idempotency_key, metadata
            FROM match_authority
            WHERE idempotency_key = $1
            "#,
            key
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))
    }

    // =============================================================================
    // RECONCILIATION
    // =============================================================================

    /// Reconcile match state with blockchain
    /// Checks if on-chain and off-chain states match
    pub async fn reconcile_match(
        &self,
        match_id: Uuid,
    ) -> Result<bool, ApiError> {
        let match_entity = self.get_match_entity(match_id).await?;

        info!(
            match_id = %match_id,
            off_chain_state = ?match_entity.state,
            "Reconciling match state"
        );

        // Fetch on-chain state
        let on_chain_state = self
            .get_match_state_from_chain(&match_entity.on_chain_match_id)
            .await
            .map_err(|e| {
                warn!(error = %e, "Failed to fetch on-chain state");
                ApiError::internal_error("Reconciliation failed")
            })?;

        let off_chain_state_str = format!("{:?}", match_entity.state);
        let is_divergent = on_chain_state != off_chain_state_str;

        // Log reconciliation
        sqlx::query!(
            r#"
            INSERT INTO match_reconciliation_log (
                id, match_id, off_chain_state, on_chain_state, is_divergent, metadata
            ) VALUES (
                $1, $2, $3, $4, $5, $6
            )
            "#,
            Uuid::new_v4(),
            match_id,
            match_entity.state as MatchAuthorityState,
            on_chain_state,
            is_divergent,
            serde_json::json!({ "checked_at": Utc::now() })
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if is_divergent {
            warn!(
                match_id = %match_id,
                off_chain = ?match_entity.state,
                on_chain = %on_chain_state,
                "State divergence detected"
            );
        } else {
            debug!(match_id = %match_id, "States are synchronized");
        }

        Ok(!is_divergent)
    }

    // =============================================================================
    // HELPER METHODS
    // =============================================================================

    /// Validate state transition according to FSM rules
    fn validate_transition(
        &self,
        from: &MatchAuthorityState,
        to: &MatchAuthorityState,
    ) -> Result<(), ApiError> {
        if !from.can_transition_to(to) {
            return Err(ApiError::bad_request(format!(
                "Invalid state transition from {:?} to {:?}",
                from, to
            )));
        }
        Ok(())
    }

    /// Record a state transition
    async fn record_transition(
        &self,
        match_id: Uuid,
        from: MatchAuthorityState,
        to: MatchAuthorityState,
        actor: &str,
        chain_tx: Option<&str>,
        metadata: Option<serde_json::Value>,
    ) -> Result<(), ApiError> {
        sqlx::query!(
            r#"
            INSERT INTO match_transitions (
                id, match_id, from_state, to_state, actor, chain_tx, metadata
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7
            )
            "#,
            Uuid::new_v4(),
            match_id,
            from as MatchAuthorityState,
            to as MatchAuthorityState,
            actor,
            chain_tx,
            metadata.unwrap_or_else(|| serde_json::json!({}))
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    /// Record blockchain sync operation
    async fn record_chain_sync(
        &self,
        match_id: Uuid,
        operation_type: &str,
        tx_hash: &str,
        status: &str,
        error: Option<&str>,
    ) -> Result<(), ApiError> {
        sqlx::query!(
            r#"
            INSERT INTO match_chain_sync (
                id, match_id, operation_type, tx_hash, tx_status, error_message, metadata
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7
            )
            "#,
            Uuid::new_v4(),
            match_id,
            operation_type,
            tx_hash,
            status,
            error,
            serde_json::json!({})
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    // =============================================================================
    // BLOCKCHAIN INTEGRATION
    // =============================================================================

    /// Create match on Soroban
    async fn create_match_on_chain(
        &self,
        dto: &CreateMatchDTO,
        signer_secret: &str,
    ) -> Result<SorobanTxResult, String> {
        let args = serde_json::json!({
            "player_a": dto.player_a,
            "player_b": dto.player_b,
        });

        self.soroban_service
            .invoke(
                &self.match_lifecycle_contract,
                "create_match",
                &args,
                signer_secret,
            )
            .await
            .map_err(|e| format!("Soroban create_match failed: {}", e))
    }

    /// Start match on Soroban
    async fn start_match_on_chain(
        &self,
        on_chain_match_id: &str,
        signer_secret: &str,
    ) -> Result<SorobanTxResult, String> {
        let args = serde_json::json!({
            "match_id": on_chain_match_id,
        });

        self.soroban_service
            .invoke(
                &self.match_lifecycle_contract,
                "start_match",
                &args,
                signer_secret,
            )
            .await
            .map_err(|e| format!("Soroban start_match failed: {}", e))
    }

    /// Complete match on Soroban
    async fn complete_match_on_chain(
        &self,
        on_chain_match_id: &str,
        winner: &str,
        signer_secret: &str,
    ) -> Result<SorobanTxResult, String> {
        let args = serde_json::json!({
            "match_id": on_chain_match_id,
            "winner": winner,
        });

        self.soroban_service
            .invoke(
                &self.match_lifecycle_contract,
                "complete_match",
                &args,
                signer_secret,
            )
            .await
            .map_err(|e| format!("Soroban complete_match failed: {}", e))
    }

    /// Raise dispute on Soroban
    async fn raise_dispute_on_chain(
        &self,
        on_chain_match_id: &str,
        actor: &str,
        signer_secret: &str,
    ) -> Result<SorobanTxResult, String> {
        let args = serde_json::json!({
            "match_id": on_chain_match_id,
            "disputer": actor,
        });

        self.soroban_service
            .invoke(
                &self.match_lifecycle_contract,
                "raise_dispute",
                &args,
                signer_secret,
            )
            .await
            .map_err(|e| format!("Soroban raise_dispute failed: {}", e))
    }

    /// Finalize match on Soroban (settlement)
    async fn finalize_match_on_chain(
        &self,
        on_chain_match_id: &str,
        signer_secret: &str,
    ) -> Result<SorobanTxResult, String> {
        let args = serde_json::json!({
            "match_id": on_chain_match_id,
        });

        self.soroban_service
            .invoke(
                &self.match_lifecycle_contract,
                "finalize_match",
                &args,
                signer_secret,
            )
            .await
            .map_err(|e| format!("Soroban finalize_match failed: {}", e))
    }

    /// Get match state from blockchain
    async fn get_match_state_from_chain(
        &self,
        on_chain_match_id: &str,
    ) -> Result<String, String> {
        // In a real implementation, this would:
        // 1. Query the contract state
        // 2. Decode the response
        // 3. Return the match state

        // Placeholder for now
        debug!(
            on_chain_match_id = %on_chain_match_id,
            "Fetching match state from chain (placeholder)"
        );

        Ok("CREATED".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_transition() {
        let service = MatchAuthorityService {
            db_pool: DbPool::default(),
            soroban_service: Arc::new(SorobanService::new(
                crate::service::soroban_service::NetworkConfig::testnet(),
            )),
            match_lifecycle_contract: "C123".to_string(),
        };

        // Valid transition
        assert!(service
            .validate_transition(
                &MatchAuthorityState::Created,
                &MatchAuthorityState::Started
            )
            .is_ok());

        // Invalid transition
        assert!(service
            .validate_transition(
                &MatchAuthorityState::Created,
                &MatchAuthorityState::Finalized
            )
            .is_err());
    }
}
