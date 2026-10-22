use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::match_authority::*;
use crate::service::soroban_service::{SorobanService, SorobanTxResult, TxStatus};
use crate::transaction::{execute_transaction, IsolationLevel, TransactionConfig};
use chrono::Utc;
use sqlx::Row;
use std::sync::Arc;
use tracing::{debug, error, info, warn};
use uuid::Uuid;
use validator::Validate;

fn sync_status_is_successful(status: Option<&str>) -> bool {
    matches!(status.map(str::to_ascii_lowercase), Some(value) if matches!(value.as_str(), "success" | "confirmed" | "successful"))
}

/// Match Authority Service - FSM enforcer and blockchain coordinator
pub struct MatchAuthorityService {
    db_pool: DbPool,
    soroban_service: Arc<SorobanService>,
    match_lifecycle_contract: String,
    match_outcome_contract: Option<String>,
    /// Optional match-state stream (Issue #1254).
    match_events: Option<crate::realtime::event_stream::EventStream>,
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
            match_outcome_contract: None,
            match_events: None,
        }
    }

    pub fn with_match_outcome_contract(mut self, contract_id: Option<String>) -> Self {
        self.match_outcome_contract = contract_id.filter(|value| !value.trim().is_empty());
        self
    }

    pub fn with_match_events(mut self, stream: crate::realtime::event_stream::EventStream) -> Self {
        self.match_events = Some(stream);
        self
    }

    fn authority_state_name(state: crate::models::match_authority::MatchAuthorityState) -> &'static str {
        use crate::models::match_authority::MatchAuthorityState;
        match state {
            MatchAuthorityState::Created => "CREATED",
            MatchAuthorityState::Started => "STARTED",
            MatchAuthorityState::Completed => "COMPLETED",
            MatchAuthorityState::Disputed => "DISPUTED",
            MatchAuthorityState::Finalized => "FINALIZED",
        }
    }

    async fn emit_match_state(&self, match_id: Uuid, from_status: &str, to_status: &str) {
        let Some(stream) = &self.match_events else {
            return;
        };
        let event = crate::realtime::event_stream::MatchStateEvent::new(
            match_id,
            from_status,
            to_status,
        );
        if let Err(error) = stream.publish_match_state(&event).await {
            warn!(%match_id, %error, "failed to publish match authority state event");
        }
    }

    // =============================================================================
    // CREATE MATCH
    // =============================================================================

    /// Create a new match (CREATED state) with transaction isolation
    /// Idempotent: same idempotency_key returns existing match
    pub async fn create_match(
        &self,
        dto: CreateMatchDTO,
        signer_secret: &str,
    ) -> Result<MatchAuthorityResponse, ApiError> {
        // Validate DTO
        validator::Validate::validate(&dto)
            .map_err(|e| ApiError::bad_request(format!("Validation error: {}", e)))?;

        let config = TransactionConfig {
            isolation_level: IsolationLevel::Serializable,
            max_retries: 3,
            ..Default::default()
        };

        let dto_clone = dto.clone();
        let signer_secret_clone = signer_secret.to_string();
        let db_pool = self.db_pool.clone();
        let soroban_service = self.soroban_service.clone();
        let match_lifecycle_contract = self.match_lifecycle_contract.clone();

        let match_id = execute_transaction(&db_pool, &config, move |tx| {
            Box::pin(async move {
                // Check for idempotency within transaction
                if let Some(ref key) = dto_clone.idempotency_key {
                    let existing = sqlx::query_as!(
                        MatchAuthorityEntity,
                        r#"
                        SELECT
                            id, on_chain_match_id, player_a, player_b, winner,
                            state as "state: MatchAuthorityState",
                            created_at, started_at, ended_at, last_chain_tx,
                            idempotency_key, metadata
                        FROM match_authority
                        WHERE idempotency_key = $1
                        FOR UPDATE
                        "#,
                        key
                    )
                    .fetch_optional(&mut **tx)
                    .await
                    .map_err(|e| ApiError::database_error(e))?;

                    if let Some(existing) = existing {
                        info!(
                            idempotency_key = key,
                            match_id = %existing.id,
                            "Returning existing match for idempotent request"
                        );
                        return Ok::<Uuid, ApiError>(existing.id);
                    }
                }

                info!(
                    player_a = %dto_clone.player_a,
                    player_b = %dto_clone.player_b,
                    "Creating new match"
                );

                // Step 1: Create match on blockchain
                let chain_result = create_match_on_chain_helper(
                    &soroban_service,
                    &match_lifecycle_contract,
                    &dto_clone,
                    &signer_secret_clone,
                ).await.map_err(|e| {
                    error!(error = %e, "Failed to create match on blockchain");
                    ApiError::internal_error(format!("Blockchain creation failed: {}", e))
                })?;

                // Step 2: Create match entity in database
                let match_id = Uuid::new_v4();
                sqlx::query!(
                    r#"
                    INSERT INTO match_authority (
                        id, on_chain_match_id, player_a, player_b, state,
                        last_chain_tx, idempotency_key, metadata
                    ) VALUES (
                        $1, $2, $3, $4, 'CREATED'::match_authority_state, $5, $6, $7
                    )
                    "#,
                    match_id,
                    chain_result.hash,
                    dto_clone.player_a,
                    dto_clone.player_b,
                    chain_result.hash.clone(),
                    dto_clone.idempotency_key,
                    serde_json::json!({})
                )
                .execute(&mut **tx)
                .await
                .map_err(|e| ApiError::database_error(e))?;

                // Step 3: Record blockchain sync
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
                    "create_match",
                    chain_result.hash,
                    "pending",
                    None::<String>,
                    serde_json::json!({})
                )
                .execute(&mut **tx)
                .await
                .map_err(|e| ApiError::database_error(e))?;

                // Step 4: Record state transition
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
                    MatchAuthorityState::Created as MatchAuthorityState,
                    MatchAuthorityState::Created as MatchAuthorityState,
                    dto_clone.player_a,
                    chain_result.hash,
                    serde_json::json!({})
                )
                .execute(&mut **tx)
                .await
                .map_err(|e| ApiError::database_error(e))?;

                info!(
                    match_id = %match_id,
                    on_chain_id = %chain_result.hash,
                    "Match created successfully"
                );

                Ok(match_id)
            })
        }).await?;

        self.emit_match_state(match_id, "none", "CREATED").await;
        self.get_match_with_transitions(match_id).await
    }

    // =============================================================================
    // START MATCH
    // =============================================================================

    /// Start a match (CREATED -> STARTED transition) with transaction isolation
    pub async fn start_match(
        &self,
        match_id: Uuid,
        signer_secret: &str,
    ) -> Result<MatchAuthorityResponse, ApiError> {
        let config = TransactionConfig {
            isolation_level: IsolationLevel::Serializable,
            max_retries: 3,
            ..Default::default()
        };

        let match_id_clone = match_id;
        let signer_secret_clone = signer_secret.to_string();
        let db_pool = self.db_pool.clone();
        let soroban_service = self.soroban_service.clone();
        let match_lifecycle_contract = self.match_lifecycle_contract.clone();

        execute_transaction(&db_pool, &config, move |tx| {
            Box::pin(async move {
                // Get match with row lock
                let match_entity = sqlx::query_as!(
                    MatchAuthorityEntity,
                    r#"
                    SELECT
                        id, on_chain_match_id, player_a, player_b, winner,
                        state as "state: MatchAuthorityState",
                        created_at, started_at, ended_at, last_chain_tx,
                        idempotency_key, metadata
                    FROM match_authority
                    WHERE id = $1
                    FOR UPDATE
                    "#,
                    match_id_clone
                )
                .fetch_optional(&mut **tx)
                .await
                .map_err(|e| ApiError::database_error(e))?
                .ok_or_else(|| ApiError::not_found("Match not found"))?;

                // Validate FSM transition
                if !match_entity.state.can_transition_to(&MatchAuthorityState::Started) {
                    return Err(ApiError::bad_request(format!(
                        "Invalid state transition from {:?} to {:?}",
                        match_entity.state, MatchAuthorityState::Started
                    )));
                }

                info!(
                    match_id = %match_id_clone,
                    from_state = ?match_entity.state,
                    "Starting match"
                );

                // Step 1: Submit start_match transaction to blockchain
                let chain_result = start_match_on_chain_helper(
                    &soroban_service,
                    &match_lifecycle_contract,
                    &match_entity.on_chain_match_id,
                    &signer_secret_clone,
                ).await.map_err(|e| {
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
                    match_id_clone
                )
                .execute(&mut **tx)
                .await
                .map_err(|e| ApiError::database_error(e))?;

                // Step 3: Record blockchain sync
                sqlx::query!(
                    r#"
                    INSERT INTO match_chain_sync (
                        id, match_id, operation_type, tx_hash, tx_status, error_message, metadata
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7
                    )
                    "#,
                    Uuid::new_v4(),
                    match_id_clone,
                    "start_match",
                    chain_result.hash,
                    "pending",
                    None::<String>,
                    serde_json::json!({})
                )
                .execute(&mut **tx)
                .await
                .map_err(|e| ApiError::database_error(e))?;

                // Step 4: Record transition
                sqlx::query!(
                    r#"
                    INSERT INTO match_transitions (
                        id, match_id, from_state, to_state, actor, chain_tx, metadata
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7
                    )
                    "#,
                    Uuid::new_v4(),
                    match_id_clone,
                    match_entity.state as MatchAuthorityState,
                    MatchAuthorityState::Started as MatchAuthorityState,
                    "system",
                    chain_result.hash,
                    serde_json::json!({})
                )
                .execute(&mut **tx)
                .await
                .map_err(|e| ApiError::database_error(e))?;

                info!(match_id = %match_id_clone, "Match started successfully");

                Ok::<(), ApiError>(())
            })
        }).await?;

        self.emit_match_state(match_id, "CREATED", "STARTED").await;
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

        if dto.score_a < 0 || dto.score_b < 0 {
            return Err(ApiError::bad_request("Match scores must be non-negative"));
        }

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

        let mut chain_result = chain_result;
        if let Some(outcome_contract) = self.match_outcome_contract.clone() {
            let outcome_args = serde_json::json!({
                "match_id": match_entity.on_chain_match_id,
                "winner": dto.winner,
                "score_a": dto.score_a,
                "score_b": dto.score_b,
            });
            chain_result = self.soroban_service
                .invoke(
                    &outcome_contract,
                    "log_outcome",
                    &outcome_args,
                    signer_secret,
                )
                .await
                .map_err(|e| {
                    error!(error = %e, "Failed to log match outcome on blockchain");
                    ApiError::internal_error(format!("Blockchain outcome logging failed: {}", e))
                })?;
        }

        // Step 2: Update match state
        sqlx::query!(
            r#"
            UPDATE match_authority
            SET state = 'COMPLETED'::match_authority_state,
                winner = $1,
                last_chain_tx = $2,
                ended_at = NOW(),
                metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
            WHERE id = $3
            "#,
            dto.winner,
            chain_result.hash,
            match_id,
            serde_json::json!({
                "outcome": {
                    "match_id": match_entity.on_chain_match_id,
                    "winner": dto.winner,
                    "score_a": dto.score_a,
                    "score_b": dto.score_b,
                    "timestamp": Utc::now().timestamp()
                }
            })
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Step 3: Record blockchain sync
        let sync_status = match chain_result.status {
            TxStatus::Success => "success",
            TxStatus::Failed => "failed",
            TxStatus::Pending => "pending",
        };
        self.record_chain_sync(
            match_id,
            "complete_match",
            &chain_result.hash,
            sync_status,
            chain_result.error.as_deref(),
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

        // Step 5: Distribute a configured match prize. This is deliberately
        // non-blocking for the match state: payout failures remain auditable and
        // can be retried without reopening or duplicating match completion.
        self.trigger_match_prize_payout(match_id, &match_entity, &dto.winner, signer_secret)
            .await;

        info!(match_id = %match_id, "Match completed successfully");

        self.emit_match_state(
            match_id,
            Self::authority_state_name(match_entity.state),
            "COMPLETED",
        )
        .await;
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

        self.emit_match_state(
            match_id,
            Self::authority_state_name(match_entity.state),
            "DISPUTED",
        )
        .await;
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

        self.emit_match_state(
            match_id,
            Self::authority_state_name(match_entity.state),
            "FINALIZED",
        )
        .await;
        self.get_match_with_transitions(match_id).await
    }

    // =============================================================================
    // QUERY METHODS
    // =============================================================================

    /// Get match by ID
    pub async fn get_match(&self, match_id: Uuid) -> Result<MatchAuthorityResponse, ApiError> {
        self.get_match_with_transitions(match_id).await
    }

    /// Verify an outcome against the PostgreSQL transaction record.
    pub async fn verify_match_outcome(
        &self,
        match_id: Uuid,
    ) -> Result<MatchOutcomeVerificationResponse, ApiError> {
        let entity = self.get_match_entity(match_id).await?;
        let sync = sqlx::query_as::<_, (String, String)>(
            r#"
            SELECT tx_hash, tx_status
            FROM match_chain_sync
            WHERE match_id = $1 AND operation_type = 'complete_match'
            ORDER BY submitted_at DESC
            LIMIT 1
            "#,
        )
        .bind(match_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let outcome = entity.metadata.get("outcome");
        let score_a = outcome.and_then(|v| v.get("score_a")).and_then(|v| v.as_i64());
        let score_b = outcome.and_then(|v| v.get("score_b")).and_then(|v| v.as_i64());
        let timestamp = outcome.and_then(|v| v.get("timestamp")).and_then(|v| v.as_i64());
        let transaction_status = sync.as_ref().map(|(_, status)| status.clone());
        let transaction_hash = sync.map(|(hash, _)| hash);
        let verified = entity.state == MatchAuthorityState::Completed
            || entity.state == MatchAuthorityState::Finalized;

        Ok(MatchOutcomeVerificationResponse {
            match_id: entity.id,
            on_chain_match_id: entity.on_chain_match_id,
            winner: entity.winner,
            score_a,
            score_b,
            timestamp,
            transaction_hash,
            transaction_status,
            verified: verified && sync_status_is_successful(transaction_status.as_deref()),
        })
    }

    /// Get match entity (internal)
    async fn get_match_entity(&self, match_id: Uuid) -> Result<MatchAuthorityEntity, ApiError> {
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
    pub async fn reconcile_match(&self, match_id: Uuid) -> Result<bool, ApiError> {
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

    /// Trigger the configured prize payout after match verification.
    /// Match metadata may contain `prize_pool_account`, `prize_amount`, and
    /// optional `prize_asset` (defaults to XLM). Missing payout configuration
    /// keeps casual matches free of unintended transfers.
    async fn trigger_match_prize_payout(
        &self,
        match_id: Uuid,
        match_entity: &MatchAuthorityEntity,
        winner: &str,
        signer_secret: &str,
    ) {
        let prize_amount = match match_entity.metadata.get("prize_amount").and_then(|v| v.as_i64()) {
            Some(amount) if amount > 0 => amount,
            _ => return,
        };
        let prize_pool_account = match match_entity.metadata.get("prize_pool_account").and_then(|v| v.as_str()) {
            Some(account) if !account.is_empty() => account.to_string(),
            _ => return,
        };
        let prize_asset = match_entity
            .metadata
            .get("prize_asset")
            .and_then(|v| v.as_str())
            .unwrap_or("XLM")
            .to_string();

        // Idempotency: a confirmed payout is never submitted twice.
        if let Ok(Some(_)) = sqlx::query_scalar::<_, String>(
            r#"
            SELECT tx_hash FROM match_chain_sync
            WHERE match_id = $1 AND operation_type = 'distribute_match_prize'
              AND tx_status = 'confirmed'
            LIMIT 1
            "#,
        )
        .bind(match_id)
        .fetch_optional(&self.db_pool)
        .await
        {
            info!(%match_id, "Match prize already distributed; skipping duplicate payout");
            return;
        }

        let prize_contract = match_entity
            .metadata
            .get("prize_contract_id")
            .and_then(|v| v.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let Some(prize_contract) = prize_contract else {
            warn!(
                %match_id,
                "Match prize configured but prize_contract_id is missing; payout was not submitted"
            );
            return;
        };
        let args = serde_json::json!({
            "tournament_id": match_entity.id.to_string(),
            "prize_pool_account": prize_pool_account,
            "recipient": winner,
            "winner": winner,
            "amount": prize_amount,
            "currency": prize_asset,
            "asset": prize_asset,
        });

        match self
            .soroban_service
            .invoke(
                &prize_contract,
                "distribute",
                &args,
                signer_secret,
            )
            .await
        {
            Ok(result) if result.status == crate::service::soroban_service::TxStatus::Success => {
                info!(
                    %match_id,
                    winner,
                    tx_hash = %result.hash,
                    amount = prize_amount,
                    asset = %prize_asset,
                    "Match prize distributed and transaction confirmed"
                );
                let _ = self
                    .record_chain_sync(
                        match_id,
                        "distribute_match_prize",
                        &result.hash,
                        "confirmed",
                        None,
                    )
                    .await;

                let mut metadata = match_entity.metadata.clone();
                metadata["prize_tx_hash"] = serde_json::Value::String(result.hash);
                metadata["prize_asset"] = serde_json::Value::String(prize_asset);
                metadata["prize_amount"] = serde_json::json!(prize_amount);
                if let Err(error) = sqlx::query(
                    "UPDATE match_authority SET metadata = $1 WHERE id = $2",
                )
                .bind(metadata)
                .bind(match_id)
                .execute(&self.db_pool)
                .await
                {
                    error!(%match_id, %error, "Prize payout confirmed but metadata update failed");
                }
            }
            Ok(result) => {
                let reason = result.error.unwrap_or_else(|| {
                    format!("transaction status {:?}", result.status)
                });
                error!(%match_id, winner, tx_hash = %result.hash, %reason, "Match prize payout failed");
                let _ = self
                    .record_chain_sync(
                        match_id,
                        "distribute_match_prize",
                        &result.hash,
                        "failed",
                        Some(&reason),
                    )
                    .await;
            }
            Err(error) => {
                error!(%match_id, winner, %error, "Failed to submit match prize payout");
                let failure_ref = format!(
                    "payout-failed-{}-{}",
                    match_id,
                    Utc::now().timestamp_millis()
                );
                let _ = self
                    .record_chain_sync(
                        match_id,
                        "distribute_match_prize",
                        &failure_ref,
                        "failed",
                        Some(&error.to_string()),
                    )
                    .await;
            }
        }
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
    async fn get_match_state_from_chain(&self, on_chain_match_id: &str) -> Result<String, String> {
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

// =============================================================================
// HELPER FUNCTIONS FOR TRANSACTIONS
// =============================================================================

/// Helper function to create match on chain (used inside transactions)
async fn create_match_on_chain_helper(
    soroban_service: &Arc<SorobanService>,
    match_lifecycle_contract: &str,
    dto: &CreateMatchDTO,
    signer_secret: &str,
) -> Result<SorobanTxResult, String> {
    let args = serde_json::json!({
        "player_a": dto.player_a,
        "player_b": dto.player_b,
    });

    soroban_service
        .invoke(
            match_lifecycle_contract,
            "create_match",
            &args,
            signer_secret,
        )
        .await
        .map_err(|e| format!("Soroban create_match failed: {}", e))
}

/// Helper function to start match on chain (used inside transactions)
async fn start_match_on_chain_helper(
    soroban_service: &Arc<SorobanService>,
    match_lifecycle_contract: &str,
    on_chain_match_id: &str,
    signer_secret: &str,
) -> Result<SorobanTxResult, String> {
    let args = serde_json::json!({
        "match_id": on_chain_match_id,
    });

    soroban_service
        .invoke(
            match_lifecycle_contract,
            "start_match",
            &args,
            signer_secret,
        )
        .await
        .map_err(|e| format!("Soroban start_match failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_transition() {
        let service = MatchAuthorityService {
            db_pool: sqlx::Pool::connect_lazy("postgres://localhost/arenax").unwrap(),
            soroban_service: Arc::new(SorobanService::new(
                crate::service::soroban_service::NetworkConfig::testnet(),
            )),
            match_lifecycle_contract: "C123".to_string(),
        };

        // Valid transition
        assert!(service
            .validate_transition(&MatchAuthorityState::Created, &MatchAuthorityState::Started)
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
