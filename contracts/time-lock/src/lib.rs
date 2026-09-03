#![no_std]
// schedule_operation's parameter count reflects real, independent fields
// contract callers must supply (Soroban entry points can't take a struct
// param); #[contractimpl] generates the Client/Args types outside the impl
// block itself, so this needs to be crate-level to cover them too.
#![allow(clippy::too_many_arguments)]

use arenax_events::{time_lock as events, emergency_pause as ep_events};
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, Symbol, Vec};

// ─── Operation Status ─────────────────────────────────────────────────────────
pub const STATUS_SCHEDULED: u32 = 0;
pub const STATUS_EXECUTED: u32 = 1;
pub const STATUS_CANCELLED: u32 = 2;
pub const STATUS_EXPIRED: u32 = 3;

// ─── Priority Levels ──────────────────────────────────────────────────────────
pub const PRIORITY_LOW: u32 = 0;
pub const PRIORITY_MEDIUM: u32 = 1;
pub const PRIORITY_HIGH: u32 = 2;
pub const PRIORITY_CRITICAL: u32 = 3;

// ─── Category Constants ───────────────────────────────────────────────────────
pub const CATEGORY_GENERAL: u32 = 0;
pub const CATEGORY_TREASURY: u32 = 1;
pub const CATEGORY_UPGRADE: u32 = 2;
pub const CATEGORY_GOVERNANCE: u32 = 3;
pub const CATEGORY_EMERGENCY: u32 = 4;

// ─── Default Config ───────────────────────────────────────────────────────────
/// Default execution window after `execute_after` during which the op is valid (24 h)
pub const DEFAULT_GRACE_PERIOD: u64 = 86_400;
/// Maximum number of governors allowed
pub const MAX_GOVERNORS: u32 = 20;

// ─── Storage Keys ─────────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    // Instance storage (config)
    Admin,
    MinDelay,
    GracePeriod,
    AccelQuorum,
    Governors,

    // Persistent storage (per-operation)
    Operation(BytesN<32>),
    AccelVotes(BytesN<32>), // Vec<Address> of voters for an operation
    ActiveCount,

    // Analytics (persistent)
    AnalyticsTotal,
    AnalyticsByCategory(u32),
    LastExecution,
    Paused,
}

// ─── Structs ──────────────────────────────────────────────────────────────────

/// Flexible operation with scheduling window, priority, category, and metadata.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Operation {
    pub target: Address,
    pub function_name: Symbol,
    pub args: Bytes,
    /// Earliest timestamp at which this operation may be executed.
    pub execute_after: u64,
    /// Latest timestamp before which this operation must be executed (grace window).
    pub execute_before: u64,
    pub status: u32,
    pub description: Symbol,
    /// Address that proposed/scheduled this operation.
    pub proposer: Address,
    /// See CATEGORY_* constants.
    pub category: u32,
    /// See PRIORITY_* constants.
    pub priority: u32,
    /// Timestamp when the operation was originally scheduled.
    pub scheduled_at: u64,
}

/// Aggregate analytics counters stored on-chain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AnalyticsTotals {
    pub total_scheduled: u64,
    pub total_executed: u64,
    pub total_cancelled: u64,
    pub total_accelerated: u64,
    pub total_expired: u64,
    /// Cumulative sum of (executed_at - scheduled_at) for average-delay calculation.
    pub cumulative_delay_secs: u64,
}

/// Per-category analytics counters.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CategoryStats {
    pub category: u32,
    pub scheduled: u64,
    pub executed: u64,
    pub cancelled: u64,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct TimeLock;

#[contractimpl]
impl TimeLock {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Initialize the time-lock manager.
    ///
    /// - `admin` – the initial admin address (also added as the first governor).
    /// - `min_delay` – minimum seconds between scheduling and earliest execution.
    /// - `grace_period` – how many seconds after `execute_after` the window stays open.
    /// - `accel_quorum` – number of governor votes required to accelerate an operation.
    pub fn initialize(
        env: Env,
        admin: Address,
        min_delay: u64,
        grace_period: u64,
        accel_quorum: u32,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();

        let mut governors: Vec<Address> = Vec::new(&env);
        governors.push_back(admin.clone());

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::MinDelay, &min_delay);
        env.storage()
            .instance()
            .set(&DataKey::GracePeriod, &grace_period);
        env.storage()
            .instance()
            .set(&DataKey::AccelQuorum, &accel_quorum);        env.storage().instance().set(&DataKey::Governors, &governors);
        env.storage().instance().set(&DataKey::Paused, &false);

        // Initialise analytics
        let totals = AnalyticsTotals {
            total_scheduled: 0,
            total_executed: 0,
            total_cancelled: 0,
            total_accelerated: 0,
            total_expired: 0,
            cumulative_delay_secs: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsTotal, &totals);
        env.storage().persistent().set(&DataKey::ActiveCount, &0u32);
    }

    // ── Scheduling ────────────────────────────────────────────────────────────

    /// Schedule a new operation in the time-lock queue.
    ///
    /// Any registered governor may schedule an operation.  The `delay` must be
    /// ≥ `min_delay`.  An optional `custom_grace_period` overrides the contract-
    /// level default for this specific operation (use 0 to apply the default).
    pub fn schedule_operation(
        env: Env,
        caller: Address,
        operation_id: BytesN<32>,
        target: Address,
        function_name: Symbol,
        args: Bytes,
        delay: u64,
        description: Symbol,
        category: u32,
        priority: u32,
        custom_grace_period: u64,
    ) {
        caller.require_auth();
        Self::require_not_paused(&env);
        Self::require_governor(&env, &caller);

        let min_delay: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MinDelay)
            .unwrap_or(0);
        if delay < min_delay {
            panic!("delay is less than minimum delay");
        }

        let key = DataKey::Operation(operation_id.clone());
        if env.storage().persistent().has(&key) {
            panic!("operation already scheduled");
        }

        let now = env.ledger().timestamp();
        let execute_after = now + delay;
        let grace = if custom_grace_period > 0 {
            custom_grace_period
        } else {
            env.storage()
                .instance()
                .get(&DataKey::GracePeriod)
                .unwrap_or(DEFAULT_GRACE_PERIOD)
        };
        let execute_before = execute_after + grace;

        let op = Operation {
            target: target.clone(),
            function_name: function_name.clone(),
            args,
            execute_after,
            execute_before,
            status: STATUS_SCHEDULED,
            description: description.clone(),
            proposer: caller.clone(),
            category,
            priority,
            scheduled_at: now,
        };
        env.storage().persistent().set(&key, &op);

        // Initialise empty votes list for this operation
        let votes: Vec<Address> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::AccelVotes(operation_id.clone()), &votes);

        // Analytics
        let mut totals = Self::get_analytics_totals(&env);
        totals.total_scheduled += 1;
        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsTotal, &totals);
        Self::increment_category_scheduled(&env, category);

        let active: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::ActiveCount)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::ActiveCount, &(active + 1));

        events::emit_operation_scheduled(
            &env,
            &operation_id,
            &target,
            &function_name,
            execute_after,
            execute_before,
            &description,
            category,
            priority,
            &caller,
        );
    }

    // ── Execution ─────────────────────────────────────────────────────────────

    /// Execute a scheduled operation once the time-lock delay has passed.
    ///
    /// If the operation's `execute_before` window has elapsed it is marked as
    /// expired instead of executed.
    pub fn execute_operation(env: Env, caller: Address, operation_id: BytesN<32>) {
        caller.require_auth();
        Self::require_not_paused(&env);
        Self::require_governor(&env, &caller);

        let key = DataKey::Operation(operation_id.clone());
        let mut op: Operation = env
            .storage()
            .persistent()
            .get(&key)
            .expect("operation not found");

        if op.status != STATUS_SCHEDULED {
            panic!("operation is not in scheduled state");
        }

        let now = env.ledger().timestamp();

        // Grace-window expiry check
        if now > op.execute_before {
            op.status = STATUS_EXPIRED;
            env.storage().persistent().set(&key, &op);
            Self::decrement_active(&env);
            let mut totals = Self::get_analytics_totals(&env);
            totals.total_expired += 1;
            env.storage()
                .persistent()
                .set(&DataKey::AnalyticsTotal, &totals);
            events::emit_operation_expired(&env, &operation_id, op.execute_before);
            panic!("operation execution window has expired");
        }

        if now < op.execute_after {
            panic!("timelock delay has not expired yet");
        }

        let actual_delay = now - op.scheduled_at;
        op.status = STATUS_EXECUTED;
        env.storage().persistent().set(&key, &op);

        // Analytics
        let mut totals = Self::get_analytics_totals(&env);
        totals.total_executed += 1;
        totals.cumulative_delay_secs += actual_delay;
        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsTotal, &totals);
        Self::increment_category_executed(&env, op.category);
        env.storage()
            .persistent()
            .set(&DataKey::LastExecution, &now);
        Self::decrement_active(&env);

        events::emit_operation_executed(&env, &operation_id, &caller, now, actual_delay);
    }

    // ── Cancellation ──────────────────────────────────────────────────────────

    /// Cancel a scheduled operation.  Any governor may cancel any pending op.
    pub fn cancel_operation(env: Env, caller: Address, operation_id: BytesN<32>) {
        caller.require_auth();
        Self::require_not_paused(&env);
        Self::require_governor(&env, &caller);

        let key = DataKey::Operation(operation_id.clone());
        let mut op: Operation = env
            .storage()
            .persistent()
            .get(&key)
            .expect("operation not found");

        if op.status != STATUS_SCHEDULED {
            panic!("operation is not in scheduled state");
        }

        op.status = STATUS_CANCELLED;
        env.storage().persistent().set(&key, &op);

        let mut totals = Self::get_analytics_totals(&env);
        totals.total_cancelled += 1;
        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsTotal, &totals);
        Self::increment_category_cancelled(&env, op.category);
        Self::decrement_active(&env);

        events::emit_operation_cancelled(&env, &operation_id, &caller);
    }

    // ── Acceleration & Governance Override ───────────────────────────────────

    /// Cast a vote to accelerate an operation.
    ///
    /// When accumulated votes reach the `accel_quorum` the operation is
    /// immediately marked executed (bypassing the remaining delay).
    /// Each governor may vote at most once per operation.
    pub fn vote_accelerate(env: Env, voter: Address, operation_id: BytesN<32>) {
        voter.require_auth();
        Self::require_not_paused(&env);
        Self::require_governor(&env, &voter);

        let key = DataKey::Operation(operation_id.clone());
        let mut op: Operation = env
            .storage()
            .persistent()
            .get(&key)
            .expect("operation not found");

        if op.status != STATUS_SCHEDULED {
            panic!("operation is not in scheduled state");
        }

        let votes_key = DataKey::AccelVotes(operation_id.clone());
        let mut votes: Vec<Address> = env
            .storage()
            .persistent()
            .get(&votes_key)
            .unwrap_or_else(|| Vec::new(&env));

        // Prevent double-voting
        for existing in votes.iter() {
            if existing == voter {
                panic!("already voted to accelerate this operation");
            }
        }
        votes.push_back(voter.clone());
        env.storage().persistent().set(&votes_key, &votes);

        let total_votes = votes.len();
        events::emit_acceleration_vote(&env, &operation_id, &voter, total_votes);

        let quorum: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AccelQuorum)
            .unwrap_or(1);

        if total_votes >= quorum {
            let now = env.ledger().timestamp();
            let actual_delay = now - op.scheduled_at;
            op.status = STATUS_EXECUTED;
            env.storage().persistent().set(&key, &op);

            let mut totals = Self::get_analytics_totals(&env);
            totals.total_executed += 1;
            totals.total_accelerated += 1;
            totals.cumulative_delay_secs += actual_delay;
            env.storage()
                .persistent()
                .set(&DataKey::AnalyticsTotal, &totals);
            Self::increment_category_executed(&env, op.category);
            env.storage()
                .persistent()
                .set(&DataKey::LastExecution, &now);
            Self::decrement_active(&env);

            events::emit_operation_accelerated(&env, &operation_id, &voter, total_votes, quorum);
        }
    }

    /// Admin-only emergency override: immediately execute or cancel an operation
    /// regardless of delay, bypassing the quorum mechanism.
    ///
    /// - `execute`: if `true` the operation is executed; if `false` it is cancelled.
    /// - `reason`: short symbol describing why the override was necessary.
    pub fn governance_override(
        env: Env,
        caller: Address,
        operation_id: BytesN<32>,
        execute: bool,
        reason: Symbol,
    ) {
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if caller != admin {
            panic!("only admin may invoke governance override");
        }

        let key = DataKey::Operation(operation_id.clone());
        let mut op: Operation = env
            .storage()
            .persistent()
            .get(&key)
            .expect("operation not found");

        if op.status != STATUS_SCHEDULED {
            panic!("operation is not in scheduled state");
        }

        let now = env.ledger().timestamp();
        if execute {
            let actual_delay = now - op.scheduled_at;
            op.status = STATUS_EXECUTED;
            let mut totals = Self::get_analytics_totals(&env);
            totals.total_executed += 1;
            totals.cumulative_delay_secs += actual_delay;
            env.storage()
                .persistent()
                .set(&DataKey::AnalyticsTotal, &totals);
            Self::increment_category_executed(&env, op.category);
            env.storage()
                .persistent()
                .set(&DataKey::LastExecution, &now);
        } else {
            op.status = STATUS_CANCELLED;
            let mut totals = Self::get_analytics_totals(&env);
            totals.total_cancelled += 1;
            env.storage()
                .persistent()
                .set(&DataKey::AnalyticsTotal, &totals);
            Self::increment_category_cancelled(&env, op.category);
        }
        env.storage().persistent().set(&key, &op);
        Self::decrement_active(&env);

        events::emit_governance_override(&env, &operation_id, &caller, &reason);
    }

    // ── Governor Management ───────────────────────────────────────────────────

    /// Add a new governor.  Only the admin may call this.
    pub fn add_governor(env: Env, caller: Address, new_governor: Address) {
        caller.require_auth();
        Self::require_not_paused(&env);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if caller != admin {
            panic!("only admin can add governors");
        }

        let mut governors: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Governors)
            .unwrap_or_else(|| Vec::new(&env));

        for g in governors.iter() {
            if g == new_governor {
                panic!("address is already a governor");
            }
        }
        if governors.len() >= MAX_GOVERNORS {
            panic!("governor limit reached");
        }
        governors.push_back(new_governor.clone());
        env.storage()
            .instance()
            .set(&DataKey::Governors, &governors);

        events::emit_governor_added(&env, &new_governor, &caller);
    }

    /// Remove an existing governor.  Only the admin may call this.
    /// The admin cannot remove themselves if they are the last governor.
    pub fn remove_governor(env: Env, caller: Address, governor: Address) {
        caller.require_auth();
        Self::require_not_paused(&env);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if caller != admin {
            panic!("only admin can remove governors");
        }

        let governors: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Governors)
            .unwrap_or_else(|| Vec::new(&env));

        if governors.len() <= 1 {
            panic!("cannot remove the last governor");
        }

        let mut new_governors: Vec<Address> = Vec::new(&env);
        let mut found = false;
        for g in governors.iter() {
            if g == governor {
                found = true;
            } else {
                new_governors.push_back(g);
            }
        }
        if !found {
            panic!("address is not a governor");
        }
        env.storage()
            .instance()
            .set(&DataKey::Governors, &new_governors);

        events::emit_governor_removed(&env, &governor, &caller);
    }

    // ── Configuration ─────────────────────────────────────────────────────────

    /// Update the minimum delay (admin only).
    pub fn update_min_delay(env: Env, caller: Address, new_delay: u64) {
        caller.require_auth();
        Self::require_admin(&env, &caller);

        let old: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MinDelay)
            .unwrap_or(0);
        env.storage().instance().set(&DataKey::MinDelay, &new_delay);
        events::emit_min_delay_updated(&env, old, new_delay, &caller);
    }

    /// Update the default grace period (admin only).
    pub fn update_grace_period(env: Env, caller: Address, new_grace: u64) {
        caller.require_auth();
        Self::require_admin(&env, &caller);

        if new_grace == 0 {
            panic!("grace period must be > 0");
        }
        let old: u64 = env
            .storage()
            .instance()
            .get(&DataKey::GracePeriod)
            .unwrap_or(DEFAULT_GRACE_PERIOD);
        env.storage()
            .instance()
            .set(&DataKey::GracePeriod, &new_grace);
        events::emit_grace_period_updated(&env, old, new_grace, &caller);
    }

    /// Update the acceleration quorum (admin only).
    pub fn update_accel_quorum(env: Env, caller: Address, new_quorum: u32) {
        caller.require_auth();
        Self::require_admin(&env, &caller);

        if new_quorum == 0 {
            panic!("quorum must be > 0");
        }
        let old: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AccelQuorum)
            .unwrap_or(1);
        env.storage()
            .instance()
            .set(&DataKey::AccelQuorum, &new_quorum);
        events::emit_quorum_updated(&env, old, new_quorum, &caller);
    }

    // ── Read / Query ──────────────────────────────────────────────────────────

    pub fn get_operation(env: Env, operation_id: BytesN<32>) -> Option<Operation> {
        env.storage()
            .persistent()
            .get(&DataKey::Operation(operation_id))
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    pub fn get_min_delay(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::MinDelay)
            .unwrap_or(0)
    }

    pub fn get_grace_period(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::GracePeriod)
            .unwrap_or(DEFAULT_GRACE_PERIOD)
    }

    pub fn get_accel_quorum(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::AccelQuorum)
            .unwrap_or(1)
    }

    pub fn get_governors(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Governors)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn is_governor(env: Env, address: Address) -> bool {
        let governors: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Governors)
            .unwrap_or_else(|| Vec::new(&env));
        for g in governors.iter() {
            if g == address {
                return true;
            }
        }
        false
    }

    pub fn get_accel_votes(env: Env, operation_id: BytesN<32>) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::AccelVotes(operation_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ── Analytics ─────────────────────────────────────────────────────────────

    pub fn get_analytics(env: Env) -> AnalyticsTotals {
        Self::get_analytics_totals(&env)
    }

    pub fn get_category_stats(env: Env, category: u32) -> CategoryStats {
        env.storage()
            .persistent()
            .get(&DataKey::AnalyticsByCategory(category))
            .unwrap_or(CategoryStats {
                category,
                scheduled: 0,
                executed: 0,
                cancelled: 0,
            })
    }

    /// Average delay (in seconds) across all executed operations.
    /// Returns 0 if no operations have been executed yet.
    pub fn get_average_delay(env: Env) -> u64 {
        let totals = Self::get_analytics_totals(&env);
        if totals.total_executed == 0 {
            return 0;
        }
        totals.cumulative_delay_secs / totals.total_executed
    }

    // ── Monitoring ────────────────────────────────────────────────────────────

    pub fn get_active_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::ActiveCount)
            .unwrap_or(0)
    }

    pub fn get_last_execution_timestamp(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::LastExecution)
            .unwrap_or(0)
    }

    /// Emit a monitoring snapshot event with current counters.
    pub fn emit_snapshot(env: Env) {
        let totals = Self::get_analytics_totals(&env);
        let active: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::ActiveCount)
            .unwrap_or(0);
        events::emit_monitoring_snapshot(
            &env,
            active,
            totals.total_scheduled,
            totals.total_executed,
            totals.total_cancelled,
            totals.total_accelerated,
        );
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env, &env.current_contract_address());
        let contract_address = env.current_contract_address();
        let admin = Self::get_admin(env.clone());
        env.storage().instance().set(&DataKey::Paused, &paused);
        if paused {
            ep_events::emit_paused(&env, &contract_address, &admin, &symbol_short!("EMERGENCY"));
        } else {
            ep_events::emit_unpaused(&env, &contract_address, &admin);
        }
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }

    fn require_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if caller != &admin {
            panic!("only admin can perform this action");
        }
    }

    fn require_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }
    }

    fn require_governor(env: &Env, caller: &Address) {
        let governors: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Governors)
            .unwrap_or_else(|| Vec::new(env));
        for g in governors.iter() {
            if &g == caller {
                return;
            }
        }
        panic!("caller is not a governor");
    }

    fn get_analytics_totals(env: &Env) -> AnalyticsTotals {
        env.storage()
            .persistent()
            .get(&DataKey::AnalyticsTotal)
            .unwrap_or(AnalyticsTotals {
                total_scheduled: 0,
                total_executed: 0,
                total_cancelled: 0,
                total_accelerated: 0,
                total_expired: 0,
                cumulative_delay_secs: 0,
            })
    }

    fn decrement_active(env: &Env) {
        let active: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::ActiveCount)
            .unwrap_or(0);
        if active > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::ActiveCount, &(active - 1));
        }
    }

    fn increment_category_scheduled(env: &Env, category: u32) {
        let key = DataKey::AnalyticsByCategory(category);
        let mut stats: CategoryStats =
            env.storage()
                .persistent()
                .get(&key)
                .unwrap_or(CategoryStats {
                    category,
                    scheduled: 0,
                    executed: 0,
                    cancelled: 0,
                });
        stats.scheduled += 1;
        env.storage().persistent().set(&key, &stats);
    }

    fn increment_category_executed(env: &Env, category: u32) {
        let key = DataKey::AnalyticsByCategory(category);
        let mut stats: CategoryStats =
            env.storage()
                .persistent()
                .get(&key)
                .unwrap_or(CategoryStats {
                    category,
                    scheduled: 0,
                    executed: 0,
                    cancelled: 0,
                });
        stats.executed += 1;
        env.storage().persistent().set(&key, &stats);
    }

    fn increment_category_cancelled(env: &Env, category: u32) {
        let key = DataKey::AnalyticsByCategory(category);
        let mut stats: CategoryStats =
            env.storage()
                .persistent()
                .get(&key)
                .unwrap_or(CategoryStats {
                    category,
                    scheduled: 0,
                    executed: 0,
                    cancelled: 0,
                });
        stats.cancelled += 1;
        env.storage().persistent().set(&key, &stats);
    }
}

#[cfg(test)]
mod test;
