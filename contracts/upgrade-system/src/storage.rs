use crate::types::{
    ApprovalRecord, EmergencyState, RollbackInfo, UpgradeConfig, UpgradeHistoryEntry,
    UpgradeProposal, ValidationResult,
};
use soroban_sdk::{contracttype, Address, BytesN, Env, Vec};

/// Storage keys for the upgrade system
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Initialized,
    Config,
    Proposal(BytesN<32>),
    Validation(BytesN<32>),
    Approvals(BytesN<32>),
    History(Address),
    HistoryCount(Address),
    Rollback(Address),
    EmergencyState(Address),
    GlobalEmergency,
    ProposalExecuted(BytesN<32>),
    ContractCurrentHash(Address),
}

// ============================================================================
// Initialization
// ============================================================================

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

// ============================================================================
// Configuration
// ============================================================================

pub fn get_config(env: &Env) -> UpgradeConfig {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

pub fn set_config(env: &Env, config: &UpgradeConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

// ============================================================================
// Proposals
// ============================================================================

pub fn get_proposal(env: &Env, proposal_id: &BytesN<32>) -> Option<UpgradeProposal> {
    env.storage()
        .persistent()
        .get(&DataKey::Proposal(proposal_id.clone()))
}

pub fn set_proposal(env: &Env, proposal: &UpgradeProposal) {
    env.storage()
        .persistent()
        .set(&DataKey::Proposal(proposal.proposal_id.clone()), proposal);
}

pub fn proposal_exists(env: &Env, proposal_id: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Proposal(proposal_id.clone()))
}

pub fn is_proposal_executed(env: &Env, proposal_id: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::ProposalExecuted(proposal_id.clone()))
        .unwrap_or(false)
}

pub fn set_proposal_executed(env: &Env, proposal_id: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::ProposalExecuted(proposal_id.clone()), &true);
}

// ============================================================================
// Validation
// ============================================================================

pub fn get_validation(env: &Env, proposal_id: &BytesN<32>) -> Option<ValidationResult> {
    env.storage()
        .persistent()
        .get(&DataKey::Validation(proposal_id.clone()))
}

pub fn set_validation(env: &Env, validation: &ValidationResult) {
    env.storage().persistent().set(
        &DataKey::Validation(validation.proposal_id.clone()),
        validation,
    );
}

// ============================================================================
// Approvals
// ============================================================================

pub fn get_approvals(env: &Env, proposal_id: &BytesN<32>) -> Vec<ApprovalRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::Approvals(proposal_id.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn set_approvals(env: &Env, proposal_id: &BytesN<32>, approvals: &Vec<ApprovalRecord>) {
    env.storage()
        .persistent()
        .set(&DataKey::Approvals(proposal_id.clone()), approvals);
}

pub fn has_approved(env: &Env, proposal_id: &BytesN<32>, approver: &Address) -> bool {
    let approvals = get_approvals(env, proposal_id);
    for i in 0..approvals.len() {
        if let Some(record) = approvals.get(i) {
            if record.approver == *approver {
                return true;
            }
        }
    }
    false
}

// ============================================================================
// History
// ============================================================================

pub fn get_history(env: &Env, contract_address: &Address) -> Vec<UpgradeHistoryEntry> {
    env.storage()
        .persistent()
        .get(&DataKey::History(contract_address.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn add_history_entry(env: &Env, entry: &UpgradeHistoryEntry) {
    let mut history = get_history(env, &entry.contract_address);
    history.push_back(entry.clone());
    env.storage()
        .persistent()
        .set(&DataKey::History(entry.contract_address.clone()), &history);

    // Update count
    let count = get_history_count(env, &entry.contract_address);
    set_history_count(env, &entry.contract_address, count + 1);
}

pub fn get_history_count(env: &Env, contract_address: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::HistoryCount(contract_address.clone()))
        .unwrap_or(0)
}

pub fn set_history_count(env: &Env, contract_address: &Address, count: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::HistoryCount(contract_address.clone()), &count);
}

// ============================================================================
// Rollback
// ============================================================================

pub fn get_rollback_info(env: &Env, contract_address: &Address) -> Option<RollbackInfo> {
    env.storage()
        .persistent()
        .get(&DataKey::Rollback(contract_address.clone()))
}

pub fn set_rollback_info(env: &Env, info: &RollbackInfo) {
    env.storage()
        .persistent()
        .set(&DataKey::Rollback(info.contract_address.clone()), info);
}

#[allow(dead_code)]
pub fn remove_rollback_info(env: &Env, contract_address: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Rollback(contract_address.clone()));
}

// ============================================================================
// Emergency State
// ============================================================================

pub fn get_emergency_state(env: &Env, contract_address: &Address) -> EmergencyState {
    env.storage()
        .persistent()
        .get(&DataKey::EmergencyState(contract_address.clone()))
        .unwrap_or(EmergencyState {
            is_paused: false,
            paused_at: None,
            paused_by: None,
            reason: None,
        })
}

pub fn set_emergency_state(env: &Env, contract_address: &Address, state: &EmergencyState) {
    env.storage()
        .persistent()
        .set(&DataKey::EmergencyState(contract_address.clone()), state);
}

pub fn get_global_emergency(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::GlobalEmergency)
        .unwrap_or(false)
}

#[allow(dead_code)]
pub fn set_global_emergency(env: &Env, paused: bool) {
    env.storage()
        .instance()
        .set(&DataKey::GlobalEmergency, &paused);
}

// ============================================================================
// Contract State
// ============================================================================

pub fn get_contract_current_hash(env: &Env, contract_address: &Address) -> Option<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&DataKey::ContractCurrentHash(contract_address.clone()))
}

pub fn set_contract_current_hash(env: &Env, contract_address: &Address, hash: &BytesN<32>) {
    env.storage().persistent().set(
        &DataKey::ContractCurrentHash(contract_address.clone()),
        hash,
    );
}
