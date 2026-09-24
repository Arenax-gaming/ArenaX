#![no_std]

//! # Event Manager Contract
//!
//! Provides on-chain event indexing, filtering, analytics, monitoring, and archiving.

use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, Error, IntoVal, Map, Symbol, Val, Vec};

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

#[contracttype]
pub enum DataKey {
    Admin,
    EventCounter,
    Event(u64),
    PlayerEvents(Address),  // Vector of event IDs
    TopicAnalytics(Symbol), // count per topic
    AnomalyCounter,
    RateLimit(Symbol),
    LastEventTimestamp(Symbol),
    Paused,
    Subscription(Symbol), // topic -> Vec<Subscription>
}

#[contract]
pub struct EventManagerContract;

#[contractimpl]
impl EventManagerContract {
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

    /// Index a new event record.
    ///
    /// `Events::publish` is deprecated in favor of the `#[contractevent]`
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

        // Store event by ID
        env.storage()
            .persistent()
            .set(&DataKey::Event(counter), &record);
        env.storage()
            .persistent()
            .set(&DataKey::EventCounter, &counter);

        // Index by player
        let player_key = DataKey::PlayerEvents(player);
        let mut player_evs: Vec<u64> = env
            .storage()
            .persistent()
            .get(&player_key)
            .unwrap_or_else(|| Vec::new(&env));
        player_evs.push_back(counter);
        env.storage().persistent().set(&player_key, &player_evs);

        // Update Topic Analytics
        let analytic_key = DataKey::TopicAnalytics(topic.clone());
        let topic_count: u64 = env.storage().persistent().get(&analytic_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&analytic_key, &(topic_count + 1));

        // Event Monitoring: Check for rapid successive events (anomaly detection)
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
                .unwrap_or(5); // default limit: 5 seconds cooldown

            if current_ts - last_ts < limit as u64 {
                // Trigger Anomaly Alert
                let mut anomalies: u64 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::AnomalyCounter)
                    .unwrap_or(0);
                anomalies += 1;
                env.storage()
                    .persistent()
                    .set(&DataKey::AnomalyCounter, &anomalies);

                // Publish monitoring alert event
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

    /// Filter event records based on criteria. Supports pagination.
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

        // If filtering by player, we can optimize search using PlayerEvents index
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
            // General scan
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

    // ─── Subscription / callback bus (issue #1111) ────────────────────────

    /// Register a callback for a topic. The subscriber authorizes the
    /// subscription; callbacks run on the `callback_contract` after the
    /// emitting contract dispatches.
    pub fn subscribe(
        env: Env,
        subscriber: Address,
        topic: Symbol,
        callback_contract: Address,
        callback_function: Symbol,
    ) {
        Self::require_not_paused(&env);
        subscriber.require_auth();

        let key = DataKey::Subscription(topic.clone());
        let mut subscriptions: Vec<Subscription> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

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

        arenax_events::event_subscriptions::emit_subscribed(
            &env,
            &subscriber,
            &topic,
            &callback_contract,
            &callback_function,
            env.ledger().timestamp(),
        );
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

    /// Dispatch a stored event to every subscriber of its topic.
    ///
    /// Only the emitter contract recorded on the event may dispatch it. Each
    /// callback is invoked via `try_invoke_contract`, so a single broken
    /// subscriber cannot revert the whole dispatch; failures are counted as
    /// non-deliveries. Returns the number of successful deliveries.
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

        // Clone the event payload once — the loop below only borrows these.
        let event_contract = record.contract.clone();
        let event_player = record.player.clone();
        let event_topic = record.topic.clone();
        let event_timestamp = record.timestamp;
        let event_data = record.data.clone();

        let total = subscriptions.len();
        let mut delivered: u32 = 0;

        for sub in subscriptions.iter() {
            let mut payload: Vec<Val> = Vec::new(&env);
            payload.push_back(event_contract.clone().into_val(&env));
            payload.push_back(event_player.clone().into_val(&env));
            payload.push_back(event_topic.clone().into_val(&env));
            payload.push_back(event_timestamp.into_val(&env));
            payload.push_back(event_data.clone().into_val(&env));

            let invocation: Result<
                Result<(), core::convert::Infallible>,
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

    /// Archive events before a certain timestamp to save storage (archives them).
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

    /// Set rate limit parameter for monitoring.
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

    /// Set new admin for governance.
    ///
    /// Deliberately NOT pause-guarded (matching `auth-gateway`'s
    /// `transfer_admin`): admin rotation stays reachable during an incident so
    /// a compromised admin can be replaced while the contract is paused.
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
    /// Deliberately NOT guarded by `require_not_paused` — unpausing must stay
    /// reachable while paused. The flag lives in persistent storage, which
    /// persists across wasm upgrades of this contract at the same address.
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

    /// Check if the event manager is paused (read; works while paused).
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

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
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl,
        testutils::{Address as _, Ledger as _},
        Env,
    };

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

    #[test]
    fn test_event_manager_flow() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let player1 = Address::generate(&env);
        let player2 = Address::generate(&env);
        let caller = Address::generate(&env);

        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(&env, &contract_id);

        // Initialize
        client.initialize(&admin);

        // Index events
        let topic1 = Symbol::new(&env, "match_join");
        let topic2 = Symbol::new(&env, "match_win");
        let data1 = Bytes::new(&env);

        // Advance ledger timestamp to avoid rate limit alerts initially
        env.ledger().set_timestamp(100);
        let id1 = client.index_event(&caller, &player1, &topic1, &data1);

        env.ledger().set_timestamp(200);
        let id2 = client.index_event(&caller, &player2, &topic2, &data1);

        env.ledger().set_timestamp(300);
        let id3 = client.index_event(&caller, &player1, &topic2, &data1);

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);

        // Filter events
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

        // Analytics
        let mut topics = Vec::new(&env);
        topics.push_back(topic1.clone());
        topics.push_back(topic2.clone());
        let analytics = client.get_analytics(&topics);
        assert_eq!(analytics.total_indexed, 3);
        assert_eq!(analytics.events_by_topic.get(topic1.clone()).unwrap(), 1);
        assert_eq!(analytics.events_by_topic.get(topic2.clone()).unwrap(), 2);
        assert_eq!(analytics.anomaly_alerts_count, 0);

        // Monitoring rate limit check
        client.set_rate_limit(&topic1, &50); // limit cooldown 50s
                                             // Call index twice within 10 seconds (less than 50s cooldown)
        env.ledger().set_timestamp(350);
        client.index_event(&caller, &player1, &topic1, &data1);
        env.ledger().set_timestamp(360);
        client.index_event(&caller, &player1, &topic1, &data1);

        let analytics2 = client.get_analytics(&topics);
        assert_eq!(analytics2.anomaly_alerts_count, 1); // Anomaly detected!

        // Archiving
        // Archive events before timestamp 250 (which are id1 at timestamp 100, id2 at timestamp 200)
        let archived = client.archive_events(&250);
        assert_eq!(archived, 2);

        // Check that archived events are gone
        assert!(client.get_event(&1).is_none());
        assert!(client.get_event(&2).is_none());
        assert!(client.get_event(&3).is_some());
    }

    #[test]
    fn test_pause_round_trip() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(&env, &contract_id);
        client.initialize(&admin);

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
        let admin = Address::generate(&env);
        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        // No mocked auths: the admin signature requirement is not satisfied.
        client.set_paused(&true);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_index_event_blocked_while_paused() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(&env, &contract_id);
        client.initialize(&admin);

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

        let admin = Address::generate(&env);
        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        env.ledger().set_timestamp(100);
        let caller = Address::generate(&env);
        let player = Address::generate(&env);
        let topic = Symbol::new(&env, "match_join");
        client.index_event(&caller, &player, &topic, &Bytes::new(&env));

        client.set_paused(&true);

        // Read entry points must stay available during an emergency stop.
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

        let admin = Address::generate(&env);
        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(&env, &contract_id);
        client.initialize(&admin);

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

    // ─── Subscription / callback bus (issue #1111) ────────────────────────

    #[test]
    fn test_subscribe_and_unsubscribe_flow() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let subscriber = Address::generate(&env);
        let cb_id = env.register(MockCallbackSubscriber, ());
        let topic = Symbol::new(&env, "match_win");

        client.subscribe(&subscriber, &topic, &cb_id, &Symbol::new(&env, "on_event"));

        let subs = client.get_subscribers(&topic);
        assert_eq!(subs.len(), 1);
        assert_eq!(subs.get(0).unwrap().subscriber, subscriber);
        assert_eq!(subs.get(0).unwrap().callback_contract, cb_id);
        assert_eq!(subs.get(0).unwrap().callback_function, Symbol::new(&env, "on_event"));

        client.unsubscribe(&subscriber, &topic);
        assert_eq!(client.get_subscribers(&topic).len(), 0);
    }

    #[test]
    #[should_panic(expected = "already subscribed")]
    fn test_duplicate_subscribe_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(&env, &contract_id);
        client.initialize(&admin);

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

        let admin = Address::generate(&env);
        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let subscriber = Address::generate(&env);
        client.unsubscribe(&subscriber, &Symbol::new(&env, "match_win"));
    }

    #[test]
    fn test_dispatch_delivers_to_subscribers() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let caller = Address::generate(&env);
        let player = Address::generate(&env);
        let topic = Symbol::new(&env, "match_win");

        // Two subscribers, one broken one that panics on callback.
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

        let admin = Address::generate(&env);
        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let caller = Address::generate(&env);
        let player = Address::generate(&env);
        let id = client.index_event(
            &caller,
            &player,
            &Symbol::new(&env, "match_win"),
            &Bytes::new(&env),
        );

        client.dispatch_event(
            &caller,
            &Symbol::new(&env, "match_lose"),
            &id,
        );
    }

    #[test]
    #[should_panic(expected = "only emitter contract can dispatch event")]
    fn test_dispatch_only_emitter_allowed() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(EventManagerContract, ());
        let client = EventManagerContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let caller = Address::generate(&env);
        let player = Address::generate(&env);
        let topic = Symbol::new(&env, "match_win");
        let id = client.index_event(&caller, &player, &topic, &Bytes::new(&env));

        // A different address tries to dispatch.
        let impostor = Address::generate(&env);
        client.dispatch_event(&impostor, &topic, &id);
    }
}
