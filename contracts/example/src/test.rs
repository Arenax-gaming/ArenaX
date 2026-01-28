//! Tests for the Example Contract

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn test_initialize() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(ExampleContract, ());
    let client = ExampleContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    let stored_admin = client.get_admin();
    assert_eq!(stored_admin, admin);
}

#[test]
fn test_greet() {
    let env = Env::default();
    let contract_id = env.register(ExampleContract, ());
    let client = ExampleContractClient::new(&env, &contract_id);

    let name = String::from_str(&env, "ArenaX");
    let greeting = client.greet(&name);

    assert_eq!(greeting, String::from_str(&env, "Hello, ArenaX!"));
}
