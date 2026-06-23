use soroban_sdk::{contractevent, Address, Env, Symbol};

#[contractevent(topics = ["EmergencyPause", "PAUSED"])]
pub struct Paused {
    pub contract_address: Address,
    pub paused_by: Address,
    pub reason: Symbol,
}

#[contractevent(topics = ["EmergencyPause", "UNPAUSED"])]
pub struct Unpaused {
    pub contract_address: Address,
    pub unpaused_by: Address,
}

#[contractevent(topics = ["EmergencyPause", "FUNC_PAUSED"])]
pub struct FunctionPaused {
    pub contract_address: Address,
    pub function_name: Symbol,
    pub paused_by: Address,
    pub reason: Symbol,
}

#[contractevent(topics = ["EmergencyPause", "FUNC_UNPAUSED"])]
pub struct FunctionUnpaused {
    pub contract_address: Address,
    pub function_name: Symbol,
    pub unpaused_by: Address,
}

pub fn emit_paused(env: &Env, contract_address: &Address, paused_by: &Address, reason: &Symbol) {
    Paused {
        contract_address: contract_address.clone(),
        paused_by: paused_by.clone(),
        reason: reason.clone(),
    }
    .publish(env);
}

pub fn emit_unpaused(env: &Env, contract_address: &Address, unpaused_by: &Address) {
    Unpaused {
        contract_address: contract_address.clone(),
        unpaused_by: unpaused_by.clone(),
    }
    .publish(env);
}

pub fn emit_function_paused(env: &Env, contract_address: &Address, function_name: &Symbol, paused_by: &Address, reason: &Symbol) {
    FunctionPaused {
        contract_address: contract_address.clone(),
        function_name: function_name.clone(),
        paused_by: paused_by.clone(),
        reason: reason.clone(),
    }
    .publish(env);
}

pub fn emit_function_unpaused(env: &Env, contract_address: &Address, function_name: &Symbol, unpaused_by: &Address) {
    FunctionUnpaused {
        contract_address: contract_address.clone(),
        function_name: function_name.clone(),
        unpaused_by: unpaused_by.clone(),
    }
    .publish(env);
}
