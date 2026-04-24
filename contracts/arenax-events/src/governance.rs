use soroban_sdk::{contractevent, Address, BytesN, Env, String, Symbol};

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
    GovernanceInitialized {
        signers_count,
        threshold,
        timestamp,
    }
    .publish(env);
}

pub fn emit_proposal_created(
    env: &Env,
    proposal_id: &BytesN<32>,
    proposer: &Address,
    target: &Address,
    function: Symbol,
    execute_after: Option<u64>,
) {
    ProposalCreated {
        proposal_id: proposal_id.clone(),
        proposer: proposer.clone(),
        target: target.clone(),
        function,
        execute_after,
    }
    .publish(env);
}

pub fn emit_proposal_approved(
    env: &Env,
    proposal_id: &BytesN<32>,
    signer: &Address,
    approval_count: u32,
    threshold: u32,
) {
    ProposalApproved {
        proposal_id: proposal_id.clone(),
        signer: signer.clone(),
        approval_count,
        threshold,
    }
    .publish(env);
}

pub fn emit_approval_revoked(
    env: &Env,
    proposal_id: &BytesN<32>,
    signer: &Address,
    approval_count: u32,
) {
    ApprovalRevoked {
        proposal_id: proposal_id.clone(),
        signer: signer.clone(),
        approval_count,
    }
    .publish(env);
}

pub fn emit_proposal_executed(
    env: &Env,
    proposal_id: &BytesN<32>,
    executor: &Address,
    target: &Address,
    function: Symbol,
) {
    ProposalExecuted {
        proposal_id: proposal_id.clone(),
        executor: executor.clone(),
        target: target.clone(),
        function,
    }
    .publish(env);
}

pub fn emit_proposal_cancelled(env: &Env, proposal_id: &BytesN<32>, cancelled_by: &Address) {
    ProposalCancelled {
        proposal_id: proposal_id.clone(),
        cancelled_by: cancelled_by.clone(),
    }
    .publish(env);
}

pub fn emit_signer_added(env: &Env, signer: &Address, proposal_id: &BytesN<32>, new_count: u32) {
    SignerAdded {
        signer: signer.clone(),
        proposal_id: proposal_id.clone(),
        new_count,
    }
    .publish(env);
}

pub fn emit_signer_removed(env: &Env, signer: &Address, proposal_id: &BytesN<32>, new_count: u32) {
    SignerRemoved {
        signer: signer.clone(),
        proposal_id: proposal_id.clone(),
        new_count,
    }
    .publish(env);
}

pub fn emit_threshold_updated(env: &Env, old: u32, new: u32, proposal_id: &BytesN<32>) {
    ThresholdUpdated {
        old,
        new,
        proposal_id: proposal_id.clone(),
    }
    .publish(env);
}

// Token-based governance events
#[contractevent(topics = ["ArenaXGov_v1", "PROP_CREATED"])]
pub struct TokenProposalCreated {
    pub proposer: Address,
    pub proposal_id: BytesN<32>,
    pub title: String,
    pub description: String,
    pub proposal_type: u32,
}

#[contractevent(topics = ["ArenaXGov_v1", "VOTE_CAST"])]
pub struct VoteCast {
    pub voter: Address,
    pub proposal_id: BytesN<32>,
    pub choice: u32,
    pub voting_power: u128,
}

#[contractevent(topics = ["ArenaXGov_v1", "PROP_TALLIED"])]
pub struct ProposalTallied {
    pub proposal_id: BytesN<32>,
    pub status: u32,
    pub for_votes: u128,
    pub against_votes: u128,
    pub abstain_votes: u128,
}

#[contractevent(topics = ["ArenaXGov_v1", "PROP_EXECUTED"])]
pub struct TokenProposalExecuted {
    pub proposal_id: BytesN<32>,
}

#[contractevent(topics = ["ArenaXGov_v1", "PROP_CANCELLED"])]
pub struct TokenProposalCancelled {
    pub proposal_id: BytesN<32>,
}

#[contractevent(topics = ["ArenaXGov_v1", "POWER_DELEGATED"])]
pub struct VotingPowerDelegated {
    pub delegator: Address,
    pub delegatee: Address,
    pub voting_power: u128,
}

#[contractevent(topics = ["ArenaXGov_v1", "PARAMS_UPDATED"])]
pub struct GovernanceParamsUpdated;

pub fn proposal_created(
    env: &Env,
    proposer: &Address,
    proposal_id: &BytesN<32>,
    title: &String,
    description: &String,
    proposal_type: u32,
) {
    TokenProposalCreated {
        proposer: proposer.clone(),
        proposal_id: proposal_id.clone(),
        title: title.clone(),
        description: description.clone(),
        proposal_type,
    }
    .publish(env);
}

pub fn vote_cast(
    env: &Env,
    voter: &Address,
    proposal_id: &BytesN<32>,
    choice: u32,
    voting_power: u128,
) {
    VoteCast {
        voter: voter.clone(),
        proposal_id: proposal_id.clone(),
        choice,
        voting_power,
    }
    .publish(env);
}

pub fn proposal_tallied(
    env: &Env,
    proposal_id: &BytesN<32>,
    status: u32,
    for_votes: u128,
    against_votes: u128,
    abstain_votes: u128,
) {
    ProposalTallied {
        proposal_id: proposal_id.clone(),
        status,
        for_votes,
        against_votes,
        abstain_votes,
    }
    .publish(env);
}

pub fn proposal_executed(env: &Env, proposal_id: &BytesN<32>) {
    TokenProposalExecuted {
        proposal_id: proposal_id.clone(),
    }
    .publish(env);
}

pub fn proposal_cancelled(env: &Env, proposal_id: &BytesN<32>) {
    TokenProposalCancelled {
        proposal_id: proposal_id.clone(),
    }
    .publish(env);
}

pub fn voting_power_delegated(
    env: &Env,
    delegator: &Address,
    delegatee: &Address,
    voting_power: u128,
) {
    VotingPowerDelegated {
        delegator: delegator.clone(),
        delegatee: delegatee.clone(),
        voting_power,
    }
    .publish(env);
}

pub fn governance_params_updated(env: &Env) {
    GovernanceParamsUpdated.publish(env);
}
