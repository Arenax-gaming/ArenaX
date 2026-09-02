#![no_std]

//! Governed upgrade lifecycle for ArenaX Soroban contracts.
//!
//! Soroban has no EVM-style `delegatecall` proxy — instead a contract's
//! *address* stays constant across releases while its wasm implementation
//! is swapped via `Env::deployer().update_current_contract_wasm(hash)`.
//! That address stability is what makes the pattern proxy-equivalent:
//! callers, other contracts, and off-chain indexers keep using the same
//! contract id forever.
//!
//! This contract is the governance layer sitting in front of that
//! primitive:
//!   - Proposals name a target contract and a candidate wasm hash.
//!   - A validator sets a validation verdict before a vote can pass.
//!   - Governors vote; once `approval_threshold` yes-votes are reached
//!     and the timelock has elapsed, the upgrade can be executed.
//!   - Executing an upgrade of *this* contract itself calls
//!     `update_current_contract_wasm` directly. Executing an upgrade of
//!     another tracked contract records the governance-approved hash,
//!     which that contract's own admin-gated `upgrade()` entrypoint
//!     reads via [`UpgradeManagerClient::get_approved_wasm_hash`] and
//!     applies to itself — the indirection Soroban requires since one
//!     contract cannot rewrite another contract's wasm directly.
//!   - Every execution and rollback is appended to a per-contract
//!     history log.

use arenax_events::upgrade_manager as events;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    String, Symbol, Vec,
};

/// Pseudo contract-name used when a proposal targets this governance
/// contract's own implementation.
pub const SELF_CONTRACT: Symbol = symbol_short!("SELF");

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    ApprovalThreshold,
    Governors,
    NextProposalId,
    Proposal(u32),
    Validation(u32),
    Votes(u32),
    Executed(u32),
    ApprovedWasmHash(Symbol),
    PreviousWasmHash(Symbol),
    History(Symbol),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposal {
    pub proposal_id: u32,
    pub contract_name: Symbol,
    pub new_wasm_hash: BytesN<32>,
    pub proposed_by: Address,
    pub proposed_at: u64,
    pub timelock_end: u64,
    pub description: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationResult {
    pub proposal_id: u32,
    pub is_valid: bool,
    pub validated_by: Address,
    pub validated_at: u64,
    pub notes: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeRecord {
    pub proposal_id: u32,
    pub contract_name: Symbol,
    pub previous_wasm_hash: BytesN<32>,
    pub new_wasm_hash: BytesN<32>,
    pub timestamp: u64,
    pub actor: Address,
    pub action: Symbol,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum UpgradeError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,
    NotGovernor = 4,
    ProposalNotFound = 5,
    AlreadyValidated = 6,
    NotValidated = 7,
    ValidationFailed = 8,
    AlreadyVoted = 9,
    ThresholdNotMet = 10,
    TimelockNotElapsed = 11,
    AlreadyExecuted = 12,
    NoPriorVersion = 13,
    InvalidThreshold = 14,
}

#[contract]
pub struct UpgradeManager;

#[contractimpl]
impl UpgradeManager {
    /// Initialize the upgrade manager with an admin, an initial governor
    /// set, and the number of yes-votes required to approve a proposal.
    pub fn initialize(
        env: Env,
        admin: Address,
        governors: Vec<Address>,
        approval_threshold: u32,
    ) -> Result<(), UpgradeError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(UpgradeError::AlreadyInitialized);
        }
        if approval_threshold == 0 || approval_threshold > governors.len() {
            return Err(UpgradeError::InvalidThreshold);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::ApprovalThreshold, &approval_threshold);
        env.storage()
            .instance()
            .set(&DataKey::Governors, &governors);
        env.storage().instance().set(&DataKey::NextProposalId, &1u32);

        events::emit_initialized(&env, &admin, approval_threshold);
        Ok(())
    }

    /// Propose an upgrade for `contract_name` (use [`SELF_CONTRACT`] to
    /// target this governance contract) to `new_wasm_hash`. Any address
    /// may propose; only governors can approve it via vote.
    pub fn propose_upgrade(
        env: Env,
        proposer: Address,
        contract_name: Symbol,
        new_wasm_hash: BytesN<32>,
        description: String,
        timelock_seconds: u64,
    ) -> Result<u32, UpgradeError> {
        proposer.require_auth();
        Self::require_initialized(&env)?;

        let proposal_id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextProposalId)
            .unwrap_or(1u32);
        let now = env.ledger().timestamp();
        let timelock_end = now + timelock_seconds;

        let proposal = UpgradeProposal {
            proposal_id,
            contract_name: contract_name.clone(),
            new_wasm_hash: new_wasm_hash.clone(),
            proposed_by: proposer.clone(),
            proposed_at: now,
            timelock_end,
            description,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage()
            .persistent()
            .set(&DataKey::Votes(proposal_id), &Vec::<Address>::new(&env));
        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &(proposal_id + 1));

        events::emit_upgrade_proposed(
            &env,
            proposal_id,
            &contract_name,
            &new_wasm_hash,
            &proposer,
            timelock_end,
        );
        Ok(proposal_id)
    }

    /// Record an implementation-validation verdict (compatibility check,
    /// audit sign-off, etc.) for a proposal. Must be done by a governor
    /// before the proposal can be executed.
    pub fn validate_upgrade(
        env: Env,
        validator: Address,
        proposal_id: u32,
        is_valid: bool,
        notes: String,
    ) -> Result<(), UpgradeError> {
        validator.require_auth();
        Self::require_governor(&env, &validator)?;
        Self::get_proposal(&env, proposal_id)?;

        if env
            .storage()
            .persistent()
            .has(&DataKey::Validation(proposal_id))
        {
            return Err(UpgradeError::AlreadyValidated);
        }

        let result = ValidationResult {
            proposal_id,
            is_valid,
            validated_by: validator.clone(),
            validated_at: env.ledger().timestamp(),
            notes,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Validation(proposal_id), &result);

        events::emit_upgrade_validated(&env, proposal_id, is_valid, &validator);
        Ok(())
    }

    /// Cast a governor's yes/no vote on a proposal. One vote per governor.
    pub fn vote_upgrade(
        env: Env,
        voter: Address,
        proposal_id: u32,
        approve: bool,
    ) -> Result<u32, UpgradeError> {
        voter.require_auth();
        Self::require_governor(&env, &voter)?;
        Self::get_proposal(&env, proposal_id)?;

        let mut votes: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Votes(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));

        if votes.contains(&voter) {
            return Err(UpgradeError::AlreadyVoted);
        }

        if approve {
            votes.push_back(voter.clone());
            env.storage()
                .persistent()
                .set(&DataKey::Votes(proposal_id), &votes);
        }

        events::emit_upgrade_voted(&env, proposal_id, &voter, approve, votes.len());
        Ok(votes.len())
    }

    /// Execute an approved proposal. Requires: a positive validation
    /// verdict, at least `approval_threshold` yes-votes, the timelock
    /// elapsed, and no prior execution of this proposal.
    ///
    /// For [`SELF_CONTRACT`] this calls `update_current_contract_wasm`
    /// directly. For any other tracked contract it records the approved
    /// hash so that contract's own upgrade entrypoint can apply it.
    pub fn execute_upgrade(env: Env, caller: Address, proposal_id: u32) -> Result<(), UpgradeError> {
        caller.require_auth();
        Self::require_governor(&env, &caller)?;

        let proposal = Self::get_proposal(&env, proposal_id)?;

        if env
            .storage()
            .persistent()
            .get(&DataKey::Executed(proposal_id))
            .unwrap_or(false)
        {
            return Err(UpgradeError::AlreadyExecuted);
        }

        let validation: ValidationResult = env
            .storage()
            .persistent()
            .get(&DataKey::Validation(proposal_id))
            .ok_or(UpgradeError::NotValidated)?;
        if !validation.is_valid {
            return Err(UpgradeError::ValidationFailed);
        }

        let votes: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Votes(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ApprovalThreshold)
            .unwrap_or(u32::MAX);
        if votes.len() < threshold {
            return Err(UpgradeError::ThresholdNotMet);
        }

        if env.ledger().timestamp() < proposal.timelock_end {
            return Err(UpgradeError::TimelockNotElapsed);
        }

        let previous_hash = env
            .storage()
            .persistent()
            .get(&DataKey::ApprovedWasmHash(proposal.contract_name.clone()))
            .unwrap_or_else(|| Self::unknown_hash(&env));

        env.storage().persistent().set(
            &DataKey::PreviousWasmHash(proposal.contract_name.clone()),
            &previous_hash,
        );
        env.storage().persistent().set(
            &DataKey::ApprovedWasmHash(proposal.contract_name.clone()),
            &proposal.new_wasm_hash,
        );
        env.storage()
            .persistent()
            .set(&DataKey::Executed(proposal_id), &true);

        if proposal.contract_name == SELF_CONTRACT {
            env.deployer()
                .update_current_contract_wasm(proposal.new_wasm_hash.clone());
        }

        Self::append_history(
            &env,
            &proposal.contract_name,
            UpgradeRecord {
                proposal_id,
                contract_name: proposal.contract_name.clone(),
                previous_wasm_hash: previous_hash.clone(),
                new_wasm_hash: proposal.new_wasm_hash.clone(),
                timestamp: env.ledger().timestamp(),
                actor: caller.clone(),
                action: symbol_short!("EXECUTE"),
            },
        );

        events::emit_upgrade_executed(
            &env,
            proposal_id,
            &proposal.contract_name,
            &previous_hash,
            &proposal.new_wasm_hash,
            &caller,
        );
        Ok(())
    }

    /// Roll a contract back to its previously-approved wasm hash. Only
    /// the admin or a governor may trigger a rollback. For
    /// [`SELF_CONTRACT`] this immediately re-applies the prior wasm via
    /// `update_current_contract_wasm`; for other contracts it resets the
    /// approved hash so their upgrade entrypoint re-applies the old
    /// implementation.
    pub fn rollback_upgrade(
        env: Env,
        caller: Address,
        contract_name: Symbol,
        reason: Symbol,
    ) -> Result<(), UpgradeError> {
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(UpgradeError::NotInitialized)?;
        if caller != admin {
            Self::require_governor(&env, &caller)?;
        }

        let previous_hash: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::PreviousWasmHash(contract_name.clone()))
            .ok_or(UpgradeError::NoPriorVersion)?;
        let current_hash: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::ApprovedWasmHash(contract_name.clone()))
            .unwrap_or_else(|| Self::unknown_hash(&env));

        env.storage().persistent().set(
            &DataKey::ApprovedWasmHash(contract_name.clone()),
            &previous_hash,
        );
        env.storage().persistent().set(
            &DataKey::PreviousWasmHash(contract_name.clone()),
            &current_hash,
        );

        if contract_name == SELF_CONTRACT {
            env.deployer()
                .update_current_contract_wasm(previous_hash.clone());
        }

        Self::append_history(
            &env,
            &contract_name,
            UpgradeRecord {
                proposal_id: 0,
                contract_name: contract_name.clone(),
                previous_wasm_hash: current_hash,
                new_wasm_hash: previous_hash.clone(),
                timestamp: env.ledger().timestamp(),
                actor: caller.clone(),
                action: symbol_short!("ROLLBACK"),
            },
        );

        events::emit_upgrade_rolled_back(&env, 0, &contract_name, &previous_hash, &caller, &reason);
        Ok(())
    }

    /// The wasm hash a tracked contract's own upgrade entrypoint should
    /// apply to itself after governance approval.
    pub fn get_approved_wasm_hash(env: Env, contract_name: Symbol) -> Option<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::ApprovedWasmHash(contract_name))
    }

    pub fn get_proposal_query(env: Env, proposal_id: u32) -> Option<UpgradeProposal> {
        env.storage().persistent().get(&DataKey::Proposal(proposal_id))
    }

    pub fn get_validation_query(env: Env, proposal_id: u32) -> Option<ValidationResult> {
        env.storage()
            .persistent()
            .get(&DataKey::Validation(proposal_id))
    }

    pub fn get_votes_query(env: Env, proposal_id: u32) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Votes(proposal_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Full, append-only upgrade + rollback history for a contract.
    pub fn get_upgrade_history(env: Env, contract_name: Symbol) -> Vec<UpgradeRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::History(contract_name))
            .unwrap_or_else(|| Vec::new(&env))
    }

    fn require_initialized(env: &Env) -> Result<(), UpgradeError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(UpgradeError::NotInitialized);
        }
        Ok(())
    }

    fn require_governor(env: &Env, address: &Address) -> Result<(), UpgradeError> {
        let governors: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Governors)
            .ok_or(UpgradeError::NotInitialized)?;
        if !governors.contains(address) {
            return Err(UpgradeError::NotGovernor);
        }
        Ok(())
    }

    fn get_proposal(env: &Env, proposal_id: u32) -> Result<UpgradeProposal, UpgradeError> {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(UpgradeError::ProposalNotFound)
    }

    /// Sentinel used when no prior wasm hash has been recorded for a
    /// contract yet (its first tracked upgrade) — genuinely unknown
    /// rather than assumed, since Soroban has no host function to read
    /// back another contract's currently-installed wasm hash on demand.
    fn unknown_hash(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[0u8; 32])
    }

    fn append_history(env: &Env, contract_name: &Symbol, record: UpgradeRecord) {
        let mut history: Vec<UpgradeRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::History(contract_name.clone()))
            .unwrap_or_else(|| Vec::new(env));
        history.push_back(record);
        env.storage()
            .persistent()
            .set(&DataKey::History(contract_name.clone()), &history);
    }
}
