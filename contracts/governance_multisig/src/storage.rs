//! Storage keys and helpers for the Governance Multisig contract

use soroban_sdk::{contracttype, Address, BytesN, Env, Vec};

use crate::types::{GovernanceConfig, Proposal, SignerInfo};

/// Storage keys for the governance contract
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Boolean flag indicating contract initialization
    Initialized,
    /// Governance configuration (instance storage)
    Config,
    /// Total number of signers (instance storage)
    SignerCount,
    /// Information about a specific signer (persistent storage)
    Signer(Address),
    /// List of all signer addresses (persistent storage)
    SignerList,
    /// A governance proposal (persistent storage)
    Proposal(BytesN<32>),
    /// List of addresses that approved a proposal (persistent storage)
    ProposalApprovals(BytesN<32>),
    /// Boolean guard to prevent double execution (persistent storage)
    ProposalExecuted(BytesN<32>),
}

// ============================================================================
// Initialization Helpers
// ============================================================================

/// Check if the contract is initialized
pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Initialized)
        .unwrap_or(false)
}

/// Mark the contract as initialized
pub fn set_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&DataKey::Initialized, &true);
}

// ============================================================================
// Configuration Helpers
// ============================================================================

/// Get the governance configuration
pub fn get_config(env: &Env) -> GovernanceConfig {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .expect("config not found")
}

/// Set the governance configuration
pub fn set_config(env: &Env, config: &GovernanceConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

/// Get the current threshold
pub fn get_threshold(env: &Env) -> u32 {
    get_config(env).threshold
}

// ============================================================================
// Signer Helpers
// ============================================================================

/// Get the current signer count
pub fn get_signer_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<DataKey, u32>(&DataKey::SignerCount)
        .unwrap_or(0)
}

/// Set the signer count
pub fn set_signer_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&DataKey::SignerCount, &count);
}

/// Get the list of all signer addresses
pub fn get_signer_list(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::SignerList)
        .unwrap_or_else(|| Vec::new(env))
}

/// Set the list of all signer addresses
pub fn set_signer_list(env: &Env, signers: &Vec<Address>) {
    env.storage()
        .persistent()
        .set(&DataKey::SignerList, signers);
}

/// Get signer info for a specific address
pub fn get_signer_info(env: &Env, address: &Address) -> Option<SignerInfo> {
    env.storage()
        .persistent()
        .get(&DataKey::Signer(address.clone()))
}

/// Set signer info for a specific address
pub fn set_signer_info(env: &Env, address: &Address, info: &SignerInfo) {
    env.storage()
        .persistent()
        .set(&DataKey::Signer(address.clone()), info);
}

/// Remove signer info
pub fn remove_signer_info(env: &Env, address: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Signer(address.clone()));
}

/// Check if an address is an active signer
pub fn is_active_signer(env: &Env, address: &Address) -> bool {
    if let Some(info) = get_signer_info(env, address) {
        return info.is_active;
    }
    false
}

// ============================================================================
// Proposal Helpers
// ============================================================================

/// Get a proposal by ID
pub fn get_proposal(env: &Env, proposal_id: &BytesN<32>) -> Option<Proposal> {
    env.storage()
        .persistent()
        .get(&DataKey::Proposal(proposal_id.clone()))
}

/// Set a proposal
pub fn set_proposal(env: &Env, proposal: &Proposal) {
    env.storage()
        .persistent()
        .set(&DataKey::Proposal(proposal.proposal_id.clone()), proposal);
}

/// Check if a proposal exists
pub fn proposal_exists(env: &Env, proposal_id: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Proposal(proposal_id.clone()))
}

/// Get the list of approvers for a proposal
pub fn get_proposal_approvals(env: &Env, proposal_id: &BytesN<32>) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::ProposalApprovals(proposal_id.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

/// Set the list of approvers for a proposal
pub fn set_proposal_approvals(env: &Env, proposal_id: &BytesN<32>, approvals: &Vec<Address>) {
    env.storage()
        .persistent()
        .set(&DataKey::ProposalApprovals(proposal_id.clone()), approvals);
}

/// Check if a signer has approved a proposal
pub fn has_approved(env: &Env, proposal_id: &BytesN<32>, signer: &Address) -> bool {
    let approvals = get_proposal_approvals(env, proposal_id);
    for i in 0..approvals.len() {
        if approvals.get(i).unwrap() == signer.clone() {
            return true;
        }
    }
    false
}

/// Check if a proposal has been executed
pub fn is_proposal_executed(env: &Env, proposal_id: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .get::<DataKey, bool>(&DataKey::ProposalExecuted(proposal_id.clone()))
        .unwrap_or(false)
}

/// Mark a proposal as executed
pub fn set_proposal_executed(env: &Env, proposal_id: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::ProposalExecuted(proposal_id.clone()), &true);
}
