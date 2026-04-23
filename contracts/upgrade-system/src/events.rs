use soroban_sdk::{symbol_short, Address, BytesN, Env, String};

/// Emit event when upgrade system is initialized
pub fn emit_initialized(env: &Env, governance: &Address, required_approvals: u32) {
    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("init"), symbol_short!("upgrade")),
        (governance, required_approvals),
    );
}

/// Emit event when upgrade is proposed
pub fn emit_upgrade_proposed(
    env: &Env,
    proposal_id: &BytesN<32>,
    contract: &Address,
    proposer: &Address,
    timelock_end: u64,
) {
    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("upgrade"), symbol_short!("proposed")),
        (proposal_id, contract, proposer, timelock_end),
    );
}

/// Emit event when upgrade is validated
pub fn emit_upgrade_validated(
    env: &Env,
    proposal_id: &BytesN<32>,
    validator: &Address,
    compatibility_score: u32,
    passed: bool,
) {
    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("upgrade"), symbol_short!("validate")),
        (proposal_id, validator, compatibility_score, passed),
    );
}

/// Emit event when upgrade is approved
pub fn emit_upgrade_approved(
    env: &Env,
    proposal_id: &BytesN<32>,
    approver: &Address,
    approval_count: u32,
) {
    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("upgrade"), symbol_short!("approved")),
        (proposal_id, approver, approval_count),
    );
}

/// Emit event when upgrade is scheduled
pub fn emit_upgrade_scheduled(env: &Env, proposal_id: &BytesN<32>, scheduled_at: u64) {
    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("upgrade"), symbol_short!("schedule")),
        (proposal_id, scheduled_at),
    );
}

/// Emit event when upgrade is executed
pub fn emit_upgrade_executed(
    env: &Env,
    proposal_id: &BytesN<32>,
    contract: &Address,
    executor: &Address,
    success: bool,
) {
    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("upgrade"), symbol_short!("executed")),
        (proposal_id, contract, executor, success),
    );
}

/// Emit event when upgrade is rolled back
pub fn emit_upgrade_rolled_back(
    env: &Env,
    contract: &Address,
    initiator: &Address,
    reason: &String,
) {
    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("upgrade"), symbol_short!("rollback")),
        (contract, initiator, reason),
    );
}

/// Emit event when contract is paused
pub fn emit_emergency_pause(env: &Env, contract: &Address, paused_by: &Address, reason: &String) {
    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("emergenc"), symbol_short!("pause")),
        (contract, paused_by, reason),
    );
}

/// Emit event when contract is unpaused
pub fn emit_emergency_unpause(env: &Env, contract: &Address, unpaused_by: &Address) {
    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("emergenc"), symbol_short!("unpause")),
        (contract, unpaused_by),
    );
}

/// Emit event when upgrade is cancelled
#[allow(dead_code)]
pub fn emit_upgrade_cancelled(env: &Env, proposal_id: &BytesN<32>, cancelled_by: &Address) {
    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("upgrade"), symbol_short!("cancel")),
        (proposal_id, cancelled_by),
    );
}

/// Emit event when simulation is completed
#[allow(dead_code)]
pub fn emit_simulation_completed(env: &Env, proposal_id: &BytesN<32>, passed: bool) {
    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("simulate"), symbol_short!("complete")),
        (proposal_id, passed),
    );
}
