#![no_std]

use arenax_events::emergency_pause as events;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Paused(Address),
    FunctionPaused(Address, Symbol),
    PauseMetadata(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PauseMetadata {
    pub paused_by: Address,
    pub paused_at: u64,
    pub reason: Symbol,
}

#[contract]
pub struct EmergencyPause;

#[contractimpl]
impl EmergencyPause {
    /// Initialize the emergency pause contract with an admin (e.g. Governance Multi-sig)
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Pause an entire contract (Contract-wide pause)
    pub fn pause_contract(env: Env, caller: Address, contract_address: Address, reason: Symbol) {
        caller.require_auth();

        // Caller must be Admin
        let admin = Self::get_admin(env.clone());
        if caller != admin {
            panic!("only admin/governance can trigger emergency pause");
        }

        let key = DataKey::Paused(contract_address.clone());
        env.storage().persistent().set(&key, &true);

        let meta_key = DataKey::PauseMetadata(contract_address.clone());
        let metadata = PauseMetadata {
            paused_by: caller.clone(),
            paused_at: env.ledger().timestamp(),
            reason: reason.clone(),
        };
        env.storage().persistent().set(&meta_key, &metadata);

        events::emit_paused(&env, &contract_address, &caller, &reason);
    }

    /// Unpause an entire contract
    pub fn unpause_contract(env: Env, caller: Address, contract_address: Address) {
        caller.require_auth();

        // Strict Admin/Governance authorization for unpausing
        let admin = Self::get_admin(env.clone());
        if caller != admin {
            panic!("only admin/governance can unpause contracts");
        }

        let key = DataKey::Paused(contract_address.clone());
        env.storage().persistent().remove(&key);

        let meta_key = DataKey::PauseMetadata(contract_address.clone());
        env.storage().persistent().remove(&meta_key);

        events::emit_unpaused(&env, &contract_address, &caller);
    }

    /// Pause a specific function inside a contract
    pub fn pause_function(
        env: Env,
        caller: Address,
        contract_address: Address,
        function_name: Symbol,
        reason: Symbol,
    ) {
        caller.require_auth();

        let admin = Self::get_admin(env.clone());
        if caller != admin {
            panic!("only admin/governance can pause functions");
        }

        let key = DataKey::FunctionPaused(contract_address.clone(), function_name.clone());
        env.storage().persistent().set(&key, &true);

        events::emit_function_paused(&env, &contract_address, &function_name, &caller, &reason);
    }

    /// Unpause a specific function
    pub fn unpause_function(
        env: Env,
        caller: Address,
        contract_address: Address,
        function_name: Symbol,
    ) {
        caller.require_auth();

        let admin = Self::get_admin(env.clone());
        if caller != admin {
            panic!("only admin/governance can unpause functions");
        }

        let key = DataKey::FunctionPaused(contract_address.clone(), function_name.clone());
        env.storage().persistent().remove(&key);

        events::emit_function_unpaused(&env, &contract_address, &function_name, &caller);
    }

    /// Check if a contract or a specific function of a contract is paused
    pub fn is_paused(env: Env, contract_address: Address, function_name: Option<Symbol>) -> bool {
        // First check contract-wide pause
        let key = DataKey::Paused(contract_address.clone());
        if env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&key)
            .unwrap_or(false)
        {
            return true;
        }

        // If function name is specified, check function-specific pause
        if let Some(func) = function_name {
            let func_key = DataKey::FunctionPaused(contract_address, func);
            return env
                .storage()
                .persistent()
                .get::<DataKey, bool>(&func_key)
                .unwrap_or(false);
        }

        false
    }

    /// Batch check if multiple contracts/functions are paused (for Gas Optimization)
    pub fn batch_is_paused(
        env: Env,
        contracts: Vec<Address>,
        function_names: Vec<Option<Symbol>>,
    ) -> Vec<bool> {
        if contracts.len() != function_names.len() {
            panic!("contracts and function_names arrays must have same length");
        }
        let mut results = Vec::new(&env);
        for i in 0..contracts.len() {
            let contract_address = contracts.get(i).unwrap();
            let function_name = function_names.get(i).unwrap();
            results.push_back(Self::is_paused(
                env.clone(),
                contract_address,
                function_name,
            ));
        }
        results
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    /// Get pause metadata for a contract
    pub fn get_pause_metadata(env: Env, contract_address: Address) -> Option<PauseMetadata> {
        let key = DataKey::PauseMetadata(contract_address);
        env.storage().persistent().get(&key)
    }
}

#[cfg(test)]
mod test;
