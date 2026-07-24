#![no_std]

use soroban_sdk::{contracttype, Address, Env, IntoVal, Map, Val, Vec, U256};

// ---------------------------------------------------------------------------
// Storage Helpers
// ---------------------------------------------------------------------------

pub mod storage {
    use soroban_sdk::{Address, Env, Map};

    /// Helper for TTL management on persistent keys
    pub fn extend_persistent_ttl(env: &Env, key: &impl soroban_sdk::IntoVal<Env, Val>, min_ttl: u32, extend_to: u32) {
        env.storage().persistent().extend_ttl(key, min_ttl, extend_to);
    }

    /// Helper for instance TTL management
    pub fn extend_instance_ttl(env: &Env, min_ttl: u32, extend_to: u32) {
        env.storage().instance().extend_ttl(min_ttl, extend_to);
    }

    /// Batch storage write helper - writes multiple key-value pairs
    pub fn batch_write(env: &Env, entries: &Map<Val, Val>) {
        for (key, value) in entries.iter() {
            env.storage().instance().set(&key, &value);
        }
    }

    /// Batch storage read helper - reads multiple keys
    pub fn batch_read(env: &Env, keys: &Vec<Val>) -> Map<Val, Val> {
        let mut result = Map::new(env);
        for key in keys.iter() {
            if let Some(value) = env.storage().instance().get(&key) {
                result.set(key, value);
            }
        }
        result
    }

    /// Check if storage has a key
    pub fn has(env: &Env, key: &impl soroban_sdk::IntoVal<Env, Val>) -> bool {
        env.storage().instance().has(key)
    }

    /// Delete a storage key
    pub fn delete(env: &Env, key: &impl soroban_sdk::IntoVal<Env, Val>) {
        env.storage().instance().remove(key);
    }
}

// ---------------------------------------------------------------------------
// Time Helpers
// ---------------------------------------------------------------------------

pub mod time {
    use soroban_sdk::Env;

    /// Get current timestamp (seconds since epoch)
    pub fn now(env: &Env) -> u64 {
        env.ledger().timestamp()
    }

    /// Check if a timestamp is in the past
    pub fn is_past(env: &Env, timestamp: u64) -> bool {
        now(env) > timestamp
    }

    /// Check if a timestamp is in the future
    pub fn is_future(env: &Env, timestamp: u64) -> bool {
        now(env) < timestamp
    }

    /// Calculate time difference in seconds
    pub fn diff(env: &Env, timestamp: u64) -> u64 {
        now(env).saturating_sub(timestamp)
    }

    /// Add seconds to a timestamp
    pub fn add_seconds(timestamp: u64, seconds: u64) -> u64 {
        timestamp.saturating_add(seconds)
    }

    /// Check if timestamp is within a time window
    pub fn is_within_window(env: &Env, timestamp: u64, window_start: u64, window_end: u64) -> bool {
        let current = now(env);
        current >= window_start && current <= window_end
    }
}

// ---------------------------------------------------------------------------
// Address Helpers
// ---------------------------------------------------------------------------

pub mod address {
    use soroban_sdk::{Address, Env};

    /// Check if address is valid (always true in test)
    pub fn is_valid(_env: &Env, _addr: &Address) -> bool {
        true
    }

    /// Compare two addresses for equality
    pub fn equal(a: &Address, b: &Address) -> bool {
        a == b
    }

    /// Check if address is zero address (not applicable in Soroban, but kept for compatibility)
    pub fn is_zero(_addr: &Address) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// Math Helpers
// ---------------------------------------------------------------------------

pub mod math {
    use soroban_sdk::U256;

    /// Safe addition with overflow check
    pub fn safe_add(a: u64, b: u64) -> Option<u64> {
        a.checked_add(b)
    }

    /// Safe subtraction with underflow check
    pub fn safe_sub(a: u64, b: u64) -> Option<u64> {
        a.checked_sub(b)
    }

    /// Safe multiplication with overflow check
    pub fn safe_mul(a: u64, b: u64) -> Option<u64> {
        a.checked_mul(b)
    }

    /// Safe division with division by zero check
    pub fn safe_div(a: u64, b: u64) -> Option<u64> {
        if b == 0 {
            None
        } else {
            Some(a / b)
        }
    }

    /// Calculate percentage
    pub fn percentage(value: u64, percent: u64) -> u64 {
        (value * percent) / 100
    }

    /// Minimum of two values
    pub fn min(a: u64, b: u64) -> u64 {
        if a < b { a } else { b }
    }

    /// Maximum of two values
    pub fn max(a: u64, b: u64) -> u64 {
        if a > b { a } else { b }
    }

    /// Clamp value between min and max
    pub fn clamp(value: u64, min_val: u64, max_val: u64) -> u64 {
        max(min(value, max_val), min_val)
    }

    /// U256 operations for large numbers
    pub fn u256_from_u64(val: u64) -> U256 {
        U256::from_u64(val)
    }

    pub fn u256_to_u64(val: &U256) -> Option<u64> {
        val.to_u64()
    }
}

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

pub mod validation {
    use soroban_sdk::{Address, Env};

    /// Validate that a value is within a range
    pub fn in_range(value: u64, min: u64, max: u64) -> bool {
        value >= min && value <= max
    }

    /// Validate that a value is not zero
    pub fn non_zero(value: u64) -> bool {
        value != 0
    }

    /// Validate that a vector is not empty
    pub fn non_empty<T>(vec: &soroban_sdk::Vec<T>) -> bool {
        !vec.is_empty()
    }

    /// Validate address (placeholder for actual validation logic)
    pub fn validate_address(_env: &Env, addr: &Address) -> bool {
        address::is_valid(_env, addr)
    }

    /// Validate that two vectors have the same length
    pub fn same_length<T, U>(a: &soroban_sdk::Vec<T>, b: &soroban_sdk::Vec<U>) -> bool {
        a.len() == b.len()
    }
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

pub mod errors {
    use soroban_sdk::contracterror;

    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
    #[repr(u32)]
    pub enum CommonError {
        ContractNotInitialized = 1,
        AlreadyInitialized = 2,
        InvalidAddress = 3,
        NotAuthorized = 4,
        InvalidState = 5,
        InvalidArgument = 6,
        Overflow = 7,
        Underflow = 8,
        DivisionByZero = 9,
        NotFound = 10,
        Expired = 11,
        LockError = 12,
    }
}

// ---------------------------------------------------------------------------
// Contract Lifecycle Helpers
// ---------------------------------------------------------------------------

pub mod lifecycle {
    use soroban_sdk::{contracttype, Address, Env};

    #[contracttype]
    #[derive(Clone)]
    pub enum LifecycleKey {
        Initialized,
        Paused,
        Owner,
    }

    /// Check if contract is initialized
    pub fn is_initialized(env: &Env) -> bool {
        env.storage().instance().has(&LifecycleKey::Initialized)
    }

    /// Mark contract as initialized
    pub fn set_initialized(env: &Env) {
        env.storage().instance().set(&LifecycleKey::Initialized, &true);
    }

    /// Check if contract is paused
    pub fn is_paused(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&LifecycleKey::Paused)
            .unwrap_or(false)
    }

    /// Pause contract
    pub fn pause(env: &Env) {
        env.storage().instance().set(&LifecycleKey::Paused, &true);
    }

    /// Unpause contract
    pub fn unpause(env: &Env) {
        env.storage().instance().set(&LifecycleKey::Paused, &false);
    }

    /// Get contract owner
    pub fn get_owner(env: &Env) -> Option<Address> {
        env.storage().instance().get(&LifecycleKey::Owner)
    }

    /// Set contract owner
    pub fn set_owner(env: &Env, owner: &Address) {
        env.storage().instance().set(&LifecycleKey::Owner, owner);
    }
}

// ---------------------------------------------------------------------------
// Event Helpers
// ---------------------------------------------------------------------------

pub mod events {
    use soroban_sdk::{Env, Vec};

    /// Emit a custom event
    pub fn emit(env: &Env, topics: Vec< soroban_sdk::Val>, data: Vec< soroban_sdk::Val>) {
        env.events().publish(topics, data);
    }

    /// Emit a simple string event
    pub fn emit_string(env: &Env, topic: &str, message: &str) {
        let topics = soroban_sdk::vec![env, soroban_sdk::Val::from_static_str(topic)];
        let data = soroban_sdk::vec![env, soroban_sdk::Val::from_static_str(message)];
        env.events().publish(topics, data);
    }
}

// ---------------------------------------------------------------------------
// Authorization Helpers
// ---------------------------------------------------------------------------

pub mod auth {
    use soroban_sdk::{Address, Env};

    /// Require admin authorization
    pub fn require_admin(env: &Env, admin: &Address) {
        admin.require_auth();
    }

    /// Require caller authorization
    pub fn require_caller(env: &Env, caller: &Address) {
        caller.require_auth();
    }

    /// Check if caller is admin
    pub fn is_admin(env: &Env, caller: &Address, admin: &Address) -> bool {
        caller == admin
    }
}
