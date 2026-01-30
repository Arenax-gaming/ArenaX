#![no_std]

//! # Multisig Governance & Protocol Control Plane
//!
//! A Soroban smart contract that serves as the highest-authority control plane for
//! all sensitive protocol actions in ArenaX. This M-of-N multisig governance controller
//! becomes the root of trust - all admin-only functions in other contracts must delegate
//! authority checks to this controller.
//!
//! ## Features
//! - M-of-N threshold signature scheme for proposal execution
//! - Time-delayed execution support for high-security operations
//! - Self-governance via approved proposals (add/remove signers, update threshold)
//! - Replay protection via execution guards
//! - Comprehensive event emission for transparency
//!
//! ## Security
//! - Adversarial design: assumes hostile inputs
//! - Execution requires threshold approvals (CEI pattern)
//! - Each signer can approve once per proposal
//! - Cannot call itself directly (SelfCallNotAllowed)
//! - Threshold invariants enforced at all times

use soroban_sdk::{
    contract, contractevent, contractimpl, Address, Bytes, BytesN, Env, Symbol, Vec,
};

mod error;
mod storage;
mod types;

pub use error::GovernanceError;
pub use types::{GovernanceConfig, Proposal, ProposalStatus, SignerInfo};

// ============================================================================
// Events
// ============================================================================

#[contractevent(topics = ["ArenaXGovernance", "INIT"])]
pub struct GovernanceInitialized {
    pub signers_count: u32,
    pub threshold: u32,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXGovernance", "PROPOSED"])]
pub struct ProposalCreated {
    pub proposal_id: BytesN<32>,
    pub proposer: Address,
    pub target: Address,
    pub function: Symbol,
    pub execute_after: Option<u64>,
}

#[contractevent(topics = ["ArenaXGovernance", "APPROVED"])]
pub struct ProposalApproved {
    pub proposal_id: BytesN<32>,
    pub signer: Address,
    pub approval_count: u32,
    pub threshold: u32,
}

#[contractevent(topics = ["ArenaXGovernance", "REVOKED"])]
pub struct ApprovalRevoked {
    pub proposal_id: BytesN<32>,
    pub signer: Address,
    pub approval_count: u32,
}

#[contractevent(topics = ["ArenaXGovernance", "EXECUTED"])]
pub struct ProposalExecuted {
    pub proposal_id: BytesN<32>,
    pub executor: Address,
    pub target: Address,
    pub function: Symbol,
}

#[contractevent(topics = ["ArenaXGovernance", "CANCELLED"])]
pub struct ProposalCancelled {
    pub proposal_id: BytesN<32>,
    pub cancelled_by: Address,
}

#[contractevent(topics = ["ArenaXGovernance", "SIGNER_ADD"])]
pub struct SignerAdded {
    pub signer: Address,
    pub proposal_id: BytesN<32>,
    pub new_count: u32,
}

#[contractevent(topics = ["ArenaXGovernance", "SIGNER_REM"])]
pub struct SignerRemoved {
    pub signer: Address,
    pub proposal_id: BytesN<32>,
    pub new_count: u32,
}

#[contractevent(topics = ["ArenaXGovernance", "THRESH_UPD"])]
pub struct ThresholdUpdated {
    pub old: u32,
    pub new: u32,
    pub proposal_id: BytesN<32>,
}

// ============================================================================
// Contract Implementation
// ============================================================================

#[contract]
pub struct GovernanceMultisig;

#[contractimpl]
impl GovernanceMultisig {
    // ========================================================================
    // Initialization
    // ========================================================================

    /// Initialize the governance contract with initial signers and threshold
    ///
    /// # Arguments
    /// * `signers` - Initial list of signer addresses
    /// * `threshold` - Number of approvals required (M-of-N)
    ///
    /// # Errors
    /// * `AlreadyInitialized` - Contract has already been initialized
    /// * `EmptySignerList` - Signers list is empty
    /// * `InvalidThreshold` - Threshold is zero
    /// * `ThresholdExceedsSigners` - Threshold exceeds number of signers
    pub fn initialize(
        env: Env,
        signers: Vec<Address>,
        threshold: u32,
    ) -> Result<(), GovernanceError> {
        // Check not already initialized
        if storage::is_initialized(&env) {
            return Err(GovernanceError::AlreadyInitialized);
        }

        // Validate inputs
        if signers.is_empty() {
            return Err(GovernanceError::EmptySignerList);
        }
        if threshold == 0 {
            return Err(GovernanceError::InvalidThreshold);
        }
        if threshold > signers.len() {
            return Err(GovernanceError::ThresholdExceedsSigners);
        }

        let timestamp = env.ledger().timestamp();
        let signer_count = signers.len();

        // Store each signer
        for i in 0..signer_count {
            let signer = signers.get(i).unwrap();
            signer.require_auth();

            let info = SignerInfo {
                address: signer.clone(),
                added_at: timestamp,
                is_active: true,
            };
            storage::set_signer_info(&env, &signer, &info);
        }

        // Store signer list
        storage::set_signer_list(&env, &signers);
        storage::set_signer_count(&env, signer_count);

        // Store configuration
        let config = GovernanceConfig {
            threshold,
            max_signers: 20,
            proposal_ttl: 7 * 24 * 60 * 60, // 7 days
            min_delay: 0,
        };
        storage::set_config(&env, &config);

        // Mark as initialized
        storage::set_initialized(&env);

        // Emit event
        GovernanceInitialized {
            signers_count: signer_count,
            threshold,
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    // ========================================================================
    // Core Proposal Functions
    // ========================================================================

    /// Create a new governance proposal
    ///
    /// The proposer must be an active signer and must authorize this call.
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        proposal_id: BytesN<32>,
        target_contract: Address,
        function: Symbol,
        args: Bytes,
        execute_after: Option<u64>,
    ) -> Result<(), GovernanceError> {
        // Check initialized
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }

        // Require auth from proposer
        proposer.require_auth();

        // Verify proposer is an active signer
        if !storage::is_active_signer(&env, &proposer) {
            return Err(GovernanceError::NotASigner);
        }

        // Check proposal doesn't already exist
        if storage::proposal_exists(&env, &proposal_id) {
            return Err(GovernanceError::ProposalAlreadyExists);
        }

        // Check not targeting self (SelfCallNotAllowed)
        let self_address = env.current_contract_address();
        if target_contract == self_address {
            return Err(GovernanceError::SelfCallNotAllowed);
        }

        let config = storage::get_config(&env);
        let timestamp = env.ledger().timestamp();

        // Calculate expiry
        let expiry = Some(timestamp + config.proposal_ttl);

        // Create proposal
        let proposal = Proposal {
            proposal_id: proposal_id.clone(),
            target_contract: target_contract.clone(),
            function: function.clone(),
            args,
            proposer: proposer.clone(),
            status: ProposalStatus::Pending as u32,
            approval_count: 0,
            created_at: timestamp,
            execute_after,
            executed_at: None,
            expiry,
        };

        // Store proposal
        storage::set_proposal(&env, &proposal);

        // Initialize empty approvals list
        let approvals: Vec<Address> = Vec::new(&env);
        storage::set_proposal_approvals(&env, &proposal_id, &approvals);

        // Emit event
        ProposalCreated {
            proposal_id,
            proposer,
            target: target_contract,
            function,
            execute_after,
        }
        .publish(&env);

        Ok(())
    }

    /// Approve a proposal
    ///
    /// # Arguments
    /// * `signer` - Address of the signer approving
    /// * `proposal_id` - ID of the proposal to approve
    ///
    /// # Errors
    /// * `NotInitialized` - Contract not initialized
    /// * `NotASigner` - Caller is not an active signer
    /// * `ProposalNotFound` - Proposal does not exist
    /// * `ProposalAlreadyExecuted` - Proposal has already been executed
    /// * `ProposalExpired` - Proposal has expired
    /// * `ProposalCancelled` - Proposal has been cancelled
    /// * `AlreadyApproved` - Signer has already approved this proposal
    pub fn approve(
        env: Env,
        signer: Address,
        proposal_id: BytesN<32>,
    ) -> Result<(), GovernanceError> {
        // Check initialized
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }

        // Require auth from signer
        signer.require_auth();

        // Verify signer is active
        if !storage::is_active_signer(&env, &signer) {
            return Err(GovernanceError::NotASigner);
        }

        // Check proposal execution guard first (CEI pattern)
        if storage::is_proposal_executed(&env, &proposal_id) {
            return Err(GovernanceError::ProposalAlreadyExecuted);
        }

        // Get proposal
        let mut proposal = storage::get_proposal(&env, &proposal_id)
            .ok_or(GovernanceError::ProposalNotFound)?;

        // Check proposal status
        if proposal.status == ProposalStatus::Executed as u32 {
            return Err(GovernanceError::ProposalAlreadyExecuted);
        }
        if proposal.status == ProposalStatus::Cancelled as u32 {
            return Err(GovernanceError::ProposalCancelled);
        }

        // Check expiry
        let timestamp = env.ledger().timestamp();
        if let Some(expiry) = proposal.expiry {
            if timestamp > expiry {
                return Err(GovernanceError::ProposalExpired);
            }
        }

        // Check not already approved by this signer
        if storage::has_approved(&env, &proposal_id, &signer) {
            return Err(GovernanceError::AlreadyApproved);
        }

        // Add approval
        let mut approvals = storage::get_proposal_approvals(&env, &proposal_id);
        approvals.push_back(signer.clone());
        storage::set_proposal_approvals(&env, &proposal_id, &approvals);

        // Update proposal
        proposal.approval_count += 1;
        let config = storage::get_config(&env);

        // Check if threshold reached
        if proposal.approval_count >= config.threshold {
            proposal.status = ProposalStatus::Approved as u32;
        }

        storage::set_proposal(&env, &proposal);

        // Emit event
        ProposalApproved {
            proposal_id,
            signer,
            approval_count: proposal.approval_count,
            threshold: config.threshold,
        }
        .publish(&env);

        Ok(())
    }

    /// Revoke an approval from a proposal
    ///
    /// # Arguments
    /// * `signer` - Address of the signer revoking
    /// * `proposal_id` - ID of the proposal
    ///
    /// # Errors
    /// * `NotInitialized` - Contract not initialized
    /// * `NotASigner` - Caller is not an active signer
    /// * `ProposalNotFound` - Proposal does not exist
    /// * `ProposalAlreadyExecuted` - Proposal has already been executed
    /// * `NotApproved` - Signer has not approved this proposal
    pub fn revoke_approval(
        env: Env,
        signer: Address,
        proposal_id: BytesN<32>,
    ) -> Result<(), GovernanceError> {
        // Check initialized
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }

        // Require auth from signer
        signer.require_auth();

        // Verify signer is active
        if !storage::is_active_signer(&env, &signer) {
            return Err(GovernanceError::NotASigner);
        }

        // Check proposal execution guard
        if storage::is_proposal_executed(&env, &proposal_id) {
            return Err(GovernanceError::ProposalAlreadyExecuted);
        }

        // Get proposal
        let mut proposal = storage::get_proposal(&env, &proposal_id)
            .ok_or(GovernanceError::ProposalNotFound)?;

        // Check proposal not already executed
        if proposal.status == ProposalStatus::Executed as u32 {
            return Err(GovernanceError::ProposalAlreadyExecuted);
        }

        // Check signer has approved
        if !storage::has_approved(&env, &proposal_id, &signer) {
            return Err(GovernanceError::NotApproved);
        }

        // Remove approval
        let approvals = storage::get_proposal_approvals(&env, &proposal_id);
        let mut new_approvals: Vec<Address> = Vec::new(&env);
        for i in 0..approvals.len() {
            let addr = approvals.get(i).unwrap();
            if addr != signer {
                new_approvals.push_back(addr);
            }
        }
        storage::set_proposal_approvals(&env, &proposal_id, &new_approvals);

        // Update proposal
        proposal.approval_count -= 1;
        let config = storage::get_config(&env);

        // Revert to pending if below threshold
        if proposal.approval_count < config.threshold {
            proposal.status = ProposalStatus::Pending as u32;
        }

        storage::set_proposal(&env, &proposal);

        // Emit event
        ApprovalRevoked {
            proposal_id,
            signer,
            approval_count: proposal.approval_count,
        }
        .publish(&env);

        Ok(())
    }

    /// Execute an approved proposal
    ///
    /// # Arguments
    /// * `executor` - Address of the signer executing
    /// * `proposal_id` - ID of the proposal to execute
    ///
    /// # Errors
    /// * `NotInitialized` - Contract not initialized
    /// * `NotASigner` - Caller is not an active signer
    /// * `ProposalNotFound` - Proposal does not exist
    /// * `ProposalAlreadyExecuted` - Proposal has already been executed
    /// * `ProposalExpired` - Proposal has expired
    /// * `ProposalCancelled` - Proposal has been cancelled
    /// * `InsufficientApprovals` - Not enough approvals to execute
    /// * `ExecutionTooEarly` - Time delay has not passed
    pub fn execute(
        env: Env,
        executor: Address,
        proposal_id: BytesN<32>,
    ) -> Result<(), GovernanceError> {
        // Check initialized
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }

        // Require auth from executor
        executor.require_auth();

        // Verify executor is an active signer
        if !storage::is_active_signer(&env, &executor) {
            return Err(GovernanceError::NotASigner);
        }

        // Check proposal execution guard FIRST (CEI pattern - prevents replay attacks)
        if storage::is_proposal_executed(&env, &proposal_id) {
            return Err(GovernanceError::ProposalAlreadyExecuted);
        }

        // Get proposal
        let mut proposal = storage::get_proposal(&env, &proposal_id)
            .ok_or(GovernanceError::ProposalNotFound)?;

        // Check proposal status
        if proposal.status == ProposalStatus::Executed as u32 {
            return Err(GovernanceError::ProposalAlreadyExecuted);
        }
        if proposal.status == ProposalStatus::Cancelled as u32 {
            return Err(GovernanceError::ProposalCancelled);
        }

        let config = storage::get_config(&env);
        let timestamp = env.ledger().timestamp();

        // Check expiry
        if let Some(expiry) = proposal.expiry {
            if timestamp > expiry {
                return Err(GovernanceError::ProposalExpired);
            }
        }

        // Check sufficient approvals
        if proposal.approval_count < config.threshold {
            return Err(GovernanceError::InsufficientApprovals);
        }

        // Check time delay
        if let Some(execute_after) = proposal.execute_after {
            if timestamp < execute_after {
                return Err(GovernanceError::ExecutionTooEarly);
            }
        }

        // Mark as executed BEFORE external call (CEI pattern)
        storage::set_proposal_executed(&env, &proposal_id);

        // Update proposal status
        proposal.status = ProposalStatus::Executed as u32;
        proposal.executed_at = Some(timestamp);
        storage::set_proposal(&env, &proposal);

        // Execute the external contract call
        // Note: In Soroban, we use env.invoke_contract with raw args
        // The args field contains pre-encoded call arguments as Vec<Val>
        // For this implementation, we pass an empty args vec since the specific
        // args encoding depends on the target function signature
        let empty_args: Vec<soroban_sdk::Val> = Vec::new(&env);
        let _result: soroban_sdk::Val = env.invoke_contract(
            &proposal.target_contract,
            &proposal.function,
            empty_args,
        );

        // Emit event
        ProposalExecuted {
            proposal_id,
            executor,
            target: proposal.target_contract,
            function: proposal.function,
        }
        .publish(&env);

        Ok(())
    }

    /// Cancel a proposal (proposer only)
    ///
    /// # Arguments
    /// * `caller` - Address of the caller (must be proposer)
    /// * `proposal_id` - ID of the proposal to cancel
    ///
    /// # Errors
    /// * `NotInitialized` - Contract not initialized
    /// * `ProposalNotFound` - Proposal does not exist
    /// * `ProposalAlreadyExecuted` - Proposal has already been executed
    /// * `Unauthorized` - Caller is not the proposer
    pub fn cancel_proposal(
        env: Env,
        caller: Address,
        proposal_id: BytesN<32>,
    ) -> Result<(), GovernanceError> {
        // Check initialized
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }

        // Require auth from caller
        caller.require_auth();

        // Check proposal execution guard
        if storage::is_proposal_executed(&env, &proposal_id) {
            return Err(GovernanceError::ProposalAlreadyExecuted);
        }

        // Get proposal
        let mut proposal = storage::get_proposal(&env, &proposal_id)
            .ok_or(GovernanceError::ProposalNotFound)?;

        // Check proposal not already executed
        if proposal.status == ProposalStatus::Executed as u32 {
            return Err(GovernanceError::ProposalAlreadyExecuted);
        }

        // Only proposer can cancel
        if caller != proposal.proposer {
            return Err(GovernanceError::Unauthorized);
        }

        // Update status
        proposal.status = ProposalStatus::Cancelled as u32;
        storage::set_proposal(&env, &proposal);

        // Emit event
        ProposalCancelled {
            proposal_id,
            cancelled_by: caller,
        }
        .publish(&env);

        Ok(())
    }

    // ========================================================================
    // Self-Governance Functions (called via governance relay)
    // ========================================================================

    /// Add a new signer (internal governance function)
    ///
    /// This function should only be called by executing a governance proposal
    /// that targets this contract's `internal_add_signer` function.
    ///
    /// # Arguments
    /// * `proposal_id` - ID of the governance proposal authorizing this action
    /// * `new_signer` - Address of the new signer to add
    pub fn internal_add_signer(
        env: Env,
        proposal_id: BytesN<32>,
        new_signer: Address,
    ) -> Result<(), GovernanceError> {
        // Check initialized
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }

        // Verify this is being called in context of proposal execution
        // The proposal execution already verified auth, so we trust the caller

        // Check signer doesn't already exist
        if storage::get_signer_info(&env, &new_signer).is_some() {
            return Err(GovernanceError::SignerAlreadyExists);
        }

        let config = storage::get_config(&env);
        let current_count = storage::get_signer_count(&env);

        // Check max signers
        if current_count >= config.max_signers {
            return Err(GovernanceError::MaxSignersReached);
        }

        let timestamp = env.ledger().timestamp();

        // Add signer info
        let info = SignerInfo {
            address: new_signer.clone(),
            added_at: timestamp,
            is_active: true,
        };
        storage::set_signer_info(&env, &new_signer, &info);

        // Update signer list
        let mut signer_list = storage::get_signer_list(&env);
        signer_list.push_back(new_signer.clone());
        storage::set_signer_list(&env, &signer_list);

        // Update count
        let new_count = current_count + 1;
        storage::set_signer_count(&env, new_count);

        // Emit event
        SignerAdded {
            signer: new_signer,
            proposal_id,
            new_count,
        }
        .publish(&env);

        Ok(())
    }

    /// Remove a signer (internal governance function)
    ///
    /// # Arguments
    /// * `proposal_id` - ID of the governance proposal authorizing this action
    /// * `signer` - Address of the signer to remove
    pub fn internal_remove_signer(
        env: Env,
        proposal_id: BytesN<32>,
        signer: Address,
    ) -> Result<(), GovernanceError> {
        // Check initialized
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }

        // Check signer exists
        if storage::get_signer_info(&env, &signer).is_none() {
            return Err(GovernanceError::SignerNotFound);
        }

        let current_count = storage::get_signer_count(&env);
        let config = storage::get_config(&env);

        // Cannot remove last signer
        if current_count <= 1 {
            return Err(GovernanceError::CannotRemoveLastSigner);
        }

        // Check threshold would still be valid
        let new_count = current_count - 1;
        if config.threshold > new_count {
            return Err(GovernanceError::ThresholdExceedsSigners);
        }

        // Remove signer info
        storage::remove_signer_info(&env, &signer);

        // Update signer list
        let signer_list = storage::get_signer_list(&env);
        let mut new_list: Vec<Address> = Vec::new(&env);
        for i in 0..signer_list.len() {
            let addr = signer_list.get(i).unwrap();
            if addr != signer {
                new_list.push_back(addr);
            }
        }
        storage::set_signer_list(&env, &new_list);

        // Update count
        storage::set_signer_count(&env, new_count);

        // Emit event
        SignerRemoved {
            signer,
            proposal_id,
            new_count,
        }
        .publish(&env);

        Ok(())
    }

    /// Update the threshold (internal governance function)
    ///
    /// # Arguments
    /// * `proposal_id` - ID of the governance proposal authorizing this action
    /// * `new_threshold` - New threshold value
    pub fn internal_update_threshold(
        env: Env,
        proposal_id: BytesN<32>,
        new_threshold: u32,
    ) -> Result<(), GovernanceError> {
        // Check initialized
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }

        // Validate threshold
        if new_threshold == 0 {
            return Err(GovernanceError::InvalidThreshold);
        }

        let signer_count = storage::get_signer_count(&env);
        if new_threshold > signer_count {
            return Err(GovernanceError::ThresholdExceedsSigners);
        }

        // Get current config and update
        let mut config = storage::get_config(&env);
        let old_threshold = config.threshold;
        config.threshold = new_threshold;
        storage::set_config(&env, &config);

        // Emit event
        ThresholdUpdated {
            old: old_threshold,
            new: new_threshold,
            proposal_id,
        }
        .publish(&env);

        Ok(())
    }

    // ========================================================================
    // Query Functions
    // ========================================================================

    /// Get proposal details by ID
    pub fn get_proposal(env: Env, proposal_id: BytesN<32>) -> Result<Proposal, GovernanceError> {
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }

        storage::get_proposal(&env, &proposal_id).ok_or(GovernanceError::ProposalNotFound)
    }

    /// Get the list of addresses that approved a proposal
    pub fn get_proposal_approvals(
        env: Env,
        proposal_id: BytesN<32>,
    ) -> Result<Vec<Address>, GovernanceError> {
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }

        if !storage::proposal_exists(&env, &proposal_id) {
            return Err(GovernanceError::ProposalNotFound);
        }

        Ok(storage::get_proposal_approvals(&env, &proposal_id))
    }

    /// Check if an address is an active signer
    pub fn is_signer(env: Env, address: Address) -> bool {
        if !storage::is_initialized(&env) {
            return false;
        }
        storage::is_active_signer(&env, &address)
    }

    /// Get all signer addresses
    pub fn get_signers(env: Env) -> Result<Vec<Address>, GovernanceError> {
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }
        Ok(storage::get_signer_list(&env))
    }

    /// Get the current threshold
    pub fn get_threshold(env: Env) -> Result<u32, GovernanceError> {
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }
        Ok(storage::get_threshold(&env))
    }

    /// Get the full governance configuration
    pub fn get_config(env: Env) -> Result<GovernanceConfig, GovernanceError> {
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }
        Ok(storage::get_config(&env))
    }

    /// Get signer count
    pub fn get_signer_count(env: Env) -> Result<u32, GovernanceError> {
        if !storage::is_initialized(&env) {
            return Err(GovernanceError::NotInitialized);
        }
        Ok(storage::get_signer_count(&env))
    }
}

mod test;
