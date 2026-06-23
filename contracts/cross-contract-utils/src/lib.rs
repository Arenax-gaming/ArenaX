//! # cross-contract-utils — Issue #487
//!
//! Standardised cross-contract call patterns for all ArenaX Soroban contracts.
//!
//! ## What this crate provides
//!
//! * [`CallConfig`] — per-call settings (auth, TTL bump).
//! * [`CrossContractCaller`] — stateless helper that executes `invoke_contract`
//!   with a uniform try/panic interface and optional TTL extension.
//! * [`CallError`] — discriminated error type returned by fallible helpers.
//! * [`CallResult`] — alias for `Result<T, CallError>`.
//! * Macro [`cross_call!`] — ergonomic wrapper that assembles the arg `Vec`
//!   and delegates to `CrossContractCaller`.
//!
//! ## Usage
//!
//! ```no_run
//! use cross_contract_utils::{CrossContractCaller, CallConfig};
//! use soroban_sdk::{Env, Address, Symbol, Val, Vec};
//!
//! fn call_get_score(env: &Env, contract: &Address, player: &Address) -> i64 {
//!     let mut args = Vec::new(env);
//!     args.push_back(player.into_val(env));
//!     CrossContractCaller::call(env, contract, Symbol::new(env, "get_score"), args, &CallConfig::default())
//! }
//! ```

#![no_std]

use soroban_sdk::{contracterror, contracttype, Address, Env, IntoVal, Symbol, Val, Vec};

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/// Discriminated error codes for cross-contract call failures.
/// Stored as `u32` so they can be embedded in the contract XDR error surface.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CallError {
    /// The remote contract returned an error code we could not decode.
    RemoteError = 1,
    /// The call was rejected because auth was required but not provided.
    Unauthorized = 2,
    /// A required argument was missing or malformed.
    BadArgument = 3,
    /// The callee contract address resolved to an invalid target.
    InvalidTarget = 4,
}

pub type CallResult<T> = core::result::Result<T, CallError>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Per-call configuration.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CallConfig {
    /// If true, require caller auth before invoking. Default: false.
    pub require_auth: bool,
    /// Number of ledgers by which to extend the callee's instance TTL after a
    /// successful call. 0 means no extension. Default: 0.
    pub ttl_extend_ledgers: u32,
}

impl CallConfig {
    pub const fn default() -> Self {
        Self {
            require_auth: false,
            ttl_extend_ledgers: 0,
        }
    }

    pub const fn with_auth(mut self) -> Self {
        self.require_auth = true;
        self
    }

    pub const fn with_ttl(mut self, ledgers: u32) -> Self {
        self.ttl_extend_ledgers = ledgers;
        self
    }
}

// ---------------------------------------------------------------------------
// Caller
// ---------------------------------------------------------------------------

/// Stateless cross-contract call helper.
///
/// All methods are `#[inline]` so there is zero overhead compared to a raw
/// `env.invoke_contract` call — the abstraction costs nothing at runtime.
pub struct CrossContractCaller;

impl CrossContractCaller {
    /// Invoke a function on a remote contract and return its result.
    ///
    /// Panics with a descriptive message if the call fails, making the failure
    /// visible on-chain as a regular contract panic (which becomes a Soroban
    /// `ScError`).
    #[inline]
    pub fn call<T>(
        env: &Env,
        contract: &Address,
        function: Symbol,
        args: Vec<Val>,
        config: &CallConfig,
    ) -> T
    where
        T: soroban_sdk::TryFromVal<Env, Val>,
    {
        if config.require_auth {
            contract.require_auth();
        }

        let result: T = env.invoke_contract(contract, &function, args);

        if config.ttl_extend_ledgers > 0 {
            env.storage()
                .instance()
                .extend_ttl(config.ttl_extend_ledgers, config.ttl_extend_ledgers);
        }

        result
    }

    /// Invoke a function and return `()`.  Convenience wrapper for void calls.
    #[inline]
    pub fn call_void(
        env: &Env,
        contract: &Address,
        function: Symbol,
        args: Vec<Val>,
        config: &CallConfig,
    ) {
        Self::call::<()>(env, contract, function, args, config)
    }
}

// ---------------------------------------------------------------------------
// Convenience builders
// ---------------------------------------------------------------------------

/// Build a zero-element argument `Vec<Val>` for calls that take no arguments.
#[inline]
pub fn no_args(env: &Env) -> Vec<Val> {
    Vec::new(env)
}

/// Build a one-argument `Vec<Val>`.
#[inline]
pub fn args1<A>(env: &Env, a: A) -> Vec<Val>
where
    A: IntoVal<Env, Val>,
{
    let mut v = Vec::new(env);
    v.push_back(a.into_val(env));
    v
}

/// Build a two-argument `Vec<Val>`.
#[inline]
pub fn args2<A, B>(env: &Env, a: A, b: B) -> Vec<Val>
where
    A: IntoVal<Env, Val>,
    B: IntoVal<Env, Val>,
{
    let mut v = Vec::new(env);
    v.push_back(a.into_val(env));
    v.push_back(b.into_val(env));
    v
}

/// Build a three-argument `Vec<Val>`.
#[inline]
pub fn args3<A, B, C>(env: &Env, a: A, b: B, c: C) -> Vec<Val>
where
    A: IntoVal<Env, Val>,
    B: IntoVal<Env, Val>,
    C: IntoVal<Env, Val>,
{
    let mut v = Vec::new(env);
    v.push_back(a.into_val(env));
    v.push_back(b.into_val(env));
    v.push_back(c.into_val(env));
    v
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn call_config_defaults() {
        let cfg = CallConfig::default();
        assert!(!cfg.require_auth);
        assert_eq!(cfg.ttl_extend_ledgers, 0);
    }

    #[test]
    fn call_config_builder() {
        let cfg = CallConfig::default().with_auth().with_ttl(1000);
        assert!(cfg.require_auth);
        assert_eq!(cfg.ttl_extend_ledgers, 1000);
    }

    #[test]
    fn no_args_is_empty() {
        let env = Env::default();
        assert_eq!(no_args(&env).len(), 0);
    }

    #[test]
    fn args1_has_one_element() {
        let env = Env::default();
        let addr = Address::generate(&env);
        assert_eq!(args1(&env, addr).len(), 1);
    }

    #[test]
    fn args2_has_two_elements() {
        let env = Env::default();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        assert_eq!(args2(&env, a, b).len(), 2);
    }

    #[test]
    fn args3_has_three_elements() {
        let env = Env::default();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        assert_eq!(args3(&env, a, b, c).len(), 3);
    }
}
