#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env};

fn setup() -> (Env, UpgradeManagerClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UpgradeManager, ());
    let client = UpgradeManagerClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let mut governors = soroban_sdk::Vec::new(&env);
    governors.push_back(admin.clone());
    client.initialize(&admin, &governors, &1);
    (env, client, admin)
}

#[test]
fn test_initialization_sets_paused_false() {
    let (_, client, _) = setup();
    assert!(!client.is_paused());
}

#[test]
fn test_set_paused_by_admin() {
    let (_, client, _) = setup();
    client.set_paused(&true).unwrap();
    assert!(client.is_paused());
    client.set_paused(&false).unwrap();
    assert!(!client.is_paused());
}

#[test]
fn test_propose_upgrade_works_when_not_paused() {
    let (env, client, admin) = setup();
    let wasm_hash = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
    let description = soroban_sdk::String::from_str(&env, "upgrade v2");
    let result = client.propose_upgrade(
        &admin,
        &symbol_short!("CONTRACT"),
        &wasm_hash,
        &description,
        &100,
    );
    assert!(result.is_ok());
}

#[test]
fn test_propose_upgrade_fails_when_paused() {
    let (env, client, admin) = setup();
    client.set_paused(&true).unwrap();

    let wasm_hash = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
    let description = soroban_sdk::String::from_str(&env, "upgrade v2");
    let result = client.try_propose_upgrade(
        &admin,
        &symbol_short!("CONTRACT"),
        &wasm_hash,
        &description,
        &100,
    );
    assert!(result.is_err());
}

#[test]
fn test_queries_work_when_paused() {
    let (env, client, admin) = setup();
    client.set_paused(&true).unwrap();

    // Reads should still work
    assert!(client.is_paused());
    let hash = client.get_approved_wasm_hash(&symbol_short!("CONTRACT"));
    assert!(hash.is_none());
}
