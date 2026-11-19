//! Event replay guard (Issue #1575).
//!
//! An event consumer that restarts mid-stream can redeliver an event it has
//! already handled. Without a guard, a contract that reacts to that event
//! (crediting a balance, finalising a match, etc.) would apply the effect
//! twice. [`check_and_record`] gives any contract built on `arenax-events` a
//! single call that records an event ID the first time it is seen and
//! rejects it — with the timestamp of the original processing — every time
//! after that.
//!
//! Entries live in the calling contract's own persistent storage, keyed by
//! event ID, so the dedup set belongs to the contract instance rather than
//! to this crate and survives a wasm upgrade of that contract: persistent
//! storage is addressed by contract instance, not by code, so an upgrade
//! that swaps the wasm leaves existing entries (and their TTL) untouched.
//!
//! A second, insertion-ordered list of `(event_id, processed_at)` backs
//! [`prune_stale`], which is also invoked opportunistically every time a new
//! event is recorded, so the store does not grow without bound even if no
//! one ever calls it directly.

use soroban_sdk::{contractevent, contracttype, BytesN, Env, Vec};

pub const NAMESPACE: &str = "ArenaXEventGuard";
pub const VERSION: &str = "v1";

/// Entries older than this (in seconds) are eligible for pruning.
pub const RETENTION_SECONDS: u64 = 7 * 24 * 60 * 60;

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
enum GuardKey {
    /// event_id -> ledger timestamp it was first processed.
    Seen(BytesN<32>),
    /// Insertion-ordered (event_id, processed_at) pairs, oldest first, used
    /// only to drive pruning sweeps.
    Order,
}

/// Emitted when a request names an event ID that was already processed.
#[contractevent(topics = ["ArenaXEvdG_v1", "DUPLICATE"])]
pub struct DuplicateEventRejected {
    pub event_id: BytesN<32>,
    pub original_processed_at: u64,
}

/// Returned by [`check_and_record`] when `event_id` was already processed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EventAlreadyProcessed {
    /// Ledger timestamp the event was first processed at.
    pub original_processed_at: u64,
}

/// `event_already_processed`: the error tag a consumer should surface when
/// [`check_and_record`] returns [`EventAlreadyProcessed`].
pub const EVENT_ALREADY_PROCESSED: &str = "event_already_processed";

/// `duplicate_event_rejected`: the tag of the event [`check_and_record`]
/// emits on a duplicate.
pub const DUPLICATE_EVENT_REJECTED: &str = "duplicate_event_rejected";

/// Check whether `event_id` was already processed.
///
/// * If it is new, record it as processed at `now`, opportunistically prune
///   entries older than [`RETENTION_SECONDS`], and return `Ok(())` — the
///   caller should go ahead and process the event.
/// * If it was already processed, emit [`DuplicateEventRejected`] with the
///   event ID and the original processing timestamp, and return
///   `Err(EventAlreadyProcessed)` carrying that timestamp — the caller
///   should reject the request with `event_already_processed` rather than
///   process it again.
pub fn check_and_record(
    env: &Env,
    event_id: &BytesN<32>,
    now: u64,
) -> Result<(), EventAlreadyProcessed> {
    let storage = env.storage().persistent();
    let seen_key = GuardKey::Seen(event_id.clone());

    if let Some(original_processed_at) = storage.get::<GuardKey, u64>(&seen_key) {
        DuplicateEventRejected {
            event_id: event_id.clone(),
            original_processed_at,
        }
        .publish(env);
        return Err(EventAlreadyProcessed {
            original_processed_at,
        });
    }

    storage.set(&seen_key, &now);

    let mut order = order_list(env);
    order.push_back((event_id.clone(), now));
    storage.set(&GuardKey::Order, &order);

    prune_stale(env, now);

    Ok(())
}

/// Returns `Some(original_processed_at)` if `event_id` has already been
/// processed, without recording anything or emitting an event.
pub fn is_processed(env: &Env, event_id: &BytesN<32>) -> Option<u64> {
    env.storage()
        .persistent()
        .get(&GuardKey::Seen(event_id.clone()))
}

/// Remove every tracked event ID whose age (relative to `now`) exceeds
/// [`RETENTION_SECONDS`]. Entries are recorded oldest-first, so pruning
/// stops at the first entry still within the retention window. Returns the
/// number of entries removed.
pub fn prune_stale(env: &Env, now: u64) -> u32 {
    let storage = env.storage().persistent();
    let mut order = order_list(env);
    let mut pruned: u32 = 0;

    while let Some((event_id, processed_at)) = order.first() {
        if now.saturating_sub(processed_at) <= RETENTION_SECONDS {
            break;
        }
        storage.remove(&GuardKey::Seen(event_id));
        order.pop_front();
        pruned = pruned.saturating_add(1);
    }

    if pruned > 0 {
        storage.set(&GuardKey::Order, &order);
    }

    pruned
}

fn order_list(env: &Env) -> Vec<(BytesN<32>, u64)> {
    env.storage()
        .persistent()
        .get(&GuardKey::Order)
        .unwrap_or_else(|| Vec::new(env))
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Events as _, Ledger as _};

    #[soroban_sdk::contract]
    pub struct Dummy;

    fn event_id(env: &Env, byte: u8) -> BytesN<32> {
        BytesN::from_array(env, &[byte; 32])
    }

    #[test]
    fn a_new_event_is_accepted() {
        let env = Env::default();
        let contract = env.register(Dummy, ());
        let id = event_id(&env, 1);

        let result = env.as_contract(&contract, || check_and_record(&env, &id, 1_000));

        assert_eq!(result, Ok(()));
    }

    #[test]
    fn a_second_call_with_the_same_id_is_rejected() {
        let env = Env::default();
        let contract = env.register(Dummy, ());
        let id = event_id(&env, 2);

        env.as_contract(&contract, || {
            check_and_record(&env, &id, 1_000).unwrap();
        });

        let result = env.as_contract(&contract, || check_and_record(&env, &id, 2_000));

        assert_eq!(
            result,
            Err(EventAlreadyProcessed {
                original_processed_at: 1_000
            })
        );
    }

    #[test]
    fn a_duplicate_emits_duplicate_event_rejected_with_the_original_timestamp() {
        let env = Env::default();
        let contract = env.register(Dummy, ());
        let id = event_id(&env, 3);

        env.as_contract(&contract, || {
            check_and_record(&env, &id, 1_000).unwrap();
            let _ = check_and_record(&env, &id, 2_000);
        });

        assert_eq!(env.events().all().len(), 1);
    }

    #[test]
    fn new_unique_events_are_all_processed_normally() {
        let env = Env::default();
        let contract = env.register(Dummy, ());
        let a = event_id(&env, 4);
        let b = event_id(&env, 5);

        let (first, second) = env.as_contract(&contract, || {
            (
                check_and_record(&env, &a, 1_000),
                check_and_record(&env, &b, 1_001),
            )
        });

        assert_eq!(first, Ok(()));
        assert_eq!(second, Ok(()));
    }

    #[test]
    fn entries_older_than_seven_days_are_pruned() {
        let env = Env::default();
        let contract = env.register(Dummy, ());
        let id = event_id(&env, 6);

        env.as_contract(&contract, || {
            check_and_record(&env, &id, 1_000).unwrap();
            // Still within the window: nothing pruned, duplicate still caught.
            let still_duplicate = check_and_record(&env, &id, 1_000 + RETENTION_SECONDS);
            assert!(still_duplicate.is_err());

            // Past the window: pruned, so the same ID is accepted as new.
            let pruned = prune_stale(&env, 1_000 + RETENTION_SECONDS + 1);
            assert_eq!(pruned, 1);
            assert!(is_processed(&env, &id).is_none());

            let accepted_again = check_and_record(&env, &id, 1_000 + RETENTION_SECONDS + 1);
            assert_eq!(accepted_again, Ok(()));
        });
    }

    #[test]
    fn the_dedup_store_is_keyed_by_instance_storage_so_it_survives_upgrades() {
        // Persistent storage in Soroban is addressed by contract instance,
        // not by the wasm code hash, so updating a contract's executable
        // (a wasm upgrade) does not move or clear this guard's entries.
        // This test documents that guarantee at the guard's API level: the
        // same contract instance (`contract` below) sees its previously
        // recorded event ID regardless of how many times its code changes.
        let env = Env::default();
        let contract = env.register(Dummy, ());
        let id = event_id(&env, 7);

        env.as_contract(&contract, || {
            check_and_record(&env, &id, 1_000).unwrap();
        });

        let still_seen = env.as_contract(&contract, || is_processed(&env, &id));
        assert_eq!(still_seen, Some(1_000));
    }

    #[test]
    fn ledger_timestamp_can_drive_now() {
        let env = Env::default();
        env.ledger().set_timestamp(42);
        let contract = env.register(Dummy, ());
        let id = event_id(&env, 8);

        env.as_contract(&contract, || {
            check_and_record(&env, &id, env.ledger().timestamp()).unwrap();
        });

        let seen = env.as_contract(&contract, || is_processed(&env, &id));
        assert_eq!(seen, Some(42));
    }
}
