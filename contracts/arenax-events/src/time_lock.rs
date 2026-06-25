use soroban_sdk::{contractevent, Address, BytesN, Env, Symbol};

#[contractevent(topics = ["TimeLock", "SCHEDULED"])]
pub struct OperationScheduled {
    pub operation_id: BytesN<32>,
    pub target: Address,
    pub function_name: Symbol,
    pub execute_after: u64,
    pub description: Symbol,
}

#[contractevent(topics = ["TimeLock", "EXECUTED"])]
pub struct OperationExecuted {
    pub operation_id: BytesN<32>,
}

#[contractevent(topics = ["TimeLock", "CANCELLED"])]
pub struct OperationCancelled {
    pub operation_id: BytesN<32>,
}

#[contractevent(topics = ["TimeLock", "ACCELERATED"])]
pub struct OperationAccelerated {
    pub operation_id: BytesN<32>,
}

pub fn emit_operation_scheduled(
    env: &Env,
    operation_id: &BytesN<32>,
    target: &Address,
    function_name: &Symbol,
    execute_after: u64,
    description: &Symbol,
) {
    OperationScheduled {
        operation_id: operation_id.clone(),
        target: target.clone(),
        function_name: function_name.clone(),
        execute_after,
        description: description.clone(),
    }
    .publish(env);
}

pub fn emit_operation_executed(env: &Env, operation_id: &BytesN<32>) {
    OperationExecuted {
        operation_id: operation_id.clone(),
    }
    .publish(env);
}

pub fn emit_operation_cancelled(env: &Env, operation_id: &BytesN<32>) {
    OperationCancelled {
        operation_id: operation_id.clone(),
    }
    .publish(env);
}

pub fn emit_operation_accelerated(env: &Env, operation_id: &BytesN<32>) {
    OperationAccelerated {
        operation_id: operation_id.clone(),
    }
    .publish(env);
}
