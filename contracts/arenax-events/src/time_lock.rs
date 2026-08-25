//! Time-lock domain events.
//!
//! NAMESPACE: "TimeLock"
//! VERSION: "v2"
//!
//! Events cover the full lifecycle: scheduling, execution, cancellation,
//! acceleration (with governance quorum), governor management, configuration
//! changes, and monitoring snapshots.

use soroban_sdk::{contractevent, Address, BytesN, Env, Symbol};

pub const NAMESPACE: &str = "TimeLock";
pub const VERSION: &str = "v2";

// ─── Core lifecycle events ────────────────────────────────────────────────────

#[contractevent(topics = ["TimeLock", "SCHEDULED"])]
pub struct OperationScheduled {
    pub operation_id: BytesN<32>,
    pub target: Address,
    pub function_name: Symbol,
    pub execute_after: u64,
    pub execute_before: u64,
    pub description: Symbol,
    pub category: u32,
    pub priority: u32,
    pub proposer: Address,
}

#[contractevent(topics = ["TimeLock", "EXECUTED"])]
pub struct OperationExecuted {
    pub operation_id: BytesN<32>,
    pub executor: Address,
    pub executed_at: u64,
    pub actual_delay: u64,
}

#[contractevent(topics = ["TimeLock", "CANCELLED"])]
pub struct OperationCancelled {
    pub operation_id: BytesN<32>,
    pub cancelled_by: Address,
}

#[contractevent(topics = ["TimeLock", "EXPIRED"])]
pub struct OperationExpired {
    pub operation_id: BytesN<32>,
    pub execute_before: u64,
}

// ─── Acceleration / governance override events ────────────────────────────────

#[contractevent(topics = ["TimeLock", "ACCELERATED"])]
pub struct OperationAccelerated {
    pub operation_id: BytesN<32>,
    pub accelerated_by: Address,
    pub votes: u32,
    pub quorum_required: u32,
}

#[contractevent(topics = ["TimeLock", "ACCEL_VOTE"])]
pub struct AccelerationVoteCast {
    pub operation_id: BytesN<32>,
    pub voter: Address,
    pub total_votes: u32,
}

#[contractevent(topics = ["TimeLock", "GOV_OVERRIDE"])]
pub struct GovernanceOverride {
    pub operation_id: BytesN<32>,
    pub governor: Address,
    pub reason: Symbol,
}

// ─── Governor management events ───────────────────────────────────────────────

#[contractevent(topics = ["TimeLock", "GOV_ADDED"])]
pub struct GovernorAdded {
    pub governor: Address,
    pub added_by: Address,
}

#[contractevent(topics = ["TimeLock", "GOV_REMOVED"])]
pub struct GovernorRemoved {
    pub governor: Address,
    pub removed_by: Address,
}

// ─── Configuration change events ──────────────────────────────────────────────

#[contractevent(topics = ["TimeLock", "DELAY_UPDATED"])]
pub struct MinDelayUpdated {
    pub old_delay: u64,
    pub new_delay: u64,
    pub updated_by: Address,
}

#[contractevent(topics = ["TimeLock", "WINDOW_UPDATED"])]
pub struct GracePeriodUpdated {
    pub old_window: u64,
    pub new_window: u64,
    pub updated_by: Address,
}

#[contractevent(topics = ["TimeLock", "QUORUM_UPDATED"])]
pub struct QuorumUpdated {
    pub old_quorum: u32,
    pub new_quorum: u32,
    pub updated_by: Address,
}

// ─── Monitoring snapshot events ───────────────────────────────────────────────

#[contractevent(topics = ["TimeLock", "SNAPSHOT"])]
pub struct MonitoringSnapshot {
    pub active_operations: u32,
    pub total_scheduled: u64,
    pub total_executed: u64,
    pub total_cancelled: u64,
    pub total_accelerated: u64,
    pub snapshot_at: u64,
}

// ─── Emit helpers ─────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub fn emit_operation_scheduled(
    env: &Env,
    operation_id: &BytesN<32>,
    target: &Address,
    function_name: &Symbol,
    execute_after: u64,
    execute_before: u64,
    description: &Symbol,
    category: u32,
    priority: u32,
    proposer: &Address,
) {
    OperationScheduled {
        operation_id: operation_id.clone(),
        target: target.clone(),
        function_name: function_name.clone(),
        execute_after,
        execute_before,
        description: description.clone(),
        category,
        priority,
        proposer: proposer.clone(),
    }
    .publish(env);
}

pub fn emit_operation_executed(
    env: &Env,
    operation_id: &BytesN<32>,
    executor: &Address,
    executed_at: u64,
    actual_delay: u64,
) {
    OperationExecuted {
        operation_id: operation_id.clone(),
        executor: executor.clone(),
        executed_at,
        actual_delay,
    }
    .publish(env);
}

pub fn emit_operation_cancelled(env: &Env, operation_id: &BytesN<32>, cancelled_by: &Address) {
    OperationCancelled {
        operation_id: operation_id.clone(),
        cancelled_by: cancelled_by.clone(),
    }
    .publish(env);
}

pub fn emit_operation_expired(env: &Env, operation_id: &BytesN<32>, execute_before: u64) {
    OperationExpired {
        operation_id: operation_id.clone(),
        execute_before,
    }
    .publish(env);
}

pub fn emit_operation_accelerated(
    env: &Env,
    operation_id: &BytesN<32>,
    accelerated_by: &Address,
    votes: u32,
    quorum_required: u32,
) {
    OperationAccelerated {
        operation_id: operation_id.clone(),
        accelerated_by: accelerated_by.clone(),
        votes,
        quorum_required,
    }
    .publish(env);
}

pub fn emit_acceleration_vote(
    env: &Env,
    operation_id: &BytesN<32>,
    voter: &Address,
    total_votes: u32,
) {
    AccelerationVoteCast {
        operation_id: operation_id.clone(),
        voter: voter.clone(),
        total_votes,
    }
    .publish(env);
}

pub fn emit_governance_override(
    env: &Env,
    operation_id: &BytesN<32>,
    governor: &Address,
    reason: &Symbol,
) {
    GovernanceOverride {
        operation_id: operation_id.clone(),
        governor: governor.clone(),
        reason: reason.clone(),
    }
    .publish(env);
}

pub fn emit_governor_added(env: &Env, governor: &Address, added_by: &Address) {
    GovernorAdded {
        governor: governor.clone(),
        added_by: added_by.clone(),
    }
    .publish(env);
}

pub fn emit_governor_removed(env: &Env, governor: &Address, removed_by: &Address) {
    GovernorRemoved {
        governor: governor.clone(),
        removed_by: removed_by.clone(),
    }
    .publish(env);
}

pub fn emit_min_delay_updated(env: &Env, old_delay: u64, new_delay: u64, updated_by: &Address) {
    MinDelayUpdated {
        old_delay,
        new_delay,
        updated_by: updated_by.clone(),
    }
    .publish(env);
}

pub fn emit_grace_period_updated(
    env: &Env,
    old_window: u64,
    new_window: u64,
    updated_by: &Address,
) {
    GracePeriodUpdated {
        old_window,
        new_window,
        updated_by: updated_by.clone(),
    }
    .publish(env);
}

pub fn emit_quorum_updated(env: &Env, old_quorum: u32, new_quorum: u32, updated_by: &Address) {
    QuorumUpdated {
        old_quorum,
        new_quorum,
        updated_by: updated_by.clone(),
    }
    .publish(env);
}

pub fn emit_monitoring_snapshot(
    env: &Env,
    active_operations: u32,
    total_scheduled: u64,
    total_executed: u64,
    total_cancelled: u64,
    total_accelerated: u64,
) {
    MonitoringSnapshot {
        active_operations,
        total_scheduled,
        total_executed,
        total_cancelled,
        total_accelerated,
        snapshot_at: env.ledger().timestamp(),
    }
    .publish(env);
}

// Keep backward-compatible shims (used by old contract code)
pub fn emit_operation_scheduled_legacy(
    env: &Env,
    operation_id: &BytesN<32>,
    target: &Address,
    function_name: &Symbol,
    execute_after: u64,
    description: &Symbol,
) {
    emit_operation_scheduled(
        env,
        operation_id,
        target,
        function_name,
        execute_after,
        execute_after + 86_400, // 1-day grace window as default
        description,
        0,      // CATEGORY_GENERAL
        1,      // PRIORITY_MEDIUM
        target, // proposer falls back to target for legacy calls
    );
}
