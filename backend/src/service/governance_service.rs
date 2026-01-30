//! Governance Service
//!
//! Backend service for interacting with the ArenaX Multisig Governance contract.
//! Provides methods for creating proposals, approving them, and executing governance actions.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use super::soroban_service::{SorobanService, SorobanTxResult, TxStatus};

/// Governance service errors
#[derive(Debug, Error)]
pub enum GovernanceServiceError {
    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),

    #[error("Soroban error: {0}")]
    SorobanError(String),

    #[error("Proposal not found: {0}")]
    ProposalNotFound(String),

    #[error("Signer not found: {0}")]
    SignerNotFound(String),

    #[error("Invalid status: {0}")]
    InvalidStatus(String),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
}

/// Proposal status in the database
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "VARCHAR", rename_all = "SCREAMING_SNAKE_CASE")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProposalStatus {
    Pending,
    Approved,
    Executed,
    Cancelled,
    Failed,
}

impl std::fmt::Display for ProposalStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProposalStatus::Pending => write!(f, "PENDING"),
            ProposalStatus::Approved => write!(f, "APPROVED"),
            ProposalStatus::Executed => write!(f, "EXECUTED"),
            ProposalStatus::Cancelled => write!(f, "CANCELLED"),
            ProposalStatus::Failed => write!(f, "FAILED"),
        }
    }
}

/// DTO for creating a new proposal
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProposalDto {
    /// Target contract address (Stellar contract ID)
    pub target_contract: String,
    /// Function name to call
    pub function: String,
    /// Function arguments as JSON
    pub args: serde_json::Value,
    /// Human-readable description
    pub description: Option<String>,
    /// Optional earliest execution time (Unix timestamp)
    pub execute_after: Option<i64>,
}

/// DTO for a proposal record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposalRecord {
    pub id: Uuid,
    pub proposal_id: String,
    pub target_contract: String,
    pub function: String,
    pub args: serde_json::Value,
    pub description: Option<String>,
    pub status: ProposalStatus,
    pub proposer: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub execute_after: Option<chrono::DateTime<chrono::Utc>>,
    pub executed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_chain_tx: Option<String>,
}

/// DTO for an approval record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRecord {
    pub id: Uuid,
    pub proposal_id: String,
    pub signer: String,
    pub chain_tx: Option<String>,
    pub approved_at: chrono::DateTime<chrono::Utc>,
}

/// DTO for chain sync record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainSyncRecord {
    pub id: Uuid,
    pub proposal_id: String,
    pub operation: String,
    pub tx_hash: String,
    pub tx_status: String,
    pub synced_at: chrono::DateTime<chrono::Utc>,
}

/// Governance service for managing multisig governance
#[derive(Clone)]
pub struct GovernanceService {
    pool: PgPool,
    soroban: SorobanService,
    governance_contract_id: String,
}

impl GovernanceService {
    /// Create a new governance service instance
    pub fn new(pool: PgPool, soroban: SorobanService, governance_contract_id: String) -> Self {
        Self {
            pool,
            soroban,
            governance_contract_id,
        }
    }

    /// Create a new governance proposal
    ///
    /// # Arguments
    /// * `dto` - Proposal creation data
    /// * `signer_address` - Stellar address of the proposer
    /// * `signer_secret` - Secret key for signing the transaction
    ///
    /// # Returns
    /// The proposal ID (hex-encoded 32 bytes)
    pub async fn create_proposal(
        &self,
        dto: CreateProposalDto,
        signer_address: &str,
        signer_secret: &str,
    ) -> Result<String, GovernanceServiceError> {
        info!(
            target = dto.target_contract,
            function = dto.function,
            proposer = signer_address,
            "Creating governance proposal"
        );

        // Generate proposal ID (32 bytes, hex-encoded)
        let proposal_id_bytes = Uuid::new_v4();
        let proposal_id = format!("0x{}", hex::encode(proposal_id_bytes.as_bytes()));

        // Convert execute_after to timestamp if provided
        let execute_after_ts = dto.execute_after.map(|ts| ts as u64);

        // Build the Soroban transaction args
        let args = serde_json::json!({
            "proposer": signer_address,
            "proposal_id": proposal_id,
            "target_contract": dto.target_contract,
            "function": dto.function,
            "args": dto.args,
            "execute_after": execute_after_ts
        });

        // Submit to chain
        let tx_result = self
            .soroban
            .invoke(
                &self.governance_contract_id,
                "create_proposal",
                &args,
                signer_secret,
            )
            .await
            .map_err(|e| GovernanceServiceError::SorobanError(e.to_string()))?;

        // Store in database
        let execute_after_dt = dto.execute_after.map(|ts| {
            chrono::DateTime::from_timestamp(ts, 0)
                .unwrap_or_else(chrono::Utc::now)
        });

        sqlx::query(
            r#"
            INSERT INTO governance_proposals (
                id, proposal_id, target_contract, function, args,
                description, status, proposer, execute_after, last_chain_tx
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(&proposal_id)
        .bind(&dto.target_contract)
        .bind(&dto.function)
        .bind(&dto.args)
        .bind(&dto.description)
        .bind(ProposalStatus::Pending.to_string())
        .bind(signer_address)
        .bind(execute_after_dt)
        .bind(&tx_result.hash)
        .execute(&self.pool)
        .await?;

        // Record chain sync
        self.record_chain_sync(&proposal_id, "CREATE", &tx_result)
            .await?;

        info!(
            proposal_id = proposal_id,
            tx_hash = tx_result.hash,
            "Proposal created successfully"
        );

        Ok(proposal_id)
    }

    /// Approve a proposal
    ///
    /// # Arguments
    /// * `proposal_id` - The proposal ID to approve
    /// * `signer_address` - Stellar address of the approving signer
    /// * `signer_secret` - Secret key for signing the transaction
    pub async fn approve_proposal(
        &self,
        proposal_id: &str,
        signer_address: &str,
        signer_secret: &str,
    ) -> Result<SorobanTxResult, GovernanceServiceError> {
        info!(
            proposal_id = proposal_id,
            signer = signer_address,
            "Approving proposal"
        );

        // Verify proposal exists in database
        let proposal = self.get_proposal(proposal_id).await?;
        if proposal.is_none() {
            return Err(GovernanceServiceError::ProposalNotFound(
                proposal_id.to_string(),
            ));
        }

        // Build the Soroban transaction args
        let args = serde_json::json!({
            "signer": signer_address,
            "proposal_id": proposal_id
        });

        // Submit to chain
        let tx_result = self
            .soroban
            .invoke(&self.governance_contract_id, "approve", &args, signer_secret)
            .await
            .map_err(|e| GovernanceServiceError::SorobanError(e.to_string()))?;

        // Record approval in database
        if tx_result.status == TxStatus::Success {
            sqlx::query(
                r#"
                INSERT INTO governance_approvals (id, proposal_id, signer, chain_tx)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (proposal_id, signer) DO NOTHING
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(proposal_id)
            .bind(signer_address)
            .bind(&tx_result.hash)
            .execute(&self.pool)
            .await?;

            // Update last chain tx
            sqlx::query(
                r#"
                UPDATE governance_proposals
                SET last_chain_tx = $1
                WHERE proposal_id = $2
                "#,
            )
            .bind(&tx_result.hash)
            .bind(proposal_id)
            .execute(&self.pool)
            .await?;
        }

        // Record chain sync
        self.record_chain_sync(proposal_id, "APPROVE", &tx_result)
            .await?;

        info!(
            proposal_id = proposal_id,
            tx_hash = tx_result.hash,
            status = ?tx_result.status,
            "Approval transaction completed"
        );

        Ok(tx_result)
    }

    /// Execute an approved proposal
    ///
    /// # Arguments
    /// * `proposal_id` - The proposal ID to execute
    /// * `executor_secret` - Secret key of the executor
    pub async fn execute_proposal(
        &self,
        proposal_id: &str,
        executor_address: &str,
        executor_secret: &str,
    ) -> Result<SorobanTxResult, GovernanceServiceError> {
        info!(
            proposal_id = proposal_id,
            executor = executor_address,
            "Executing proposal"
        );

        // Build the Soroban transaction args
        let args = serde_json::json!({
            "executor": executor_address,
            "proposal_id": proposal_id
        });

        // Submit to chain
        let tx_result = self
            .soroban
            .invoke(&self.governance_contract_id, "execute", &args, executor_secret)
            .await
            .map_err(|e| GovernanceServiceError::SorobanError(e.to_string()))?;

        // Update proposal status in database
        let new_status = match tx_result.status {
            TxStatus::Success => ProposalStatus::Executed,
            TxStatus::Failed => ProposalStatus::Failed,
            TxStatus::Pending => ProposalStatus::Approved, // Keep as approved if pending
        };

        sqlx::query(
            r#"
            UPDATE governance_proposals
            SET status = $1,
                executed_at = CASE WHEN $1 = 'EXECUTED' THEN NOW() ELSE NULL END,
                last_chain_tx = $2
            WHERE proposal_id = $3
            "#,
        )
        .bind(new_status.to_string())
        .bind(&tx_result.hash)
        .bind(proposal_id)
        .execute(&self.pool)
        .await?;

        // Record chain sync
        self.record_chain_sync(proposal_id, "EXECUTE", &tx_result)
            .await?;

        info!(
            proposal_id = proposal_id,
            tx_hash = tx_result.hash,
            status = ?tx_result.status,
            "Execution transaction completed"
        );

        Ok(tx_result)
    }

    /// Cancel a proposal (proposer only)
    pub async fn cancel_proposal(
        &self,
        proposal_id: &str,
        caller_address: &str,
        caller_secret: &str,
    ) -> Result<SorobanTxResult, GovernanceServiceError> {
        info!(
            proposal_id = proposal_id,
            caller = caller_address,
            "Cancelling proposal"
        );

        // Build the Soroban transaction args
        let args = serde_json::json!({
            "caller": caller_address,
            "proposal_id": proposal_id
        });

        // Submit to chain
        let tx_result = self
            .soroban
            .invoke(
                &self.governance_contract_id,
                "cancel_proposal",
                &args,
                caller_secret,
            )
            .await
            .map_err(|e| GovernanceServiceError::SorobanError(e.to_string()))?;

        // Update proposal status in database
        if tx_result.status == TxStatus::Success {
            sqlx::query(
                r#"
                UPDATE governance_proposals
                SET status = $1, last_chain_tx = $2
                WHERE proposal_id = $3
                "#,
            )
            .bind(ProposalStatus::Cancelled.to_string())
            .bind(&tx_result.hash)
            .bind(proposal_id)
            .execute(&self.pool)
            .await?;
        }

        // Record chain sync
        self.record_chain_sync(proposal_id, "CANCEL", &tx_result)
            .await?;

        Ok(tx_result)
    }

    /// Revoke an approval
    pub async fn revoke_approval(
        &self,
        proposal_id: &str,
        signer_address: &str,
        signer_secret: &str,
    ) -> Result<SorobanTxResult, GovernanceServiceError> {
        info!(
            proposal_id = proposal_id,
            signer = signer_address,
            "Revoking approval"
        );

        // Build the Soroban transaction args
        let args = serde_json::json!({
            "signer": signer_address,
            "proposal_id": proposal_id
        });

        // Submit to chain
        let tx_result = self
            .soroban
            .invoke(
                &self.governance_contract_id,
                "revoke_approval",
                &args,
                signer_secret,
            )
            .await
            .map_err(|e| GovernanceServiceError::SorobanError(e.to_string()))?;

        // Remove approval from database if successful
        if tx_result.status == TxStatus::Success {
            sqlx::query(
                r#"
                DELETE FROM governance_approvals
                WHERE proposal_id = $1 AND signer = $2
                "#,
            )
            .bind(proposal_id)
            .bind(signer_address)
            .execute(&self.pool)
            .await?;
        }

        // Record chain sync
        self.record_chain_sync(proposal_id, "REVOKE", &tx_result)
            .await?;

        Ok(tx_result)
    }

    /// Get a proposal by ID
    pub async fn get_proposal(
        &self,
        proposal_id: &str,
    ) -> Result<Option<ProposalRecord>, GovernanceServiceError> {
        let record = sqlx::query_as!(
            ProposalRecord,
            r#"
            SELECT
                id,
                proposal_id,
                target_contract,
                function,
                args,
                description,
                status as "status: _",
                proposer,
                created_at,
                execute_after,
                executed_at,
                last_chain_tx
            FROM governance_proposals
            WHERE proposal_id = $1
            "#,
            proposal_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(record)
    }

    /// List proposals with optional status filter
    pub async fn list_proposals(
        &self,
        status: Option<ProposalStatus>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ProposalRecord>, GovernanceServiceError> {
        let records = match status {
            Some(s) => {
                sqlx::query_as!(
                    ProposalRecord,
                    r#"
                    SELECT
                        id,
                        proposal_id,
                        target_contract,
                        function,
                        args,
                        description,
                        status as "status: _",
                        proposer,
                        created_at,
                        execute_after,
                        executed_at,
                        last_chain_tx
                    FROM governance_proposals
                    WHERE status = $1
                    ORDER BY created_at DESC
                    LIMIT $2 OFFSET $3
                    "#,
                    s.to_string(),
                    limit,
                    offset
                )
                .fetch_all(&self.pool)
                .await?
            }
            None => {
                sqlx::query_as!(
                    ProposalRecord,
                    r#"
                    SELECT
                        id,
                        proposal_id,
                        target_contract,
                        function,
                        args,
                        description,
                        status as "status: _",
                        proposer,
                        created_at,
                        execute_after,
                        executed_at,
                        last_chain_tx
                    FROM governance_proposals
                    ORDER BY created_at DESC
                    LIMIT $1 OFFSET $2
                    "#,
                    limit,
                    offset
                )
                .fetch_all(&self.pool)
                .await?
            }
        };

        Ok(records)
    }

    /// Get approvals for a proposal
    pub async fn get_proposal_approvals(
        &self,
        proposal_id: &str,
    ) -> Result<Vec<ApprovalRecord>, GovernanceServiceError> {
        let records = sqlx::query_as!(
            ApprovalRecord,
            r#"
            SELECT id, proposal_id, signer, chain_tx, approved_at
            FROM governance_approvals
            WHERE proposal_id = $1
            ORDER BY approved_at ASC
            "#,
            proposal_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(records)
    }

    /// Get current signers from the contract
    pub async fn get_signers(&self) -> Result<Vec<String>, GovernanceServiceError> {
        let args = serde_json::json!({});

        // Note: This is a read-only call, we don't need to submit a transaction
        // In production, this would use a read-only RPC method
        // For now, we'll simulate the response
        warn!("get_signers: Read-only contract calls not fully implemented");

        Ok(vec![])
    }

    /// Get current threshold from the contract
    pub async fn get_threshold(&self) -> Result<u32, GovernanceServiceError> {
        // Note: This is a read-only call
        warn!("get_threshold: Read-only contract calls not fully implemented");

        Ok(0)
    }

    /// Record a chain sync event
    async fn record_chain_sync(
        &self,
        proposal_id: &str,
        operation: &str,
        tx_result: &SorobanTxResult,
    ) -> Result<(), GovernanceServiceError> {
        let tx_status = match tx_result.status {
            TxStatus::Success => "SUCCESS",
            TxStatus::Failed => "FAILED",
            TxStatus::Pending => "PENDING",
        };

        sqlx::query(
            r#"
            INSERT INTO governance_chain_sync (id, proposal_id, operation, tx_hash, tx_status)
            VALUES ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(proposal_id)
        .bind(operation)
        .bind(&tx_result.hash)
        .bind(tx_status)
        .execute(&self.pool)
        .await?;

        debug!(
            proposal_id = proposal_id,
            operation = operation,
            tx_hash = tx_result.hash,
            tx_status = tx_status,
            "Chain sync recorded"
        );

        Ok(())
    }

    /// Sync proposal status from chain
    ///
    /// Queries the blockchain for the current state of a proposal
    /// and updates the database accordingly.
    pub async fn sync_proposal_from_chain(
        &self,
        proposal_id: &str,
    ) -> Result<(), GovernanceServiceError> {
        info!(proposal_id = proposal_id, "Syncing proposal from chain");

        // Note: In production, this would query the contract state
        // and update the database to match
        warn!("sync_proposal_from_chain: Not fully implemented");

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proposal_status_display() {
        assert_eq!(ProposalStatus::Pending.to_string(), "PENDING");
        assert_eq!(ProposalStatus::Approved.to_string(), "APPROVED");
        assert_eq!(ProposalStatus::Executed.to_string(), "EXECUTED");
        assert_eq!(ProposalStatus::Cancelled.to_string(), "CANCELLED");
        assert_eq!(ProposalStatus::Failed.to_string(), "FAILED");
    }

    #[test]
    fn test_create_proposal_dto_serialization() {
        let dto = CreateProposalDto {
            target_contract: "CABC123".to_string(),
            function: "transfer".to_string(),
            args: serde_json::json!({"amount": 100}),
            description: Some("Test proposal".to_string()),
            execute_after: Some(1234567890),
        };

        let json = serde_json::to_string(&dto).unwrap();
        let deserialized: CreateProposalDto = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.target_contract, dto.target_contract);
        assert_eq!(deserialized.function, dto.function);
        assert_eq!(deserialized.description, dto.description);
        assert_eq!(deserialized.execute_after, dto.execute_after);
    }

    #[test]
    fn test_proposal_status_serialization() {
        let status = ProposalStatus::Approved;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"APPROVED\"");

        let deserialized: ProposalStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, ProposalStatus::Approved);
    }
}
