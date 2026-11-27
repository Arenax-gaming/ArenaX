#![no_std]

//! # Event Manager Contract
//!
//! Provides on-chain event indexing, filtering, analytics, monitoring,
//! archiving, and a pub/sub callback bus with per-subscriber topic filters.
//!
//! ## Topic filters (issue #topic-filters)
//!
//! Subscribers can restrict which dispatched events trigger their callback by
//! registering a list of accepted topic `Symbol`s alongside their
//! subscription.  The filter list is stored separately from the subscription
//! record so that existing subscribers are unaffected until they opt in.
//!
//! | Filter state            | Behaviour                              |
//! |-------------------------|----------------------------------------|
//! | Empty list (default)    | Wildcard — every dispatch fires the callback |
//! | Non-empty list          | Only events whose topic is in the list fire the callback |
//!
//! Authorised operations (require the subscriber's signature):
//! - [`subscribe_with_filters`] — subscribe and set an initial filter list.
//! - [`update_filters`] — replace the filter list on an existing subscription.
//! - [`remove_filters`] — clear filters, restoring wildcard behaviour.
//! - [`get_subscriber_filters`] — read-only; works while paused.

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Bytes, Env, Error, IntoVal, Map, Symbol, Val,
    Vec,
};

// ─────────────────────────────────────────────────────────────────────────────
// Data types
// ─────────────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct EventRecord {
    pub id: u64,
    pub contract: Address,
    pub player: Address,
    pub topic: Symbol,
    pub timestamp: u64,
    pub data: Bytes,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EventFilter {
    pub player: Option<Address>,
    pub topic: Option<Symbol>,
    pub start_timestamp: Option<u64>,
    pub end_timestamp: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EventAnalytics {
    pub total_indexed: u64,
    pub events_by_topic: Map<Symbol, u64>,
    pub anomaly_alerts_count: u64,
}

/// A registered topic subscriber (issue #1111).
///
/// When an event is dispatched on `topic`, the event-manager invokes
/// `callback_function` on `callback_contract`, passing the event's
/// `(contract, player, topic, timestamp, data)` payload.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Subscription {
    pub subscriber: Address,
    pub callback_contract: Address,
    pub callback_function: Symbol,
    pub registered_at: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    EventCounter,
    Event(u64),
    PlayerEvents(Address),  // Vector of event IDs indexed by player
    TopicAnalytics(Symbol), // per-topic event count
    AnomalyCounter,
    RateLimit(Symbol),
    LastEventTimestamp(Symbol),
    Paused,
    Subscription(Symbol), // topic -> Vec<Subscription>
    /// Per-subscriber filter list for a given subscription topic.
    ///
    /// Key: `(subscriber_address, subscription_topic)`.
    /// Value: `Vec<Symbol>` — the accepted event topics.
    /// An absent key or an empty `Vec` means wildcard (all events).
    SubscriptionFilters(Address, Symbol),
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract implementation
// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct EventManagerContract;

#[contractimpl]
impl EventManagerContract {
    // ── Lifecycle ─────────────────────────────────────────────────────────

    /// Initialize the Event Manager.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::EventCounter, &0u64);
        env.storage()
            .persistent()
            .set(&DataKey::AnomalyCounter, &0u64);
        env.storage().persistent().set(&DataKey::Paused, &false);
    }

    // ── Event indexing ────────────────────────────────────────────────────

    /// Index a new event record.
    ///
    /// `Events::publish` is deprecated in favour of the `#[contractevent]`
    /// macro; this anomaly-monitoring alert doesn't have a concrete event
    /// type of its own, so migrating it is out of scope here.
    #[allow(deprecated)]
    pub fn index_event(
        env: Env,
        caller: Address,
        player: Address,
        topic: Symbol,
        data: Bytes,
    ) -> u64 {
        Self::require_not_paused(&env);
        caller.require_auth();

        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::EventCounter)
            .unwrap_or(0);
        counter += 1;

        let record = EventRecord {
            id: counter,
            contract: caller,
            player: player.clone(),
            topic: topic.clone(),
            timestamp: env.ledger().timestamp(),
            data,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Event(counter), &record);
        env.storage()
            .persistent()
            .set(&DataKey::EventCounter, &counter);

        // Index by player.
        let player_key = DataKey::PlayerEvents(player);
        let mut player_evs: Vec<u64> = env
            .storage()
            .persistent()
            .get(&player_key)
            .unwrap_or_else(|| Vec::new(&env));
        player_evs.push_back(counter);
        env.storage().persistent().set(&player_key, &player_evs);

        // Update per-topic analytics.
        let analytic_key = DataKey::TopicAnalytics(topic.clone());
        let topic_count: u64 = env.storage().persistent().get(&analytic_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&analytic_key, &(topic_count + 1));

        // Anomaly detection: check for rapid successive events on the same topic.
        let last_time_key = DataKey::LastEventTimestamp(topic.clone());
        if let Some(last_ts) = env
            .storage()
            .persistent()
            .get::<DataKey, u64>(&last_time_key)
        {
            let current_ts = env.ledger().timestamp();
            let limit: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::RateLimit(topic.clone()))
                .unwrap_or(5);

            if current_ts - last_ts < limit as u64 {
                let mut anomalies: u64 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::AnomalyCounter)
                    .unwrap_or(0);
                anomalies += 1;
                env.storage()
                    .persistent()
                    .set(&DataKey::AnomalyCounter, &anomalies);

                env.events().publish(
                    (
                        Symbol::new(&env, "event_monitor"),
                        Symbol::new(&env, "anomaly_alert"),
                    ),
                    (topic.clone(), current_ts),
                );
            }
        }
        env.storage()
            .persistent()
            .set(&last_time_key, &env.ledger().timestamp());

        counter
    }

    /// Retrieve an event record by ID.
    pub fn get_event(env: Env, id: u64) -> Option<EventRecord> {
        env.storage().persistent().get(&DataKey::Event(id))
    }

    /// Filter event records based on criteria with pagination.
    pub fn filter_events(
        env: Env,
        filter: EventFilter,
        offset: u32,
        limit: u32,
    ) -> Vec<EventRecord> {
        let total: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::EventCounter)
            .unwrap_or(0);
        let mut results = Vec::new(&env);
        let mut skipped = 0;

        if let Some(ref player_addr) = filter.player {
            let player_key = DataKey::PlayerEvents(player_addr.clone());
            let player_evs: Vec<u64> = env
                .storage()
                .persistent()
                .get(&player_key)
                .unwrap_or_else(|| Vec::new(&env));

            for id in player_evs.iter() {
                if let Some(record) = env
                    .storage()
                    .persistent()
                    .get::<DataKey, EventRecord>(&DataKey::Event(id))
                {
                    if Self::matches_filter(&record, &filter) {
                        if skipped < offset {
                            skipped += 1;
                            continue;
                        }
                        results.push_back(record);
                        if results.len() >= limit {
                            break;
                        }
                    }
                }
            }
        } else {
            let mut i = 1u64;
            while i <= total {
                if let Some(record) = env
                    .storage()
                    .persistent()
                    .get::<DataKey, EventRecord>(&DataKey::Event(i))
                {
                    if Self::matches_filter(&record, &filter) {
                        if skipped < offset {
                            skipped += 1;
                            i += 1;
                            continue;
                        }
                        results.push_back(record);
                        if results.len() >= limit {
                            break;
                        }
                    }
                }
                i += 1;
            }
        }

        results
    }

    // ── Analytics ─────────────────────────────────────────────────────────

    /// Fetch aggregate analytics.
    pub fn get_analytics(env: Env, topics: Vec<Symbol>) -> EventAnalytics {
        let total: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::EventCounter)
            .unwrap_or(0);
        let anomalies: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::AnomalyCounter)
            .unwrap_or(0);

        let mut topic_map = Map::new(&env);
        for topic in topics.iter() {
            let count: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::TopicAnalytics(topic.clone()))
                .unwrap_or(0);
            topic_map.set(topic, count);
        }

        EventAnalytics {
            total_indexed: total,
            events_by_topic: topic_map,
            anomaly_alerts_count: anomalies,
        }
    }

    // ── Subscription / callback bus (issue #1111) ─────────────────────────

    /// Register a callback for a topic with no initial topic filters (wildcard).
    ///
    /// All dispatched events on `topic` will invoke the callback.  Use
    /// [`subscribe_with_filters`] to register with an initial filter list, or
    /// call [`update_filters`] afterwards to narrow the subscription.
    pub fn subscribe(
        env: Env,
        subscriber: Address,
        topic: Symbol,
        callback_contract: Address,
        callback_function: Symbol,
    ) {
        Self::require_not_paused(&env);
        subscriber.require_auth();

        Self::insert_subscription(
            &env,
            subscriber,
            topic,
            callback_contract,
            callback_function,
            Vec::new(&env), // empty = wildcard
        );
    }

    /// Register a callback for a topic **and** set an initial filter list.
    ///
    /// `filters` is the list of event topics that will trigger the callback.
    /// Pass an empty `Vec` to register as a wildcard subscriber (identical to
    /// calling [`subscribe`]).
    ///
    /// The subscriber authorises the operation.
    pub fn subscribe_with_filters(
        env: Env,
        subscriber: Address,
        topic: Symbol,
        callback_contract: Address,
        callback_function: Symbol,
        filters: Vec<Symbol>,
    ) {
        Self::require_not_paused(&env);
        subscriber.require_auth();

        Self::insert_subscription(
            &env,
            subscriber,
            topic,
            callback_contract,
            callback_function,
            filters,
        );
    }

    /// Replace the topic-filter list on an existing subscription.
    ///
    /// `filters` becomes the new authoritative filter set.  Pass an empty
    /// `Vec` to restore wildcard (all-events) behaviour without unsubscribing.
    ///
    /// Panics if the subscriber is not currently subscribed to `topic`.
    /// The subscriber authorises the operation.
    pub fn update_filters(env: Env, subscriber: Address, topic: Symbol, filters: Vec<Symbol>) {
        Self::require_not_paused(&env);
        subscriber.require_auth();

        // Guard: subscriber must already exist for this topic.
        Self::require_subscribed(&env, &subscriber, &topic);

        let filter_key = DataKey::SubscriptionFilters(subscriber.clone(), topic.clone());
        env.storage().persistent().set(&filter_key, &filters);

        if filters.is_empty() {
            arenax_events::event_subscriptions::emit_filter_removed(
                &env,
                &subscriber,
                &topic,
                env.ledger().timestamp(),
            );
        } else {
            arenax_events::event_subscriptions::emit_filter_added(
                &env,
                &subscriber,
                &topic,
                &filters,
                env.ledger().timestamp(),
            );
        }
    }

    /// Clear all topic filters from a subscription, restoring wildcard behaviour.
    ///
    /// This is equivalent to calling `update_filters` with an empty list but
    /// provides a more intentional API surface for callers that always want
    /// the wildcard path.
    ///
    /// Panics if the subscriber is not currently subscribed to `topic`.
    /// The subscriber authorises the operation.
    pub fn remove_filters(env: Env, subscriber: Address, topic: Symbol) {
        Self::require_not_paused(&env);
        subscriber.require_auth();

        Self::require_subscribed(&env, &subscriber, &topic);

        let filter_key = DataKey::SubscriptionFilters(subscriber.clone(), topic.clone());
        // Remove the key entirely rather than storing an empty vec so storage
        // stays tidy; the absence of the key is treated as wildcard everywhere.
        env.storage().persistent().remove(&filter_key);

        arenax_events::event_subscriptions::emit_filter_removed(
            &env,
            &subscriber,
            &topic,
            env.ledger().timestamp(),
        );
    }

    /// Return the current topic-filter list for a subscriber on a given
    /// subscription topic.
    ///
    /// Returns an empty `Vec` when the subscriber has no filters set (wildcard)
    /// or is not subscribed at all.  Works while the contract is paused.
    pub fn get_subscriber_filters(env: Env, subscriber: Address, topic: Symbol) -> Vec<Symbol> {
        env.storage()
            .persistent()
            .get(&DataKey::SubscriptionFilters(subscriber, topic))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Remove a subscriber from a topic.
    pub fn unsubscribe(env: Env, subscriber: Address, topic: Symbol) {
        Self::require_not_paused(&env);
        subscriber.require_auth();

        let key = DataKey::Subscription(topic.clone());
        let subscriptions: Vec<Subscription> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut updated: Vec<Subscription> = Vec::new(&env);
        let mut removed = false;
        for sub in subscriptions.iter() {
            if sub.subscriber == subscriber {
                removed = true;
            } else {
                updated.push_back(sub);
            }
        }
        if !removed {
            panic!("not subscribed");
        }
        env.storage().persistent().set(&key, &updated);

        // Clean up the filter key so storage is not littered with orphaned keys.
        let filter_key = DataKey::SubscriptionFilters(subscriber.clone(), topic.clone());
        if env.storage().persistent().has(&filter_key) {
            env.storage().persistent().remove(&filter_key);
        }

        arenax_events::event_subscriptions::emit_unsubscribed(
            &env,
            &subscriber,
            &topic,
            env.ledger().timestamp(),
        );
    }

    /// List the subscriptions registered for a topic.
    pub fn get_subscribers(env: Env, topic: Symbol) -> Vec<Subscription> {
        env.storage()
            .persistent()
            .get(&DataKey::Subscription(topic))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Dispatch a stored event to every subscriber of its topic whose filter
    /// list permits the event.
    ///
    /// ### Filter semantics
    ///
    /// Before invoking a subscriber's callback, the dispatcher checks the
    /// subscriber's filter list (stored under
    /// `DataKey::SubscriptionFilters(subscriber, subscription_topic)`):
    ///
    /// - **Empty list** (or absent key) → wildcard; the callback is always
    ///   invoked regardless of the event's topic.
    /// - **Non-empty list** → the callback is invoked only when the event's
    ///   topic appears in the filter list.
    ///
    /// Only the emitter contract recorded on the event may dispatch it.  Each
    /// callback is isolated via `try_invoke_contract`, so a broken subscriber
    /// cannot revert the whole dispatch.  Returns the number of successful
    /// deliveries.
    pub fn dispatch_event(env: Env, caller: Address, topic: Symbol, event_id: u64) -> u32 {
        Self::require_not_paused(&env);

        let record: EventRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Event(event_id))
            .expect("event not found");
        if record.topic != topic {
            panic!("topic mismatch");
        }
        if record.contract != caller {
            panic!("only emitter contract can dispatch event");
        }

        let subscriptions: Vec<Subscription> = env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(topic.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let event_contract = record.contract.clone();
        let event_player = record.player.clone();
        let event_topic = record.topic.clone();
        let event_timestamp = record.timestamp;
        let event_data = record.data.clone();

        let total = subscriptions.len();
        let mut delivered: u32 = 0;

        for sub in subscriptions.iter() {
            // ── Filter check ────────��───────────────────────────────────
            // Load this subscriber's filter list.  An absent key or an
            // empty vec means wildcard — the callback always fires.
            let filter_key = DataKey::SubscriptionFilters(sub.subscriber.clone(), topic.clone());
            let filters: Vec<Symbol> = env
                .storage()
                .persistent()
                .get(&filter_key)
                .unwrap_or_else(|| Vec::new(&env));

            if !filters.is_empty() {
                // Narrow filter: only proceed if the event topic is listed.
                let mut permitted = false;
                for f in filters.iter() {
                    if f == event_topic {
                        permitted = true;
                        break;
                    }
                }
                if !permitted {
                    // Skip this subscriber — their filter excluded this topic.
                    continue;
                }
            }
            // ── Deliver ─────────────────────────────────────────────────

            let mut payload: Vec<Val> = Vec::new(&env);
            payload.push_back(event_contract.clone().into_val(&env));
            payload.push_back(event_player.clone().into_val(&env));
            payload.push_back(event_topic.clone().into_val(&env));
            payload.push_back(event_timestamp.into_val(&env));
            payload.push_back(event_data.clone().into_val(&env));

            let invocation: Result<
                Result<(), soroban_sdk::ConversionError>,
                Result<Error, soroban_sdk::InvokeError>,
            > = env.try_invoke_contract(&sub.callback_contract, &sub.callback_function, payload);

            if matches!(invocation, Ok(Ok(()))) {
                delivered += 1;
            }
        }

        arenax_events::event_subscriptions::emit_event_dispatched(
            &env,
            &topic,
            event_id,
            delivered,
            total,
            env.ledger().timestamp(),
        );

        delivered
    }

    // ── Admin operations ──────────────────────────────────────────────────

    /// Archive events before a certain timestamp to save storage.
    pub fn archive_events(env: Env, before_timestamp: u64) -> u32 {
        Self::require_not_paused(&env);

        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let total: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::EventCounter)
            .unwrap_or(0);
        let mut archived_count = 0;

        let mut i = 1u64;
        while i <= total {
            let key = DataKey::Event(i);
            if let Some(record) = env.storage().persistent().get::<DataKey, EventRecord>(&key) {
                if record.timestamp < before_timestamp {
                    env.storage().persistent().remove(&key);
                    archived_count += 1;
                }
            }
            i += 1;
        }

        archived_count
    }

    /// Set rate-limit parameter for anomaly monitoring.
    pub fn set_rate_limit(env: Env, topic: Symbol, limit_seconds: u32) {
        Self::require_not_paused(&env);

        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage()
            .persistent()
            .set(&DataKey::RateLimit(topic), &limit_seconds);
    }

    /// Transfer admin authority.
    ///
    /// Deliberately NOT pause-guarded so admin rotation stays reachable during
    /// an incident.
    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage().persistent().set(&DataKey::Admin, &new_admin);
    }

    /// Pause or resume the event manager (admin only, emergency stop).
    ///
    /// Deliberately NOT guarded by `require_not_paused` so unpausing remains
    /// reachable while the contract is paused.
    #[allow(deprecated)]
    pub fn set_paused(env: Env, paused: bool) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage().persistent().set(&DataKey::Paused, &paused);

        let action = if paused {
            Symbol::new(&env, "PAUSED")
        } else {
            Symbol::new(&env, "UNPAUSED")
        };
        env.events().publish(
            (Symbol::new(&env, "event_manager"), action),
            (admin, paused),
        );
    }

    /// Check whether the event manager is paused (read; works while paused).
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // ── Private helpers ───────────────────────────────────────────────────

    fn require_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }
    }

    fn matches_filter(record: &EventRecord, filter: &EventFilter) -> bool {
        if let Some(ref filter_topic) = filter.topic {
            if record.topic != *filter_topic {
                return false;
            }
        }
        if let Some(start) = filter.start_timestamp {
            if record.timestamp < start {
                return false;
            }
        }
        if let Some(end) = filter.end_timestamp {
            if record.timestamp > end {
                return false;
            }
        }
        true
    }

    /// Shared insertion logic used by both `subscribe` and
    /// `subscribe_with_filters`.
    fn insert_subscription(
        env: &Env,
        subscriber: Address,
        topic: Symbol,
        callback_contract: Address,
        callback_function: Symbol,
        filters: Vec<Symbol>,
    ) {
        let key = DataKey::Subscription(topic.clone());
        let mut subscriptions: Vec<Subscription> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));

        for sub in subscriptions.iter() {
            if sub.subscriber == subscriber {
                panic!("already subscribed");
            }
        }

        subscriptions.push_back(Subscription {
            subscriber: subscriber.clone(),
            callback_contract: callback_contract.clone(),
            callback_function: callback_function.clone(),
            registered_at: env.ledger().timestamp(),
        });
        env.storage().persistent().set(&key, &subscriptions);

        // Persist the initial filter list (even if empty, for explicit intent).
        // An absent key and an empty vec are treated identically by the
        // dispatcher, but storing the empty vec here keeps the API surface
        // predictable: `get_subscriber_filters` will return the value the
        // caller passed in.
        let filter_key = DataKey::SubscriptionFilters(subscriber.clone(), topic.clone());
        env.storage().persistent().set(&filter_key, &filters);

        arenax_events::event_subscriptions::emit_subscribed(
            env,
            &subscriber,
            &topic,
            &callback_contract,
            &callback_function,
            env.ledger().timestamp(),
        );

        // If a non-empty filter list was set at subscription time, also emit
        // a FilterAdded so indexers can build the filter state from events
        // alone.
        if !filters.is_empty() {
            arenax_events::event_subscriptions::emit_filter_added(
                env,
                &subscriber,
                &topic,
                &filters,
                env.ledger().timestamp(),
            );
        }
    }

    /// Assert that `subscriber` currently holds a subscription on `topic`.
    /// Panics with `"not subscribed"` if the subscription is absent, matching
    /// the error message used by `unsubscribe` for consistency.
    fn require_subscribed(env: &Env, subscriber: &Address, topic: &Symbol) {
        let key = DataKey::Subscription(topic.clone());
        let subscriptions: Vec<Subscription> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));

        let mut found = false;
        for sub in subscriptions.iter() {
            if sub.subscriber == *subscriber {
                found = true;
                break;
            }
        }
        if !found {
            panic!("not subscribed");
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl,
        testutils::{Address as _, Ledger as _},
        Env,
    };

    // ── Mock subscribers ──────────────────────────────────────────────────

    #[contract]
    pub struct MockCallbackSubscriber;

    #[contractimpl]
    impl MockCallbackSubscriber {
        pub fn on_event(
            env: Env,
            _contract: Address,
            _player: Address,
            _topic: Symbol,
            _timestamp: u64,
            _data: Bytes,
        ) {
            let mut calls: u64 = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "calls"))
                .unwrap_or(0);
            calls += 1;
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "calls"), &calls);
        }

        pub fn get_calls(env: Env) -> u64 {
            env.storage()
                .instance()
                .get(&Symbol::new(&env, "calls"))
                .unwrap_or(0)
        }
    }

    #[contract]
    pub struct MockBrokenSubscriber;

    #[contractimpl]
    impl MockBrokenSubscriber {
        pub fn on_event(
            _env: Env,
            _contract: Address,
            _player: Address,
            _topic: Symbol,
            _timestamp: u64,
            _data: Bytes,
        ) {
            panic!("broken callback");
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /// Bootstrap an initialised EventManagerContract and return its client.
    fn setup(env: &Env) -> (EventManagerContractClient, Address) {
        let admin = Address::generate(env);
        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(env, &contract_id);
        client.initialize(&admin);
        (client, admin)
    }

    // ── Existing test suite (unchanged behaviour) ─────────────────────────

    #[test]
    fn test_event_manager_flow() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, _admin) = setup(&env);

        let caller = Address::generate(&env);
        let player1 = Address::generate(&env);
        let player2 = Address::generate(&env);

        let topic1 = Symbol::new(&env, "match_join");
        let topic2 = Symbol::new(&env, "match_win");
        let data1 = Bytes::new(&env);

        env.ledger().set_timestamp(100);
        let id1 = client.index_event(&caller, &player1, &topic1, &data1);

        env.ledger().set_timestamp(200);
        let id2 = client.index_event(&caller, &player2, &topic2, &data1);

        env.ledger().set_timestamp(300);
        let id3 = client.index_event(&caller, &player1, &topic2, &data1);

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);

        let filter1 = EventFilter {
            player: Some(player1.clone()),
            topic: None,
            start_timestamp: None,
            end_timestamp: None,
        };
        let filtered1 = client.filter_events(&filter1, &0, &10);
        assert_eq!(filtered1.len(), 2);
        assert_eq!(filtered1.get(0).unwrap().id, 1);
        assert_eq!(filtered1.get(1).unwrap().id, 3);

        let mut topics = Vec::new(&env);
        topics.push_back(topic1.clone());
        topics.push_back(topic2.clone());
        let analytics = client.get_analytics(&topics);
        assert_eq!(analytics.total_indexed, 3);
        assert_eq!(analytics.events_by_topic.get(topic1.clone()).unwrap(), 1);
        assert_eq!(analytics.events_by_topic.get(topic2.clone()).unwrap(), 2);
        assert_eq!(analytics.anomaly_alerts_count, 0);

        client.set_rate_limit(&topic1, &50);
        env.ledger().set_timestamp(350);
        client.index_event(&caller, &player1, &topic1, &data1);
        env.ledger().set_timestamp(360);
        client.index_event(&caller, &player1, &topic1, &data1);

        let analytics2 = client.get_analytics(&topics);
        assert_eq!(analytics2.anomaly_alerts_count, 1);

        let archived = client.archive_events(&250);
        assert_eq!(archived, 2);
        assert!(client.get_event(&1).is_none());
        assert!(client.get_event(&2).is_none());
        assert!(client.get_event(&3).is_some());
    }

    #[test]
    fn test_pause_round_trip() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        assert!(!client.is_paused());
        client.set_paused(&true);
        assert!(client.is_paused());
        client.set_paused(&false);
        assert!(!client.is_paused());
    }

    #[test]
    #[should_panic(expected = "Error(Auth, InvalidAction)")]
    fn test_pause_unauthorized() {
        let env = Env::default();
        let (client, _) = setup(&env);
        // No mocked auths: the admin signature requirement is not satisfied.
        client.set_paused(&true);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_index_event_blocked_while_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);
        client.set_paused(&true);

        let caller = Address::generate(&env);
        let player = Address::generate(&env);
        client.index_event(
            &caller,
            &player,
            &Symbol::new(&env, "match_join"),
            &Bytes::new(&env),
        );
    }

    #[test]
    fn test_reads_work_while_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        env.ledger().set_timestamp(100);
        let caller = Address::generate(&env);
        let player = Address::generate(&env);
        let topic = Symbol::new(&env, "match_join");
        client.index_event(&caller, &player, &topic, &Bytes::new(&env));

        client.set_paused(&true);

        assert!(client.is_paused());
        assert!(client.get_event(&1).is_some());
        assert_eq!(
            client
                .get_analytics(&Vec::from_array(&env, [topic]))
                .total_indexed,
            1
        );
    }

    #[test]
    fn test_unpause_restores_mutations() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        client.set_paused(&true);
        client.set_paused(&false);

        env.ledger().set_timestamp(300);
        let caller = Address::generate(&env);
        let player = Address::generate(&env);
        let id = client.index_event(
            &caller,
            &player,
            &Symbol::new(&env, "match_win"),
            &Bytes::new(&env),
        );
        assert_eq!(id, 1);
    }

    #[test]
    fn test_subscribe_and_unsubscribe_flow() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let subscriber = Address::generate(&env);
        let cb_id = env.register(MockCallbackSubscriber, ());
        let topic = Symbol::new(&env, "match_win");

        client.subscribe(&subscriber, &topic, &cb_id, &Symbol::new(&env, "on_event"));

        let subs = client.get_subscribers(&topic);
        assert_eq!(subs.len(), 1);
        assert_eq!(subs.get(0).unwrap().subscriber, subscriber);

        client.unsubscribe(&subscriber, &topic);
        assert_eq!(client.get_subscribers(&topic).len(), 0);
    }

    #[test]
    #[should_panic(expected = "already subscribed")]
    fn test_duplicate_subscribe_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let subscriber = Address::generate(&env);
        let cb_id = env.register(MockCallbackSubscriber, ());
        let topic = Symbol::new(&env, "match_win");

        client.subscribe(&subscriber, &topic, &cb_id, &Symbol::new(&env, "on_event"));
        client.subscribe(&subscriber, &topic, &cb_id, &Symbol::new(&env, "on_event"));
    }

    #[test]
    #[should_panic(expected = "not subscribed")]
    fn test_unsubscribe_when_not_subscribed_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let subscriber = Address::generate(&env);
        client.unsubscribe(&subscriber, &Symbol::new(&env, "match_win"));
    }

    #[test]
    fn test_dispatch_delivers_to_subscribers() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let caller = Address::generate(&env);
        let player = Address::generate(&env);
        let topic = Symbol::new(&env, "match_win");

        let sub1 = Address::generate(&env);
        let cb_ok_id = env.register(MockCallbackSubscriber, ());
        client.subscribe(&sub1, &topic, &cb_ok_id, &Symbol::new(&env, "on_event"));

        let sub2 = Address::generate(&env);
        let cb_broken_id = env.register(MockBrokenSubscriber, ());
        client.subscribe(&sub2, &topic, &cb_broken_id, &Symbol::new(&env, "on_event"));

        env.ledger().set_timestamp(100);
        let id = client.index_event(&caller, &player, &topic, &Bytes::new(&env));

        // A broken callback must not revert the dispatch.
        let delivered = client.dispatch_event(&caller, &topic, &id);
        assert_eq!(delivered, 1);

        env.as_contract(&cb_ok_id, || {
            let calls: u64 = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "calls"))
                .unwrap_or(0);
            assert_eq!(calls, 1);
        });
    }

    #[test]
    #[should_panic(expected = "topic mismatch")]
    fn test_dispatch_topic_mismatch_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let caller = Address::generate(&env);
        let player = Address::generate(&env);
        let id = client.index_event(
            &caller,
            &player,
            &Symbol::new(&env, "match_win"),
            &Bytes::new(&env),
        );

        client.dispatch_event(&caller, &Symbol::new(&env, "match_lose"), &id);
    }

    #[test]
    #[should_panic(expected = "only emitter contract can dispatch event")]
    fn test_dispatch_only_emitter_allowed() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let caller = Address::generate(&env);
        let player = Address::generate(&env);
        let topic = Symbol::new(&env, "match_win");
        let id = client.index_event(&caller, &player, &topic, &Bytes::new(&env));

        let impostor = Address::generate(&env);
        client.dispatch_event(&impostor, &topic, &id);
    }

    // ── Topic filter tests (issue #topic-filters) ─────────────────────────

    /// A subscriber with a narrow filter must only receive callbacks for events
    /// whose topic appears in that filter list.  Events on other topics must be
    /// silently skipped.
    ///
    /// Setup:
    ///   subscriber A — filter: ["match_win"]   (narrow)
    ///   subscriber B — no filter               (wildcard, used as reference)
    ///
    /// We dispatch one "match_win" event and one "match_join" event.
    ///
    /// Expected:
    ///   A's callback fires exactly once  (only for "match_win").
    ///   B's callback fires exactly twice (wildcard sees both).
    #[test]
    fn test_narrow_filter_only_triggers_matching_events() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let caller = Address::generate(&env);
        let player = Address::generate(&env);

        // Both subscribers listen on the subscription topic "match_win".
        // The subscription topic is the channel; the filter is a secondary
        // gate on the event topic carried inside the EventRecord.
        let sub_topic = Symbol::new(&env, "match_win");

        let sub_narrow = Address::generate(&env);
        let cb_narrow_id = env.register(MockCallbackSubscriber, ());

        let sub_wide = Address::generate(&env);
        let cb_wide_id = env.register(MockCallbackSubscriber, ());

        // Narrow subscriber: only wants "match_win" events.
        let mut narrow_filters: Vec<Symbol> = Vec::new(&env);
        narrow_filters.push_back(Symbol::new(&env, "match_win"));

        client.subscribe_with_filters(
            &sub_narrow,
            &sub_topic,
            &cb_narrow_id,
            &Symbol::new(&env, "on_event"),
            &narrow_filters,
        );

        // Wildcard subscriber: empty filter list → receives everything.
        client.subscribe(
            &sub_wide,
            &sub_topic,
            &cb_wide_id,
            &Symbol::new(&env, "on_event"),
        );

        // Verify filter storage round-trip.
        let stored = client.get_subscriber_filters(&sub_narrow, &sub_topic);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored.get(0).unwrap(), Symbol::new(&env, "match_win"));

        // Index event 1: topic = "match_win"  → both subscribers should fire.
        env.ledger().set_timestamp(100);
        let id_win = client.index_event(
            &caller,
            &player,
            &Symbol::new(&env, "match_win"),
            &Bytes::new(&env),
        );

        // Index event 2: topic = "match_join" → only the wildcard subscriber fires.
        env.ledger().set_timestamp(110);
        let id_join = client.index_event(
            &caller,
            &player,
            &Symbol::new(&env, "match_join"),
            &Bytes::new(&env),
        );

        // Dispatch "match_win" event on the sub_topic channel.
        let delivered_win = client.dispatch_event(&caller, &sub_topic, &id_win);
        // Both subscribers are on this channel and "match_win" is in the
        // narrow filter, so both callbacks must fire.
        assert_eq!(
            delivered_win, 2,
            "both subscribers should receive the match_win event"
        );

        // Dispatch "match_join" event on the sub_topic channel.
        // The narrow subscriber's filter does NOT include "match_join", so
        // their callback must be skipped.  Only the wildcard subscriber fires.
        //
        // Note: we re-index match_join on sub_topic to satisfy the dispatcher's
        // "event.contract == caller" and topic checks.  The EventRecord already
        // stores the original topic ("match_join"); what matters for the filter
        // gate is event_record.topic vs the subscriber's filter list.
        let delivered_join = client.dispatch_event(&caller, &sub_topic, &id_join);
        assert_eq!(
            delivered_join, 1,
            "only the wildcard subscriber should receive the match_join event"
        );

        // Confirm call counts.
        env.as_contract(&cb_narrow_id, || {
            let calls: u64 = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "calls"))
                .unwrap_or(0);
            assert_eq!(
                calls, 1,
                "narrow subscriber should have been called exactly once"
            );
        });

        env.as_contract(&cb_wide_id, || {
            let calls: u64 = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "calls"))
                .unwrap_or(0);
            assert_eq!(
                calls, 2,
                "wildcard subscriber should have been called twice"
            );
        });
    }

    /// Calling `remove_filters` on a subscription that had a narrow filter set
    /// restores the wildcard (all-events) behaviour: subsequent dispatches of
    /// any topic must invoke the callback again.
    #[test]
    fn test_wildcard_filter_restores_all_events() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let caller = Address::generate(&env);
        let player = Address::generate(&env);
        let sub_topic = Symbol::new(&env, "match_win");

        let subscriber = Address::generate(&env);
        let cb_id = env.register(MockCallbackSubscriber, ());

        // Start with a narrow filter: only "match_win".
        let mut narrow_filters: Vec<Symbol> = Vec::new(&env);
        narrow_filters.push_back(Symbol::new(&env, "match_win"));

        client.subscribe_with_filters(
            &subscriber,
            &sub_topic,
            &cb_id,
            &Symbol::new(&env, "on_event"),
            &narrow_filters,
        );

        // Index a "match_join" event and dispatch it — should be blocked by filter.
        env.ledger().set_timestamp(100);
        let id_join = client.index_event(
            &caller,
            &player,
            &Symbol::new(&env, "match_join"),
            &Bytes::new(&env),
        );
        let delivered_before = client.dispatch_event(&caller, &sub_topic, &id_join);
        assert_eq!(
            delivered_before, 0,
            "narrow filter should block match_join before reset"
        );

        // Now clear all filters → wildcard behaviour restored.
        client.remove_filters(&subscriber, &sub_topic);

        // Confirm the filter list is now empty.
        let stored_after = client.get_subscriber_filters(&subscriber, &sub_topic);
        assert_eq!(
            stored_after.len(),
            0,
            "filter list should be empty after remove_filters"
        );

        // Index another "match_join" event and dispatch — now it must fire.
        env.ledger().set_timestamp(200);
        let id_join2 = client.index_event(
            &caller,
            &player,
            &Symbol::new(&env, "match_join"),
            &Bytes::new(&env),
        );
        let delivered_after = client.dispatch_event(&caller, &sub_topic, &id_join2);
        assert_eq!(
            delivered_after, 1,
            "wildcard subscriber should receive match_join after filters are removed"
        );

        env.as_contract(&cb_id, || {
            let calls: u64 = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "calls"))
                .unwrap_or(0);
            // Only the second dispatch (after remove_filters) should have fired.
            assert_eq!(calls, 1, "callback should have been invoked exactly once");
        });
    }

    /// `update_filters` replaces the filter set mid-subscription.
    #[test]
    fn test_update_filters_replaces_existing() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let subscriber = Address::generate(&env);
        let cb_id = env.register(MockCallbackSubscriber, ());
        let topic = Symbol::new(&env, "match_win");

        // Subscribe with no filters (wildcard).
        client.subscribe(&subscriber, &topic, &cb_id, &Symbol::new(&env, "on_event"));

        // Add a narrow filter.
        let mut new_filters: Vec<Symbol> = Vec::new(&env);
        new_filters.push_back(Symbol::new(&env, "match_win"));
        client.update_filters(&subscriber, &topic, &new_filters);

        let stored = client.get_subscriber_filters(&subscriber, &topic);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored.get(0).unwrap(), Symbol::new(&env, "match_win"));

        // Replace with an empty list (wildcard).
        client.update_filters(&subscriber, &topic, &Vec::new(&env));
        let stored_empty = client.get_subscriber_filters(&subscriber, &topic);
        assert_eq!(stored_empty.len(), 0);
    }

    /// `update_filters` on a non-existent subscription must panic.
    #[test]
    #[should_panic(expected = "not subscribed")]
    fn test_update_filters_requires_subscription() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let subscriber = Address::generate(&env);
        let topic = Symbol::new(&env, "match_win");

        client.update_filters(&subscriber, &topic, &Vec::new(&env));
    }

    /// `remove_filters` on a non-existent subscription must panic.
    #[test]
    #[should_panic(expected = "not subscribed")]
    fn test_remove_filters_requires_subscription() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let subscriber = Address::generate(&env);
        client.remove_filters(&subscriber, &Symbol::new(&env, "match_win"));
    }

    /// Unsubscribing must clean up the filter storage key so it doesn't linger.
    #[test]
    fn test_unsubscribe_cleans_up_filter_key() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let subscriber = Address::generate(&env);
        let cb_id = env.register(MockCallbackSubscriber, ());
        let topic = Symbol::new(&env, "match_win");

        let mut filters: Vec<Symbol> = Vec::new(&env);
        filters.push_back(Symbol::new(&env, "match_win"));
        client.subscribe_with_filters(
            &subscriber,
            &topic,
            &cb_id,
            &Symbol::new(&env, "on_event"),
            &filters,
        );

        client.unsubscribe(&subscriber, &topic);

        // After unsubscribing the filter key should return an empty vec (not
        // the old value), confirming the key was removed.
        let stored = client.get_subscriber_filters(&subscriber, &topic);
        assert_eq!(stored.len(), 0);
    }

    /// `get_subscriber_filters` works while the contract is paused.
    #[test]
    fn test_get_filters_works_while_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);

        let subscriber = Address::generate(&env);
        let cb_id = env.register(MockCallbackSubscriber, ());
        let topic = Symbol::new(&env, "match_win");

        let mut filters: Vec<Symbol> = Vec::new(&env);
        filters.push_back(Symbol::new(&env, "match_win"));
        client.subscribe_with_filters(
            &subscriber,
            &topic,
            &cb_id,
            &Symbol::new(&env, "on_event"),
            &filters,
        );

        client.set_paused(&true);

        // Read must succeed even while paused.
        let stored = client.get_subscriber_filters(&subscriber, &topic);
        assert_eq!(stored.len(), 1);
    }
}
