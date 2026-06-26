#![no_std]

use soroban_sdk::{Env, IntoVal, Val, Vec};

// ---------------------------------------------------------------------------
// Storage Helpers
// ---------------------------------------------------------------------------

pub mod storage {
    use soroban_sdk::{contracttype, Address, Env, Map};

    /// Helper for TTL management on persistent keys
    pub fn extend_persistent_ttl(
        env: &Env,
        key: &impl soroban_sdk::IntoVal<Env, Val>,
        min_ttl: u32,
        extend_to: u32,
    ) {
        env.storage()
            .persistent()
            .extend_ttl(key, min_ttl, extend_to);
    }

    /// Helper for instance TTL management
    pub fn extend_instance_ttl(env: &Env, min_ttl: u32, extend_to: u32) {
        env.storage().instance().extend_ttl(min_ttl, extend_to);
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
        /// ContractNotInitialized = 1,
        AlreadyInitialized = 2,
        InvalidAddress = 3,
        NotAuthorized = 4,
        InvalidState = 5,
        InvalidArgument = 6,
    }
}
