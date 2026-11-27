//! Cross-contract RPC call result caching (Issue #1574).
//!
//! Contracts call external contracts repeatedly for data that rarely changes
//! (e.g. configuration values). Caching these results in contract storage
//! reduces ledger CPU consumption by skipping the cross-contract call
//! entirely while the cached result is still fresh.
//!
//! `CachedCall` stores the result of a cross-contract call keyed by a
//! short [`Symbol`] identifier, together with the ledger sequence at which
//! the entry expires (its TTL, expressed in ledgers). Reads within the TTL
//! are served from storage; reads after expiry transparently re-fetch from
//! the remote contract and re-cache the fresh result. `bust_cache` lets a
//! caller manually invalidate an entry before its TTL elapses.

use soroban_sdk::{contracttype, Address, Env, IntoVal, Symbol, TryFromVal, Val, Vec};

/// Storage key wrapper so cached entries never collide with a caller
/// contract's own persistent storage keys.
///
/// The cached value and its expiry ledger live under two separate keys
/// rather than in a single `#[contracttype]` struct: `soroban_sdk::Val` is
/// not a valid `#[contracttype]` field (the macro cannot build a
/// `TryFrom<&Val>`-based conversion for it), but it is a perfectly valid
/// storage *value* (`Val: IntoVal<Env, Val>`), so splitting the record keeps
/// both the value and the TTL in persistent storage without a lossy
/// re-encoding.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum CacheStorageKey {
    Value(Symbol),
    Expiry(Symbol),
}

/// Helper for caching the result of a cross-contract call under a short
/// identifying `key`, with a TTL expressed in ledgers.
pub struct CachedCall;

impl CachedCall {
    /// Return the cached value for `key` if it exists and has not expired.
    ///
    /// Emits `cache_hit` on a hit, and `cache_miss` on a miss (either no
    /// entry was ever stored, or it expired). On expiry, the stale entry is
    /// removed immediately so the cache does not grow unboundedly.
    pub fn get<T>(env: &Env, key: &Symbol) -> Option<T>
    where
        T: TryFromVal<Env, Val>,
    {
        let value_key = CacheStorageKey::Value(key.clone());
        let expiry_key = CacheStorageKey::Expiry(key.clone());
        let current_ledger = env.ledger().sequence();

        let expires_at_ledger: Option<u32> = env.storage().persistent().get(&expiry_key);
        if let Some(expires_at_ledger) = expires_at_ledger {
            if expires_at_ledger > current_ledger {
                if let Some(value) = env.storage().persistent().get::<_, Val>(&value_key) {
                    Self::emit_cache_event(env, "cache_hit", key);
                    return T::try_from_val(env, &value).ok();
                }
            }
            // Expired (or the value vanished): clean up now rather than
            // leaving a dead entry around.
            env.storage().persistent().remove(&value_key);
            env.storage().persistent().remove(&expiry_key);
        }

        Self::emit_cache_event(env, "cache_miss", key);
        None
    }

    /// Store `value` under `key`, valid for `ttl_ledgers` ledgers from now.
    pub fn set<V>(env: &Env, key: &Symbol, value: &V, ttl_ledgers: u32)
    where
        V: IntoVal<Env, Val>,
    {
        let value_key = CacheStorageKey::Value(key.clone());
        let expiry_key = CacheStorageKey::Expiry(key.clone());
        let expires_at_ledger = env.ledger().sequence().saturating_add(ttl_ledgers);

        env.storage()
            .persistent()
            .set(&value_key, &value.into_val(env));
        env.storage()
            .persistent()
            .set(&expiry_key, &expires_at_ledger);

        if ttl_ledgers > 0 {
            env.storage()
                .persistent()
                .extend_ttl(&value_key, 1, ttl_ledgers);
            env.storage()
                .persistent()
                .extend_ttl(&expiry_key, 1, ttl_ledgers);
        }
    }

    /// Fetch-through helper: returns the cached value for `key` if it is
    /// still fresh; otherwise invokes `function` on `contract` with `args`,
    /// caches the result for `ttl_ledgers` ledgers, and returns it.
    ///
    /// This is the main entry point for wrapping a cross-contract RPC call
    /// with caching: callers that previously did a bare
    /// `env.invoke_contract(...)` can swap it for this to get caching with
    /// TTL expiry and `cache_hit`/`cache_miss` observability for free.
    pub fn get_or_call<T>(
        env: &Env,
        key: &Symbol,
        contract: &Address,
        function: Symbol,
        args: Vec<Val>,
        ttl_ledgers: u32,
    ) -> T
    where
        T: TryFromVal<Env, Val> + IntoVal<Env, Val>,
    {
        if let Some(cached) = Self::get::<T>(env, key) {
            return cached;
        }

        let result: Result<
            Result<T, T::Error>,
            Result<soroban_sdk::Error, soroban_sdk::InvokeError>,
        > = env.try_invoke_contract(contract, &function, args);

        let value = match result {
            Ok(Ok(val)) => val,
            Err(err) => panic!("cross-contract call failed with execution error: {:?}", err),
            Ok(Err(_)) => panic!("cross-contract call failed to decode result type"),
        };

        Self::set(env, key, &value, ttl_ledgers);
        value
    }

    /// Manually invalidate a cached entry, removing it immediately
    /// regardless of its remaining TTL.
    pub fn bust_cache(env: &Env, key: &Symbol) {
        env.storage()
            .persistent()
            .remove(&CacheStorageKey::Value(key.clone()));
        env.storage()
            .persistent()
            .remove(&CacheStorageKey::Expiry(key.clone()));
    }

    /// True if a live (non-expired) cache entry exists for `key`. Unlike
    /// `get`, this does not emit a `cache_hit`/`cache_miss` event, so it is
    /// safe to use for plain existence checks.
    pub fn is_cached(env: &Env, key: &Symbol) -> bool {
        let current_ledger = env.ledger().sequence();
        env.storage()
            .persistent()
            .get::<_, u32>(&CacheStorageKey::Expiry(key.clone()))
            .map(|expires_at_ledger| expires_at_ledger > current_ledger)
            .unwrap_or(false)
    }

    /// Emit a lightweight `cache_hit` / `cache_miss` observability event.
    ///
    /// `Events::publish` is deprecated in favor of the `#[contractevent]`
    /// macro, which requires a concrete event type per call site; this
    /// helper is shared across arbitrary cache keys, so the lower-level API
    /// is used here (mirroring `contract_utils::events::emit_string`
    /// elsewhere in this crate).
    #[allow(deprecated)]
    fn emit_cache_event(env: &Env, topic: &str, key: &Symbol) {
        let topics = soroban_sdk::vec![env, Symbol::new(env, topic).to_val(), key.to_val()];
        env.events().publish(topics, env.ledger().sequence());
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Ledger as _;
    use soroban_sdk::{contract, contractimpl};

    /// Persistent storage and events are only reachable from a contract
    /// context, so every test body runs inside this minimal registered
    /// contract via [`Env::as_contract`].
    #[contract]
    pub struct CacheHarness;

    #[contractimpl]
    impl CacheHarness {
        pub fn noop() {}
    }

    fn in_contract<R>(env: &Env, f: impl FnOnce() -> R) -> R {
        let contract_id = env.register(CacheHarness, ());
        env.as_contract(&contract_id, f)
    }

    #[test]
    fn miss_then_set_then_hit() {
        let env = Env::default();
        let key = Symbol::new(&env, "config_value");

        in_contract(&env, || {
            // Nothing cached yet.
            assert!(CachedCall::get::<u32>(&env, &key).is_none());
            assert!(!CachedCall::is_cached(&env, &key));

            CachedCall::set(&env, &key, &42u32, 100);
            assert!(CachedCall::is_cached(&env, &key));
            assert_eq!(CachedCall::get::<u32>(&env, &key), Some(42u32));
        });
    }

    #[test]
    fn expires_after_ttl() {
        let env = Env::default();
        let key = Symbol::new(&env, "ttl_value");

        in_contract(&env, || CachedCall::set(&env, &key, &7u32, 5));

        env.ledger().with_mut(|li| {
            li.sequence_number += 10;
        });

        in_contract(&env, || {
            assert!(!CachedCall::is_cached(&env, &key));
            assert!(CachedCall::get::<u32>(&env, &key).is_none());
        });
    }

    #[test]
    fn bust_cache_removes_entry_immediately() {
        let env = Env::default();
        let key = Symbol::new(&env, "bustable");

        in_contract(&env, || {
            CachedCall::set(&env, &key, &1u32, 1000);
            assert!(CachedCall::is_cached(&env, &key));

            CachedCall::bust_cache(&env, &key);
            assert!(!CachedCall::is_cached(&env, &key));
            assert!(CachedCall::get::<u32>(&env, &key).is_none());
        });
    }
}
