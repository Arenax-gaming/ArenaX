#![no_std]

//! # Event Manager Contract
//!
//! Provides on-chain event indexing, filtering, analytics, monitoring, and archiving.

use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, Map, Symbol, Vec};

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
        testutils::{Address as _, Ledger as _},
        Env,
    };

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
}
