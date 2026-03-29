use soroban_sdk::{contractevent, Address, BytesN, Env, Symbol};

pub const NAMESPACE: &str = "ArenaXGovernance";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXGov_v1", "INIT"])]
pub struct GovernanceInitialized {
    pub signers_count: u32,
    pub threshold: u32,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXGov_v1", "PROPOSED"])]
pub struct ProposalCreated {
    pub proposal_id: BytesN<32>,
    pub proposer: Address,
    pub target: Address,
    pub function: Symbol,
    pub execute_after: Option<u64>,
}

#[contractevent(topics = ["ArenaXGov_v1", "APPROVED"])]
pub struct ProposalApproved {
    pub proposal_id: BytesN<32>,
    pub signer: Address,
    pub approval_count: u32,
    pub threshold: u32,
}

#[contractevent(topics = ["ArenaXGov_v1", "REVOKED"])]
pub struct ApprovalRevoked {
    pub proposal_id: BytesN<32>,
    pub signer: Address,
    pub approval_count: u32,
}

#[contractevent(topics = ["ArenaXGov_v1", "EXECUTED"])]
pub struct ProposalExecuted {
    pub proposal_id: BytesN<32>,
    pub executor: Address,
    pub target: Address,
    pub function: Symbol,
}

#[contractevent(topics = ["ArenaXGov_v1", "CANCELLED"])]
pub struct ProposalCancelled {
    pub proposal_id: BytesN<32>,
    pub cancelled_by: Address,
}

#[contractevent(topics = ["ArenaXGov_v1", "SIGNER_ADD"])]
pub struct SignerAdded {
    pub signer: Address,
    pub proposal_id: BytesN<32>,
    pub new_count: u32,
}

#[contractevent(topics = ["ArenaXGov_v1", "SIGNER_REM"])]
pub struct SignerRemoved {
    pub signer: Address,
    pub proposal_id: BytesN<32>,
    pub new_count: u32,
}

#[contractevent(topics = ["ArenaXGov_v1", "THRESH_UPD"])]
pub struct ThresholdUpdated {
    pub old: u32,
    pub new: u32,
    pub proposal_id: BytesN<32>,
}

pub fn emit_governance_initialized(env: &Env, signers_count: u32, threshold: u32, timestamp: u64) {
    GovernanceInitialized { signers_count, threshold, timestamp }.publish(env);
}

pub fn emit_proposal_created(env: &Env, proposal_id: &BytesN<32>, proposer: &Address, target: &Address, function: Symbol, execute_after: Option<u64>) {
    ProposalCreated { proposal_id: proposal_id.clone(), proposer: proposer.clone(), target: target.clone(), function, execute_after }.publish(env);
}

pub fn emit_proposal_approved(env: &Env, proposal_id: &BytesN<32>, signer: &Address, approval_count: u32, threshold: u32) {
    ProposalApproved { proposal_id: proposal_id.clone(), signer: signer.clone(), approval_count, threshold }.publish(env);
}

pub fn emit_approval_revoked(env: &Env, proposal_id: &BytesN<32>, signer: &Address, approval_count: u32) {
    ApprovalRevoked { proposal_id: proposal_id.clone(), signer: signer.clone(), approval_count }.publish(env);
}

pub fn emit_proposal_executed(env: &Env, proposal_id: &BytesN<32>, executor: &Address, target: &Address, function: Symbol) {
    ProposalExecuted { proposal_id: proposal_id.clone(), executor: executor.clone(), target: target.clone(), function }.publish(env);
}

pub fn emit_proposal_cancelled(env: &Env, proposal_id: &BytesN<32>, cancelled_by: &Address) {
    ProposalCancelled { proposal_id: proposal_id.clone(), cancelled_by: cancelled_by.clone() }.publish(env);
}

pub fn emit_signer_added(env: &Env, signer: &Address, proposal_id: &BytesN<32>, new_count: u32) {
    SignerAdded { signer: signer.clone(), proposal_id: proposal_id.clone(), new_count }.publish(env);
}

pub fn emit_signer_removed(env: &Env, signer: &Address, proposal_id: &BytesN<32>, new_count: u32) {
    SignerRemoved { signer: signer.clone(), proposal_id: proposal_id.clone(), new_count }.publish(env);
}

pub fn emit_threshold_updated(env: &Env, old: u32, new: u32, proposal_id: &BytesN<32>) {
    ThresholdUpdated { old, new, proposal_id: proposal_id.clone() }.publish(env);
}
