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
//! * [`CallbackConfig`] — configuration for callback handlers.
//! * [`TokenInterface`], [`AntiCheatInterface`] — standard reusable contract interfaces.
//! * Governance and whitelisting features for target addresses.
//! * Metrics collection for monitoring and analytics of cross-contract calls.
//!
//! ## Usage
//!
//! ```no_run
//! use cross_contract_utils::{CrossContractCaller, CallConfig};
//! use soroban_sdk::{Env, Address, Symbol, Val, Vec, IntoVal};
//!
//! fn call_get_score(env: &Env, contract: &Address, player: &Address) -> i64 {
//!     let mut args = Vec::new(env);
//!     args.push_back(player.into_val(env));
//!     CrossContractCaller::call(env, contract, Symbol::new(env, "get_score"), args, &CallConfig::default())
//! }
//! ```

#![no_std]

use soroban_sdk::{contracterror, contracttype, Address, Env, IntoVal, Symbol, Val, Vec, Error};

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
    /// The contract or function is not whitelisted in governance.
    GovernanceBlocked = 5,
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

/// Callback configuration.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CallbackConfig {
    pub callback_contract: Address,
    pub callback_function: Symbol,
}

// ---------------------------------------------------------------------------
// Governance and Whitelists
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GovernanceKey {
    AllowedContract(Address),
    AllowedFunction(Address, Symbol),
}

/// Check if a contract call is allowed under the current governance whitelist.
/// Default: If no restriction has been set, it returns true.
pub fn is_call_allowed(env: &Env, target: &Address, function: &Symbol) -> bool {
    let contract_key = GovernanceKey::AllowedContract(target.clone());
    let function_key = GovernanceKey::AllowedFunction(target.clone(), function.clone());

    let contract_allowed = env.storage().instance().get(&contract_key).unwrap_or(true);
    let function_allowed = env.storage().instance().get(&function_key).unwrap_or(true);

    contract_allowed && function_allowed
}

/// Set whether a target contract address is allowed to be called.
pub fn set_contract_allowed(env: &Env, target: &Address, allowed: bool) {
    env.storage().instance().set(&GovernanceKey::AllowedContract(target.clone()), &allowed);
}

/// Set whether a specific function on a target contract is allowed to be called.
pub fn set_function_allowed(env: &Env, target: &Address, function: &Symbol, allowed: bool) {
    env.storage().instance().set(&GovernanceKey::AllowedFunction(target.clone(), function.clone()), &allowed);
}

// ---------------------------------------------------------------------------
// Monitoring & Analytics
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CallAnalyticsKey {
    TotalCalls,
    FailedCalls,
    CallCount(Address, Symbol),
}

/// Structured monitoring event emitted for cross-contract calls.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CrossContractCallEvent {
    pub target: Address,
    pub function: Symbol,
    pub success: bool,
    pub timestamp: u64,
}

/// Record call telemetry to persistent/instance storage and emit monitoring events.
pub fn record_and_emit_telemetry(env: &Env, target: &Address, function: &Symbol, success: bool) {
    // Analytics: update call counts
    let total_key = CallAnalyticsKey::TotalCalls;
    let current_total: u64 = env.storage().instance().get(&total_key).unwrap_or(0);
    env.storage().instance().set(&total_key, &(current_total + 1));

    if !success {
        let failed_key = CallAnalyticsKey::FailedCalls;
        let current_failed: u64 = env.storage().instance().get(&failed_key).unwrap_or(0);
        env.storage().instance().set(&failed_key, &(current_failed + 1));
    }

    let count_key = CallAnalyticsKey::CallCount(target.clone(), function.clone());
    let current_count: u64 = env.storage().instance().get(&count_key).unwrap_or(0);
    env.storage().instance().set(&count_key, &(current_count + 1));

    // Monitoring: publish event
    let event = CrossContractCallEvent {
        target: target.clone(),
        function: function.clone(),
        success,
        timestamp: env.ledger().timestamp(),
    };
    env.events().publish(
        (Symbol::new(env, "cross_contract"), Symbol::new(env, "call_metric")),
        event,
    );
}

/// Query analytics: get total calls
pub fn get_total_calls(env: &Env) -> u64 {
    env.storage().instance().get(&CallAnalyticsKey::TotalCalls).unwrap_or(0)
}

/// Query analytics: get failed calls
pub fn get_failed_calls(env: &Env) -> u64 {
    env.storage().instance().get(&CallAnalyticsKey::FailedCalls).unwrap_or(0)
}

/// Query analytics: get call count for specific target and function
pub fn get_call_count(env: &Env, target: &Address, function: &Symbol) -> u64 {
    env.storage().instance().get(&CallAnalyticsKey::CallCount(target.clone(), function.clone())).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Caller
// ---------------------------------------------------------------------------

/// Stateless cross-contract call helper.
pub struct CrossContractCaller;

impl CrossContractCaller {
    /// Invoke a function on a remote contract and return its result.
    ///
    /// Panics with a descriptive message if the call fails.
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
        // Governance check
        if !is_call_allowed(env, contract, &function) {
            record_and_emit_telemetry(env, contract, &function, false);
            panic!("cross-contract call blocked by governance");
        }

        if config.require_auth {
            contract.require_auth();
        }

        let result: Result<Result<T, T::Error>, Result<Error, soroban_sdk::InvokeError>> =
            env.try_invoke_contract(contract, &function, args);

        match result {
            Ok(Ok(val)) => {
                record_and_emit_telemetry(env, contract, &function, true);
                if config.ttl_extend_ledgers > 0 {
                    env.storage()
                        .instance()
                        .extend_ttl(config.ttl_extend_ledgers, config.ttl_extend_ledgers);
                }
                val
            }
            Err(err) => {
                record_and_emit_telemetry(env, contract, &function, false);
                panic!("remote contract call failed with execution error: {:?}", err);
            }
            Ok(Err(_)) => {
                record_and_emit_telemetry(env, contract, &function, false);
                panic!("remote contract call failed to decode result type");
            }
        }
    }

    /// Invoke a function and return `()`. Convenience wrapper for void calls.
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

    /// Safe, fallible invocation using try_invoke_contract.
    /// Does not panic; returns CallResult<T>.
    pub fn try_call<T>(
        env: &Env,
        contract: &Address,
        function: Symbol,
        args: Vec<Val>,
        config: &CallConfig,
    ) -> CallResult<T>
    where
        T: soroban_sdk::TryFromVal<Env, Val>,
    {
        // Governance check
        if !is_call_allowed(env, contract, &function) {
            record_and_emit_telemetry(env, contract, &function, false);
            return Err(CallError::GovernanceBlocked);
        }

        if config.require_auth {
            contract.require_auth();
        }

        let result: Result<Result<T, T::Error>, Result<Error, soroban_sdk::InvokeError>> =
            env.try_invoke_contract(contract, &function, args);

        match result {
            Ok(Ok(val)) => {
                record_and_emit_telemetry(env, contract, &function, true);
                if config.ttl_extend_ledgers > 0 {
                    env.storage()
                        .instance()
                        .extend_ttl(config.ttl_extend_ledgers, config.ttl_extend_ledgers);
                }
                Ok(val)
            }
            _ => {
                record_and_emit_telemetry(env, contract, &function, false);
                Err(CallError::RemoteError)
            }
        }
    }

    /// Invokes a function, falling back to a backup contract if the primary fails.
    pub fn call_with_fallback<T>(
        env: &Env,
        primary: &Address,
        backup: &Address,
        function: Symbol,
        args: Vec<Val>,
        config: &CallConfig,
    ) -> CallResult<T>
    where
        T: soroban_sdk::TryFromVal<Env, Val>,
    {
        match Self::try_call::<T>(env, primary, function.clone(), args.clone(), config) {
            Ok(val) => Ok(val),
            Err(_) => Self::try_call::<T>(env, backup, function, args, config),
        }
    }

    /// Execute a call, and upon success, trigger a callback on a registered listener contract.
    pub fn call_with_callback<T>(
        env: &Env,
        contract: &Address,
        function: Symbol,
        args: Vec<Val>,
        config: &CallConfig,
        callback: &CallbackConfig,
    ) -> T
    where
        T: soroban_sdk::TryFromVal<Env, Val> + IntoVal<Env, Val> + Clone,
    {
        let res: T = Self::call(env, contract, function, args, config);

        // Trigger callback
        let mut cb_args = Vec::new(env);
        cb_args.push_back(res.clone().into_val(env));
        Self::call_void(
            env,
            &callback.callback_contract,
            callback.callback_function.clone(),
            cb_args,
            config,
        );

        res
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
// Contract Interfaces
// ---------------------------------------------------------------------------

/// Reusable interface for token contracts (e.g. ax-token).
pub trait TokenInterface {
    fn initialize(env: &Env, admin: Address);
    fn mint(env: &Env, to: Address, amount: i128);
    fn burn(env: &Env, from: Address, amount: i128);
    fn transfer(env: &Env, from: Address, to: Address, amount: i128);
    fn balance(env: &Env, addr: Address) -> i128;
    fn total_supply(env: &Env) -> i128;
}

/// Reusable interface for anti-cheat contracts.
pub trait AntiCheatInterface {
    fn initialize(env: &Env, admin: Address, reputation_contract: Address);
    fn validate_game_action(
        env: &Env,
        player: Address,
        action: soroban_sdk::Bytes,
        game_state: soroban_sdk::Bytes,
    ) -> bool;
    fn calculate_cheat_probability(
        env: &Env,
        player: Address,
        behavior_data: soroban_sdk::Bytes,
    ) -> u32;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contract, contractimpl, testutils::Address as _, Env};

    #[contract]
    pub struct MockTarget;

    #[contractimpl]
    impl MockTarget {
        pub fn add(_env: Env, x: i32, y: i32) -> i32 {
            x + y
        }

        pub fn fail(_env: Env) -> i32 {
            panic!("explicit panic");
        }
    }

    #[contract]
    pub struct MockCallback;

    #[contractimpl]
    impl MockCallback {
        pub fn on_success(env: Env, val: i32) {
            env.storage().instance().set(&Symbol::new(&env, "cb_val"), &val);
        }
    }

    #[contract]
    pub struct MockCaller;

    #[contractimpl]
    impl MockCaller {
        pub fn do_add(env: Env, target: Address, x: i32, y: i32) -> i32 {
            CrossContractCaller::call(
                &env,
                &target,
                Symbol::new(&env, "add"),
                args2(&env, x, y),
                &CallConfig::default(),
            )
        }

        pub fn do_try_fail(env: Env, target: Address) -> bool {
            let res: CallResult<i32> = CrossContractCaller::try_call(
                &env,
                &target,
                Symbol::new(&env, "fail"),
                no_args(&env),
                &CallConfig::default(),
            );
            res.is_err()
        }

        pub fn do_fallback(env: Env, primary: Address, backup: Address) -> bool {
            let res: CallResult<i32> = CrossContractCaller::call_with_fallback(
                &env,
                &primary,
                &backup,
                Symbol::new(&env, "fail"),
                no_args(&env),
                &CallConfig::default(),
            );
            res.is_err()
        }

        pub fn do_callback(env: Env, target: Address, cb: Address) -> i32 {
            let callback = CallbackConfig {
                callback_contract: cb,
                callback_function: Symbol::new(&env, "on_success"),
            };

            CrossContractCaller::call_with_callback(
                &env,
                &target,
                Symbol::new(&env, "add"),
                args2(&env, 10, 20),
                &CallConfig::default(),
                &callback,
            )
        }
    }

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

    #[test]
    fn test_successful_call() {
        let env = Env::default();
        let target_id = env.register(MockTarget, ());
        let caller_id = env.register(MockCaller, ());
        let caller_client = MockCallerClient::new(&env, &caller_id);

        let res = caller_client.do_add(&target_id, &5, &10);
        assert_eq!(res, 15);

        env.as_contract(&caller_id, || {
            assert_eq!(get_total_calls(&env), 1);
            assert_eq!(get_failed_calls(&env), 0);
        });
    }

    #[test]
    fn test_try_call_failure() {
        let env = Env::default();
        let target_id = env.register(MockTarget, ());
        let caller_id = env.register(MockCaller, ());
        let caller_client = MockCallerClient::new(&env, &caller_id);

        let res = caller_client.do_try_fail(&target_id);
        assert!(res);

        env.as_contract(&caller_id, || {
            assert_eq!(get_total_calls(&env), 1);
            assert_eq!(get_failed_calls(&env), 1);
        });
    }

    #[test]
    fn test_fallback_flow() {
        let env = Env::default();
        let primary_id = env.register(MockTarget, ());
        let backup_id = env.register(MockTarget, ());
        let caller_id = env.register(MockCaller, ());
        let caller_client = MockCallerClient::new(&env, &caller_id);

        let res = caller_client.do_fallback(&primary_id, &backup_id);
        assert!(res);
    }

    #[test]
    fn test_governance_block() {
        let env = Env::default();
        let target_id = env.register(MockTarget, ());
        let caller_id = env.register(MockCaller, ());
        let caller_client = MockCallerClient::new(&env, &caller_id);

        // Governance block
        env.as_contract(&caller_id, || {
            set_contract_allowed(&env, &target_id, false);
        });

        // Calling do_add should panic because the caller contract has blocked target_id in governance
        let res = env.as_contract(&caller_id, || {
            CrossContractCaller::try_call::<i32>(
                &env,
                &target_id,
                Symbol::new(&env, "add"),
                args2(&env, 1, 2),
                &CallConfig::default(),
            )
        });

        assert_eq!(res, Err(CallError::GovernanceBlocked));
    }

    #[test]
    fn test_callback_flow() {
        let env = Env::default();
        let target_id = env.register(MockTarget, ());
        let cb_id = env.register(MockCallback, ());
        let caller_id = env.register(MockCaller, ());
        let caller_client = MockCallerClient::new(&env, &caller_id);

        let res = caller_client.do_callback(&target_id, &cb_id);
        assert_eq!(res, 30);

        env.as_contract(&cb_id, || {
            let cb_val: i32 = env.storage().instance().get(&Symbol::new(&env, "cb_val")).unwrap();
            assert_eq!(cb_val, 30);
        });
    }
}
