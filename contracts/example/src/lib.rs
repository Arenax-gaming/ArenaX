<<<<<<< HEAD
#![no_std]

use soroban_sdk::{Address, Env, Symbol, contract, contractimpl};

#[contract]
pub struct ExampleContract;

#[contractimpl]
impl ExampleContract {
    /// Initialize the contract
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&Symbol::new(&env, "admin")) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&Symbol::new(&env, "admin"), &admin);
    }

    /// Get the admin address
    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&Symbol::new(&env, "admin")).unwrap()
    }

    /// Store a greeting message
    pub fn set_greeting(env: Env, user: Address, message: Symbol) {
        user.require_auth();
        env.storage().persistent().set(&user, &message);
    }

    /// Get a greeting message
    pub fn get_greeting(env: Env, user: Address) -> Symbol {
        env.storage().persistent().get(&user).unwrap_or(Symbol::new(&env, "Hello!"))
    }

    /// Add a number to the counter
    pub fn increment_counter(env: Env, user: Address, amount: u32) {
        user.require_auth();

        let key = Symbol::new(&env, "counter");
        let current: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        let new_value = current + amount;

        env.storage().persistent().set(&key, &new_value);
    }

    /// Get the current counter value
    pub fn get_counter(env: Env) -> u32 {
        let key = Symbol::new(&env, "counter");
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    /// Get contract version
    pub fn version(env: Env) -> Symbol {
        Symbol::new(&env, "1.0.0")
    }
}
