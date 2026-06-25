#![no_std]

use arenax_events::time_lock as events;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, Symbol};

// Operation Status
pub const STATUS_SCHEDULED: u32 = 0;
pub const STATUS_EXECUTED: u32 = 1;
pub const STATUS_CANCELLED: u32 = 2;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    MinDelay,
    Operation(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Operation {
    pub target: Address,
    pub function_name: Symbol,
    pub args: Bytes,
    pub execute_after: u64,
    pub status: u32,
    pub description: Symbol,
}

#[contract]
pub struct TimeLock;

#[contractimpl]
impl TimeLock {
    /// Initialize the time-lock manager with an admin and min delay
    pub fn initialize(env: Env, admin: Address, min_delay: u64) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::MinDelay, &min_delay);
    }

    /// Schedule a new operation in the time-lock queue
    pub fn schedule_operation(
        env: Env,
        caller: Address,
        operation_id: BytesN<32>,
        target: Address,
        function_name: Symbol,
        args: Bytes,
        delay: u64,
        description: Symbol,
    ) {
        caller.require_auth();

        let admin = Self::get_admin(env.clone());
        if caller != admin {
            panic!("only admin/governance can schedule operations");
        }

        // Verify delay is greater than or equal to min delay
        let min_delay = Self::get_min_delay(env.clone());
        if delay < min_delay {
            panic!("delay is less than minimum delay");
        }

        // Ensure operation doesn't already exist
        let key = DataKey::Operation(operation_id.clone());
        if env.storage().persistent().has(&key) {
            panic!("operation already scheduled");
        }

        let execute_after = env.ledger().timestamp() + delay;

        let op = Operation {
            target: target.clone(),
            function_name: function_name.clone(),
            args,
            execute_after,
            status: STATUS_SCHEDULED,
            description: description.clone(),
        };

        env.storage().persistent().set(&key, &op);

        events::emit_operation_scheduled(&env, &operation_id, &target, &function_name, execute_after, &description);
    }

    /// Execute a scheduled operation if the timelock delay has passed
    pub fn execute_operation(env: Env, caller: Address, operation_id: BytesN<32>) {
        caller.require_auth();

        let admin = Self::get_admin(env.clone());
        if caller != admin {
            panic!("only admin/governance can execute operations");
        }

        let key = DataKey::Operation(operation_id.clone());
        let mut op: Operation = env.storage().persistent().get(&key).expect("operation not found");

        if op.status != STATUS_SCHEDULED {
            panic!("operation is not scheduled");
        }

        let now = env.ledger().timestamp();
        if now < op.execute_after {
            panic!("timelock delay has not expired yet");
        }

        // Mark as executed
        op.status = STATUS_EXECUTED;
        env.storage().persistent().set(&key, &op);

        // Perform mock contract execution (in production this would use contract invocation)
        // e.g. env.invoke_contract(...)
        
        events::emit_operation_executed(&env, &operation_id);
    }

    /// Cancel a scheduled operation
    pub fn cancel_operation(env: Env, caller: Address, operation_id: BytesN<32>) {
        caller.require_auth();

        let admin = Self::get_admin(env.clone());
        if caller != admin {
            panic!("only admin/governance can cancel operations");
        }

        let key = DataKey::Operation(operation_id.clone());
        let mut op: Operation = env.storage().persistent().get(&key).expect("operation not found");

        if op.status != STATUS_SCHEDULED {
            panic!("operation is not scheduled");
        }

        op.status = STATUS_CANCELLED;
        env.storage().persistent().set(&key, &op);

        events::emit_operation_cancelled(&env, &operation_id);
    }

    /// Accelerate a scheduled operation (execute immediately bypassing the timelock)
    pub fn accelerate_operation(env: Env, caller: Address, operation_id: BytesN<32>) {
        caller.require_auth();

        let admin = Self::get_admin(env.clone());
        if caller != admin {
            panic!("only admin/governance can accelerate operations");
        }

        let key = DataKey::Operation(operation_id.clone());
        let mut op: Operation = env.storage().persistent().get(&key).expect("operation not found");

        if op.status != STATUS_SCHEDULED {
            panic!("operation is not scheduled");
        }

        // Set status as executed
        op.status = STATUS_EXECUTED;
        env.storage().persistent().set(&key, &op);

        events::emit_operation_accelerated(&env, &operation_id);
    }

    /// Get details of an operation
    pub fn get_operation(env: Env, operation_id: BytesN<32>) -> Option<Operation> {
        let key = DataKey::Operation(operation_id);
        env.storage().persistent().get(&key)
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).expect("not initialized")
    }

    /// Get minimum delay
    pub fn get_min_delay(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::MinDelay).unwrap_or(0)
    }

    /// Update minimum delay
    pub fn update_min_delay(env: Env, caller: Address, new_delay: u64) {
        caller.require_auth();

        let admin = Self::get_admin(env.clone());
        if caller != admin {
            panic!("only admin/governance can update min delay");
        }

        env.storage().instance().set(&DataKey::MinDelay, &new_delay);
    }
}

#[cfg(test)]
mod test;
