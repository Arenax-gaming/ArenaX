use soroban_sdk::{contractevent, Address, BytesN, Symbol};

pub const NAMESPACE: &str = "ArenaXUpgradeManager";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXUpg_v1", "INIT"])]
pub struct Initialized {
    pub admin: Address,
    pub approval_threshold: u32,
}

#[contractevent(topics = ["ArenaXUpg_v1", "PROPOSED"])]
pub struct UpgradeProposed {
    pub proposal_id: u32,
    pub contract_name: Symbol,
    pub new_wasm_hash: BytesN<32>,
    pub proposed_by: Address,
    pub timelock_end: u64,
}

#[contractevent(topics = ["ArenaXUpg_v1", "VALIDATED"])]
pub struct UpgradeValidated {
    pub proposal_id: u32,
    pub is_valid: bool,
    pub validated_by: Address,
}

#[contractevent(topics = ["ArenaXUpg_v1", "VOTED"])]
pub struct UpgradeVoted {
    pub proposal_id: u32,
    pub voter: Address,
    pub approve: bool,
    pub votes_for: u32,
}

#[contractevent(topics = ["ArenaXUpg_v1", "EXECUTED"])]
pub struct UpgradeExecuted {
    pub proposal_id: u32,
    pub contract_name: Symbol,
    pub previous_wasm_hash: BytesN<32>,
    pub new_wasm_hash: BytesN<32>,
    pub executed_by: Address,
}

#[contractevent(topics = ["ArenaXUpg_v1", "ROLLED_BACK"])]
pub struct UpgradeRolledBack {
    pub proposal_id: u32,
    pub contract_name: Symbol,
    pub restored_wasm_hash: BytesN<32>,
    pub rolled_back_by: Address,
    pub reason: Symbol,
}

pub fn emit_initialized(env: &soroban_sdk::Env, admin: &Address, approval_threshold: u32) {
    Initialized {
        admin: admin.clone(),
        approval_threshold,
    }
    .publish(env);
}

pub fn emit_upgrade_proposed(
    env: &soroban_sdk::Env,
    proposal_id: u32,
    contract_name: &Symbol,
    new_wasm_hash: &BytesN<32>,
    proposed_by: &Address,
    timelock_end: u64,
) {
    UpgradeProposed {
        proposal_id,
        contract_name: contract_name.clone(),
        new_wasm_hash: new_wasm_hash.clone(),
        proposed_by: proposed_by.clone(),
        timelock_end,
    }
    .publish(env);
}

pub fn emit_upgrade_validated(
    env: &soroban_sdk::Env,
    proposal_id: u32,
    is_valid: bool,
    validated_by: &Address,
) {
    UpgradeValidated {
        proposal_id,
        is_valid,
        validated_by: validated_by.clone(),
    }
    .publish(env);
}

pub fn emit_upgrade_voted(
    env: &soroban_sdk::Env,
    proposal_id: u32,
    voter: &Address,
    approve: bool,
    votes_for: u32,
) {
    UpgradeVoted {
        proposal_id,
        voter: voter.clone(),
        approve,
        votes_for,
    }
    .publish(env);
}

pub fn emit_upgrade_executed(
    env: &soroban_sdk::Env,
    proposal_id: u32,
    contract_name: &Symbol,
    previous_wasm_hash: &BytesN<32>,
    new_wasm_hash: &BytesN<32>,
    executed_by: &Address,
) {
    UpgradeExecuted {
        proposal_id,
        contract_name: contract_name.clone(),
        previous_wasm_hash: previous_wasm_hash.clone(),
        new_wasm_hash: new_wasm_hash.clone(),
        executed_by: executed_by.clone(),
    }
    .publish(env);
}

pub fn emit_upgrade_rolled_back(
    env: &soroban_sdk::Env,
    proposal_id: u32,
    contract_name: &Symbol,
    restored_wasm_hash: &BytesN<32>,
    rolled_back_by: &Address,
    reason: &Symbol,
) {
    UpgradeRolledBack {
        proposal_id,
        contract_name: contract_name.clone(),
        restored_wasm_hash: restored_wasm_hash.clone(),
        rolled_back_by: rolled_back_by.clone(),
        reason: reason.clone(),
    }
    .publish(env);
}
