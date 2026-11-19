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
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum CacheStorageKey {
    Entry(Symbol),
}

/// A single cached cross-contract call result.
#[contracttype]
#[derive(Clone, Debug)]
struct CacheEntry {
    value: Val,
    expires_at_ledger: u32,
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
        let storage_key = CacheStorageKey::Entry(key.clone());
        let current_ledger = env.ledger().sequence();

        if let Some(entry) = env
            .storage()
            .persistent()
            .get::<CacheStorageKey, CacheEntry>(&storage_key)
        {
            if entry.expires_at_ledger > current_ledger {
                Self::emit_cache_event(env, "cache_hit", key);
                return T::try_from_val(env, &entry.value).ok();
            }
            // Expired: clean up now rather than leaving a dead entry around.
            env.storage().persistent().remove(&storage_key);
        }

        Self::emit_cache_event(env, "cache_miss", key);
        None
    }

    /// Store `value` under `key`, valid for `ttl_ledgers` ledgers from now.
    pub fn set<V>(env: &Env, key: &Symbol, value: &V, ttl_ledgers: u32)
    where
        V: IntoVal<Env, Val>,
    {
        let storage_key = CacheStorageKey::Entry(key.clone());
        let expires_at_ledger = env.ledger().sequence().saturating_add(ttl_ledgers);
        let entry = CacheEntry {
            value: value.into_val(env),
            expires_at_ledger,
        };
        env.storage().persistent().set(&storage_key, &entry);
        if ttl_ledgers > 0 {
            env.storage()
                .persistent()
                .extend_ttl(&storage_key, 1, ttl_ledgers);
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
            Err(err) => panic!(
                "cross-contract call failed with execution error: {:?}",
                err
            ),
            Ok(Err(_)) => panic!("cross-contract call failed to decode result type"),
        };

        Self::set(env, key, &value, ttl_ledgers);
        value
    }

    /// Manually invalidate a cached entry, removing it immediately
    /// regardless of its remaining TTL.
    pub fn bust_cache(env: &Env, key: &Symbol) {
        let storage_key = CacheStorageKey::Entry(key.clone());
        env.storage().persistent().remove(&storage_key);
    }

    /// True if a live (non-expired) cache entry exists for `key`. Unlike
    /// `get`, this does not emit a `cache_hit`/`cache_miss` event, so it is
    /// safe to use for plain existence checks.
    pub fn is_cached(env: &Env, key: &Symbol) -> bool {
        let storage_key = CacheStorageKey::Entry(key.clone());
        let current_ledger = env.ledger().sequence();
        env.storage()
            .persistent()
            .get::<CacheStorageKey, CacheEntry>(&storage_key)
            .map(|entry| entry.expires_at_ledger > current_ledger)
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

    #[test]
    fn miss_then_set_then_hit() {
        let env = Env::default();
        let key = Symbol::new(&env, "config_value");

        // Nothing cached yet.
        assert!(CachedCall::get::<u32>(&env, &key).is_none());
        assert!(!CachedCall::is_cached(&env, &key));

        CachedCall::set(&env, &key, &42u32, 100);
        assert!(CachedCall::is_cached(&env, &key));
        assert_eq!(CachedCall::get::<u32>(&env, &key), Some(42u32));
    }

    #[test]
    fn expires_after_ttl() {
        let env = Env::default();
        let key = Symbol::new(&env, "ttl_value");

        CachedCall::set(&env, &key, &7u32, 5);
        assert!(CachedCall::is_cached(&env, &key));

        env.ledger().with_mut(|li| {
            li.sequence_number += 10;
        });

        assert!(!CachedCall::is_cached(&env, &key));
        assert!(CachedCall::get::<u32>(&env, &key).is_none());
    }

    #[test]
    fn bust_cache_removes_entry_immediately() {
        let env = Env::default();
        let key = Symbol::new(&env, "bustable");

        CachedCall::set(&env, &key, &1u32, 1000);
        assert!(CachedCall::is_cached(&env, &key));

        CachedCall::bust_cache(&env, &key);
        assert!(!CachedCall::is_cached(&env, &key));
        assert!(CachedCall::get::<u32>(&env, &key).is_none());
    }
}
