#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String, Vec};

fn setup(env: &Env) -> (UpgradeManagerClient<'_>, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(UpgradeManager, ());
    let client = UpgradeManagerClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let governor = Address::generate(env);

    let mut governors = Vec::new(env);
    governors.push_back(admin.clone());
    governors.push_back(governor.clone());

    client.initialize(&admin, &governors, &1);
    (client, admin, governor)
}

fn wasm_hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

#[test]
fn pause_round_trip() {
    let env = Env::default();
    let (client, admin, _governor) = setup(&env);

    assert!(!client.is_paused());
    client.set_paused(&admin, &true);
    assert!(client.is_paused());
    client.set_paused(&admin, &false);
    assert!(!client.is_paused());
}

#[test]
fn pause_by_non_admin_fails() {
    let env = Env::default();
    let (client, _admin, _governor) = setup(&env);

    let intruder = Address::generate(&env);
    assert_eq!(
        client.try_set_paused(&intruder, &true),
        Err(Ok(UpgradeError::NotAdmin))
    );
    // The flag must be untouched.
    assert!(!client.is_paused());
}

#[test]
fn proposal_blocked_while_paused() {
    let env = Env::default();
    let (client, admin, _governor) = setup(&env);

    client.set_paused(&admin, &true);

    let proposer = Address::generate(&env);
    assert_eq!(
        client.try_propose_upgrade(
            &proposer,
            &symbol_short!("token"),
            &wasm_hash(&env, 2),
            &String::from_str(&env, "paused"),
            &0u64,
        ),
        Err(Ok(UpgradeError::ContractPaused))
    );
}

#[test]
fn vote_blocked_while_paused() {
    let env = Env::default();
    let (client, admin, governor) = setup(&env);

    let proposer = Address::generate(&env);
    client.propose_upgrade(
        &proposer,
        &symbol_short!("token"),
        &wasm_hash(&env, 2),
        &String::from_str(&env, "v2"),
        &0,
    );

    client.set_paused(&admin, &true);

    assert_eq!(
        client.try_vote_upgrade(&governor, &1u32, &true),
        Err(Ok(UpgradeError::ContractPaused))
    );
}

#[test]
fn queries_work_while_paused() {
    let env = Env::default();
    let (client, admin, _governor) = setup(&env);

    let proposer = Address::generate(&env);
    client.propose_upgrade(
        &proposer,
        &symbol_short!("token"),
        &wasm_hash(&env, 2),
        &String::from_str(&env, "v2"),
        &0,
    );

    client.set_paused(&admin, &true);

    // Read entry points must stay available during an emergency stop.
    assert!(client.is_paused());
    assert!(client.get_proposal_query(&1u32).is_some());
    assert_eq!(client.get_votes_query(&1u32).len(), 0);
    assert_eq!(client.get_approved_wasm_hash(&symbol_short!("token")), None);
    assert_eq!(client.get_upgrade_history(&symbol_short!("token")).len(), 0);
}

#[test]
fn unpause_restores_mutations() {
    let env = Env::default();
    let (client, admin, _governor) = setup(&env);

    client.set_paused(&admin, &true);
    client.set_paused(&admin, &false);

    let proposer = Address::generate(&env);
    let proposal_id = client.propose_upgrade(
        &proposer,
        &symbol_short!("token"),
        &wasm_hash(&env, 2),
        &String::from_str(&env, "v2"),
        &0,
    );
    assert_eq!(proposal_id, 1);
}

#[test]
fn pause_flag_persists_across_storage_reload() {
    let env = Env::default();
    let (client, admin, _governor) = setup(&env);

    client.set_paused(&admin, &true);

    // Simulate a wasm upgrade at the same contract address: the guest re-reads
    // its (contract-persisted) instance storage. `is_paused` defaults the flag
    // to `false` when absent, so the pre-set `true` must survive the round-trip.
    let flag: bool = env.as_contract(&client.address, || {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Paused)
            .expect("paused flag must be present")
    });
    assert!(flag);
    assert!(client.is_paused());
}
