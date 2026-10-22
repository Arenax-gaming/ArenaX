#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    BytesN, Env,
};

fn setup(env: &Env) -> (AnalyticsContractClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(AnalyticsContract, ());
    let client = AnalyticsContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let salt = BytesN::from_array(env, &[7u8; 32]);
    client.initialize(&admin, &salt);
    (client, admin)
}

#[test]
fn test_register_and_unregister_contract() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let reporter = Address::generate(&env);
    let id = Symbol::new(&env, "match");

    assert!(!client.is_registered_contract(&id));
    client.register_contract(&id, &reporter);
    assert!(client.is_registered_contract(&id));
    client.unregister_contract(&id);
    assert!(!client.is_registered_contract(&id));
}

#[test]
#[should_panic(expected = "contract not registered")]
fn test_record_event_rejects_unregistered() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    client.record_event(
        &Symbol::new(&env, "unknown"),
        &Symbol::new(&env, "volume"),
        &100,
    );
}

#[test]
fn test_record_event_aggregates_counters() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let reporter = Address::generate(&env);
    let id = Symbol::new(&env, "match");
    client.register_contract(&id, &reporter);

    client.record_event(&id, &Symbol::new(&env, "tx"), &1);
    client.record_event(&id, &Symbol::new(&env, "volume"), &500);
    client.record_event(&id, &Symbol::new(&env, "users"), &3);
    client.record_event(&id, &Symbol::new(&env, "fees"), &50);
    client.record_event(&id, &Symbol::new(&env, "transaction"), &1);
    client.record_event(&id, &Symbol::new(&env, "user"), &0);

    let snap = client.get_platform_snapshot();
    assert_eq!(snap.total_transactions, 6);
    assert_eq!(snap.total_volume, 500);
    assert_eq!(snap.total_users, 4);
    assert_eq!(snap.total_fees_collected, 50);
}

#[test]
fn test_get_platform_snapshot_single_call() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let reporter = Address::generate(&env);
    let id = Symbol::new(&env, "stake");
    client.register_contract(&id, &reporter);

    client.record_event(&id, &Symbol::new(&env, "volume"), &1000);
    client.record_event(&id, &Symbol::new(&env, "fee"), &25);

    let snap = client.get_platform_snapshot();
    assert_eq!(snap.total_transactions, 2);
    assert_eq!(snap.total_volume, 1000);
    assert_eq!(snap.total_users, 0);
    assert_eq!(snap.total_fees_collected, 25);
}

#[test]
fn test_hourly_circular_overwrite_168_slots() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let reporter = Address::generate(&env);
    let id = Symbol::new(&env, "match");
    client.register_contract(&id, &reporter);

    env.ledger().with_mut(|l| l.timestamp = 0);
    client.record_event(&id, &Symbol::new(&env, "volume"), &100);
    client.record_event(&id, &Symbol::new(&env, "volume"), &50);
    let slot0 = client.get_hourly_snapshot(&0).unwrap();
    assert_eq!(slot0.hour, 0);
    assert_eq!(slot0.total_volume, 150);
    assert_eq!(slot0.total_transactions, 2);

    env.ledger().with_mut(|l| l.timestamp = 3600);
    client.record_event(&id, &Symbol::new(&env, "volume"), &10);
    let slot1 = client.get_hourly_snapshot(&1).unwrap();
    assert_eq!(slot1.hour, 1);
    assert_eq!(slot1.total_volume, 10);

    env.ledger().with_mut(|l| l.timestamp = 168 * 3600);
    client.record_event(&id, &Symbol::new(&env, "volume"), &5);
    let wrapped = client.get_hourly_snapshot(&0).unwrap();
    assert_eq!(wrapped.hour, 168);
    assert_eq!(wrapped.total_volume, 5);
    assert_eq!(wrapped.total_transactions, 1);
}

// ─── Leaderboard Attestation Tests (#1428) ───────────────────────────────────

#[test]
fn test_store_and_verify_snapshot() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    // Build a reporter and register them
    let reporter = Address::generate(&env);
    client.add_reporter(&reporter);

    // Build three leaderboard entries with pre-hashed player ids.
    // In production the contract hashes raw addresses; here we use BytesN
    // directly so the test controls the hash without needing the salt value.
    let hash1 = BytesN::from_array(&env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&env, &[2u8; 32]);
    let hash3 = BytesN::from_array(&env, &[3u8; 32]);

    let entries = soroban_sdk::vec![
        &env,
        LeaderboardEntry { player_hash: hash1.clone(), score: 9000, rank: 1 },
        LeaderboardEntry { player_hash: hash2.clone(), score: 7500, rank: 2 },
        LeaderboardEntry { player_hash: hash3.clone(), score: 6000, rank: 3 },
    ];

    let period_id: u64 = 1_700_000_000;
    client.store_snapshot(&reporter, &period_id, &entries);

    // verify_snapshot: supply a raw address whose hash matches hash2.
    // Because we used pre-hashed ids, we check get_snapshot directly instead.
    let snap = client.get_snapshot(&period_id).unwrap();
    assert_eq!(snap.period_id, period_id);
    assert_eq!(snap.entries.len(), 3);

    // Rank of hash2 entry must be 2
    let entry2 = snap.entries.get(1).unwrap();
    assert_eq!(entry2.rank, 2);
    assert_eq!(entry2.score, 7500);

    // Period list must contain the period
    let periods = client.get_snapshot_periods();
    assert_eq!(periods.len(), 1);
    assert_eq!(periods.get(0).unwrap(), period_id);
}

#[test]
#[should_panic(expected = "snapshot already exists for period")]
fn test_store_snapshot_is_append_only() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let reporter = Address::generate(&env);
    client.add_reporter(&reporter);

    let entries = soroban_sdk::vec![
        &env,
        LeaderboardEntry {
            player_hash: BytesN::from_array(&env, &[1u8; 32]),
            score: 100,
            rank: 1,
        },
    ];
    let period_id: u64 = 42;
    client.store_snapshot(&reporter, &period_id, &entries.clone());
    // Second call with the same period_id must panic
    client.store_snapshot(&reporter, &period_id, &entries);
}

#[test]
#[should_panic(expected = "not authorised to attest snapshot")]
fn test_store_snapshot_rejects_unauthorised_caller() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    // A random address that is neither admin nor a registered reporter
    let random = Address::generate(&env);
    let entries = soroban_sdk::vec![
        &env,
        LeaderboardEntry {
            player_hash: BytesN::from_array(&env, &[5u8; 32]),
            score: 50,
            rank: 1,
        },
    ];
    client.store_snapshot(&random, &1u64, &entries);
}

#[test]
fn test_verify_snapshot_returns_none_for_unknown_player() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let reporter = Address::generate(&env);
    client.add_reporter(&reporter);

    let entries = soroban_sdk::vec![
        &env,
        LeaderboardEntry {
            player_hash: BytesN::from_array(&env, &[1u8; 32]),
            score: 999,
            rank: 1,
        },
    ];
    client.store_snapshot(&reporter, &100u64, &entries);

    // verify_snapshot hashes the supplied address with the contract salt.
    // A freshly generated address will not match the [1u8;32] hash above.
    let stranger = Address::generate(&env);
    let rank = client.verify_snapshot(&100u64, &stranger);
    assert!(rank.is_none());
}

#[test]
fn test_admin_can_attest_snapshot() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let entries = soroban_sdk::vec![
        &env,
        LeaderboardEntry {
            player_hash: BytesN::from_array(&env, &[9u8; 32]),
            score: 1234,
            rank: 1,
        },
    ];
    // Admin address (not a reporter) must be accepted
    client.store_snapshot(&admin, &999u64, &entries);
    let snap = client.get_snapshot(&999u64);
    assert!(snap.is_some());
    assert_eq!(snap.unwrap().attester, admin);
}
