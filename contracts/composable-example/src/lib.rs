#![no_std]

use arenax_events::access_control as events;
use contract_standards::{impl_ownable, Ownable, Pausable};
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Owner,
    Paused,
    Counter,
}

#[contract]
pub struct ComposableExample;

#[contractimpl]
impl ComposableExample {
    pub fn initialize(env: Env, owner: Address) {
        if env.storage().instance().has(&DataKey::Owner) {
            panic!("already initialized");
        }
        owner.require_auth();
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::Counter, &0u32);
    }

    pub fn owner(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Owner)
            .expect("not initialized")
    }

    pub fn transfer_ownership(env: Env, new_owner: Address) {
        let owner = Self::owner(env.clone());
        owner.require_auth();
        env.storage().instance().set(&DataKey::Owner, &new_owner);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn set_paused(env: Env, paused: bool) {
        let owner = Self::owner(env.clone());
        owner.require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    fn check_not_paused(env: &Env) {
        if Self::is_paused(env.clone()) {
            panic!("contract is paused");
        }
    }

    pub fn increment(env: Env) -> u32 {
        Self::check_not_paused(&env);
        let mut counter: u32 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        counter += 1;
        env.storage().instance().set(&DataKey::Counter, &counter);
        counter
    }

    pub fn decrement(env: Env) -> u32 {
        Self::check_not_paused(&env);
        let mut counter: u32 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        if counter > 0 {
            counter -= 1;
        }
        env.storage().instance().set(&DataKey::Counter, &counter);
        counter
    }

    pub fn get_counter(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Counter).unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
