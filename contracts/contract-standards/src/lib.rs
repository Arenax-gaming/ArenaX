#![no_std]

use soroban_sdk::{contracttype, Address, Env, Map};

// ---------------------------------------------------------------------------
// Standardized Contract Interface Traits
// ---------------------------------------------------------------------------

/// Trait for contracts that support pausing/resuming operations
pub trait Pausable {
    /// Check if contract is paused
    fn is_paused(env: &Env) -> bool;
    
    /// Set pause state
    fn set_paused(env: &Env, paused: bool);
}

/// Trait for contracts that have an admin role
pub trait Ownable {
    /// Get current owner
    fn owner(env: &Env) -> Address;
    
    /// Transfer ownership to new owner
    fn transfer_ownership(env: &Env, new_owner: Address);
}

/// Trait for contracts that support upgradeable code
pub trait Upgradable {
    /// Get current implementation contract address
    fn implementation(env: &Env) -> Address;
    
    /// Upgrade to new implementation
    fn upgrade(env: &Env, new_impl: Address);
}

/// Trait for contracts that support role-based access control
pub trait RoleBasedAccess {
    /// Check if an account has a specific role
    fn has_role(env: &Env, account: Address, role: u32) -> bool;
    
    /// Grant a role to an account
    fn grant_role(env: &Env, account: Address, role: u32);
    
    /// Revoke a role from an account
    fn revoke_role(env: &Env, account: Address, role: u32);
}

/// Trait for contracts that support time locking
pub trait TimeLockable {
    /// Schedule a function call for later execution
    fn schedule(env: &Env, id: [u8; 32], function: &str, args: Vec<soroban_sdk::Val>, delay: u64);
    
    /// Execute a scheduled function call once delay has passed
    fn execute(env: &Env, id: [u8; 32]);
    
    /// Cancel a scheduled function call
    fn cancel(env: &Env, id: [u8; 32]);
}

/// Trait for contracts that support emergency stops
pub trait EmergencyStoppable {
    /// Trigger emergency stop
    fn emergency_stop(env: &Env);
    
    /// Resume operations after emergency stop
    fn resume(env: &Env);
    
    /// Check if emergency mode is active
    fn is_emergency(env: &Env) -> bool;
}

// ---------------------------------------------------------------------------
// Standardized Storage Keys and Types
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StandardDataKey {
    Paused,
    Owner,
    Implementation,
    Role(Address, u32),
    EmergencyActive,
}

// ---------------------------------------------------------------------------
// Helper Macros and Utilities
// ---------------------------------------------------------------------------

/// Macro to implement basic Ownable trait for a contract
#[macro_export]
macro_rules! impl_ownable {
    ($key:expr) => {
        fn owner(env: &Env) -> Address {
            env.storage().instance().get(&$key).unwrap()
        }

        fn transfer_ownership(env: &Env, new_owner: Address) {
            let owner = Self::owner(env);
            owner.require_auth();
            env.storage().instance().set(&$key, &new_owner);
        }
    };
}

/// Macro to implement basic Pausable trait for a contract
#[macro_export]
macro_rules! impl_pausable {
    ($key:expr) => {
        fn is_paused(env: &Env) -> bool {
            env.storage().instance().get(&$key).unwrap_or(false)
        }

        fn set_paused(env: &Env, paused: bool) {
            // Require admin/auth to pause/resume
            let owner = Self::owner(env);
            owner.require_auth();
            env.storage().instance().set(&$key, &paused);
        }
    };
}

// ---------------------------------------------------------------------------
// Token Standard Interface
// ---------------------------------------------------------------------------

/// Token metadata structure
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenMetadata {
    pub name: soroban_sdk::String,
    pub symbol: soroban_sdk::String,
    pub decimals: u8,
}

/// Standard Token Interface (Soroban compatible)
pub trait Token {
    fn name(env: &Env) -> soroban_sdk::String;
    fn symbol(env: &Env) -> soroban_sdk::String;
    fn decimals(env: &Env) -> u8;
    fn total_supply(env: &Env) -> i128;
    fn balance(env: &Env, id: Address) -> i128;
    fn transfer(env: &Env, from: Address, to: Address, amount: i128);
    fn transfer_from(env: &Env, spender: Address, from: Address, to: Address, amount: i128);
    fn approve(env: &Env, from: Address, spender: Address, amount: i128);
    fn allowance(env: &Env, from: Address, spender: Address) -> i128;
}

/// Multi-Token Registry Interface
pub trait TokenRegistry {
    fn register_token(env: &Env, token_address: Address, metadata: TokenMetadata);
    fn get_token_metadata(env: &Env, token_address: Address) -> TokenMetadata;
    fn list_tokens(env: &Env) -> Vec<Address>;
}

