#![no_std]

//! ArenaX Contract Standards
//!
//! Shared interface traits, error codes, and interoperability primitives used
//! across the ArenaX Soroban contract ecosystem. Contracts that implement
//! these traits can be discovered and safely composed by other contracts or
//! off-chain indexers without bespoke integration code for every pair.
//!
//! This crate intentionally stays dependency-free (only `soroban-sdk`) so it
//! can be imported by every contract in the workspace without creating
//! circular or heavyweight dependency chains. For actual cross-contract
//! *invocation* helpers see the `cross-contract-utils` crate; this crate only
//! defines the shared vocabulary (traits, error codes, ids) that make those
//! invocations interoperable.

use soroban_sdk::{contracterror, contracttype, Address, BytesN, Env, String, Val, Vec};

// ---------------------------------------------------------------------------
// Standard Error Codes
// ---------------------------------------------------------------------------

/// Shared numeric error namespace. Individual contracts are free to define
/// their own richer `#[contracterror]` enums, but should map any
/// cross-contract-visible failure onto one of these codes so callers can
/// branch on failure *class* without understanding the callee's internal
/// error type.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum StandardError {
    Unauthorized = 1,
    NotInitialized = 2,
    AlreadyInitialized = 3,
    Paused = 4,
    InvalidAmount = 5,
    InsufficientBalance = 6,
    NotFound = 7,
    Expired = 8,
    Overflow = 9,
    InvalidInput = 10,
    Unsupported = 11,
}

// ---------------------------------------------------------------------------
// Standardized Contract Interface Traits
// ---------------------------------------------------------------------------

/// Trait for contracts that support pausing/resuming operations.
pub trait Pausable {
    /// Check if contract is paused
    fn is_paused(env: &Env) -> bool;

    /// Set pause state
    fn set_paused(env: &Env, paused: bool);
}

/// Trait for contracts that have an admin role.
pub trait Ownable {
    /// Get current owner
    fn owner(env: &Env) -> Address;

    /// Transfer ownership to new owner
    fn transfer_ownership(env: &Env, new_owner: Address);
}

/// Trait for contracts that support upgradeable code.
pub trait Upgradable {
    /// Get current implementation contract address
    fn implementation(env: &Env) -> Address;

    /// Upgrade to new implementation
    fn upgrade(env: &Env, new_impl: Address);
}

/// Trait for contracts that support role-based access control.
pub trait RoleBasedAccess {
    /// Check if an account has a specific role
    fn has_role(env: &Env, account: Address, role: u32) -> bool;

    /// Grant a role to an account
    fn grant_role(env: &Env, account: Address, role: u32);

    /// Revoke a role from an account
    fn revoke_role(env: &Env, account: Address, role: u32);
}

/// Trait for contracts that support time locking of privileged calls.
pub trait TimeLockable {
    /// Schedule a function call for later execution
    fn schedule(env: &Env, id: BytesN<32>, function: String, args: Vec<Val>, delay: u64);

    /// Execute a scheduled function call once delay has passed
    fn execute(env: &Env, id: BytesN<32>);

    /// Cancel a scheduled function call
    fn cancel(env: &Env, id: BytesN<32>);
}

/// Trait for contracts that support emergency stops.
pub trait EmergencyStoppable {
    /// Trigger emergency stop
    fn emergency_stop(env: &Env);

    /// Resume operations after emergency stop
    fn resume(env: &Env);

    /// Check if emergency mode is active
    fn is_emergency(env: &Env) -> bool;
}

// ---------------------------------------------------------------------------
// Interface Introspection (interoperability discovery)
// ---------------------------------------------------------------------------

/// Stable numeric ids for each standard trait defined in this crate. Callers
/// can probe [`SupportsInterface::supports_interface`] before attempting a
/// cross-contract call, instead of relying on the call panicking when the
/// callee doesn't implement the expected function.
pub mod interface_id {
    pub const PAUSABLE: u32 = 1;
    pub const OWNABLE: u32 = 2;
    pub const UPGRADABLE: u32 = 3;
    pub const ROLE_BASED_ACCESS: u32 = 4;
    pub const TIME_LOCKABLE: u32 = 5;
    pub const EMERGENCY_STOPPABLE: u32 = 6;
    pub const TOKEN: u32 = 7;
    pub const TOKEN_REGISTRY: u32 = 8;
}

/// Trait for contracts that expose which standard interfaces they implement.
/// Analogous to ERC-165 in the EVM world.
pub trait SupportsInterface {
    fn supports_interface(env: &Env, interface_id: u32) -> bool;
}

/// Well-known contract "kinds" used for discovery/registry purposes (e.g. by
/// `contract-registry`). `Other` is the escape hatch for anything not yet
/// classified.
pub mod contract_type {
    pub const TOKEN: u32 = 1;
    pub const STAKING: u32 = 2;
    pub const MARKETPLACE: u32 = 3;
    pub const GOVERNANCE: u32 = 4;
    pub const TOURNAMENT: u32 = 5;
    pub const ANTI_CHEAT: u32 = 6;
    pub const AUTH: u32 = 7;
    pub const REGISTRY: u32 = 8;
    pub const ESCROW: u32 = 9;
    pub const ORACLE: u32 = 10;
    pub const OTHER: u32 = 0;
}

/// Semantic version for a contract's deployed logic. Lets other contracts or
/// off-chain tooling reason about compatibility before wiring up an
/// integration (e.g. refuse to call a contract whose major version changed).
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct ContractVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl ContractVersion {
    pub const fn new(major: u32, minor: u32, patch: u32) -> Self {
        Self {
            major,
            minor,
            patch,
        }
    }

    /// Two versions are compatible for interoperability purposes if they
    /// share the same major version (standard semver rule).
    pub fn is_compatible_with(&self, other: &ContractVersion) -> bool {
        self.major == other.major
    }
}

/// Trait for contracts that expose a semantic version.
pub trait Versioned {
    fn version(env: &Env) -> ContractVersion;
}

/// Self-describing metadata a contract can expose for discovery/indexing.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractInfo {
    pub name: String,
    pub contract_type: u32,
    pub version: ContractVersion,
}

/// Trait for contracts that expose [`ContractInfo`] describing themselves.
pub trait Introspectable {
    fn contract_info(env: &Env) -> ContractInfo;
}

// ---------------------------------------------------------------------------
// Standardized Storage Keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StandardDataKey {
    Paused,
    Owner,
    Implementation,
    Role(Address, u32),
    EmergencyActive,
    Version,
}

// ---------------------------------------------------------------------------
// Helper Macros
// ---------------------------------------------------------------------------

/// Macro to implement the basic [`Ownable`] trait for a contract.
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

/// Macro to implement the basic [`Pausable`] trait for a contract. Requires
/// the contract to also implement [`Ownable`] (used to gate `set_paused`).
#[macro_export]
macro_rules! impl_pausable {
    ($key:expr) => {
        fn is_paused(env: &Env) -> bool {
            env.storage().instance().get(&$key).unwrap_or(false)
        }

        fn set_paused(env: &Env, paused: bool) {
            let owner = Self::owner(env);
            owner.require_auth();
            env.storage().instance().set(&$key, &paused);
        }
    };
}

/// Macro to implement the basic [`EmergencyStoppable`] trait for a contract.
/// Requires the contract to also implement [`Ownable`].
#[macro_export]
macro_rules! impl_emergency_stoppable {
    ($key:expr) => {
        fn emergency_stop(env: &Env) {
            let owner = Self::owner(env);
            owner.require_auth();
            env.storage().instance().set(&$key, &true);
        }

        fn resume(env: &Env) {
            let owner = Self::owner(env);
            owner.require_auth();
            env.storage().instance().set(&$key, &false);
        }

        fn is_emergency(env: &Env) -> bool {
            env.storage().instance().get(&$key).unwrap_or(false)
        }
    };
}

// ---------------------------------------------------------------------------
// Token Standard Interface
// ---------------------------------------------------------------------------

/// Token metadata structure shared by every fungible-token-like contract in
/// the workspace (AX token, in-economy currencies, wrapped assets, ...).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenMetadata {
    pub name: String,
    pub symbol: String,
    pub decimals: u32,
}

/// Standard fungible token interface (Soroban/SEP-41 compatible shape).
pub trait Token {
    fn name(env: &Env) -> String;
    fn symbol(env: &Env) -> String;
    fn decimals(env: &Env) -> u32;
    fn total_supply(env: &Env) -> i128;
    fn balance(env: &Env, id: Address) -> i128;
    fn transfer(env: &Env, from: Address, to: Address, amount: i128);
    fn transfer_from(env: &Env, spender: Address, from: Address, to: Address, amount: i128);
    fn approve(env: &Env, from: Address, spender: Address, amount: i128);
    fn allowance(env: &Env, from: Address, spender: Address) -> i128;
}

/// Multi-token registry interface: lets a single contract track metadata for
/// several token contracts it interoperates with (e.g. a marketplace that
/// accepts several payment tokens).
pub trait TokenRegistry {
    fn register_token(env: &Env, token_address: Address, metadata: TokenMetadata);
    fn get_token_metadata(env: &Env, token_address: Address) -> TokenMetadata;
    fn list_tokens(env: &Env) -> Vec<Address>;
}
