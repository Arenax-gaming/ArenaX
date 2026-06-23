#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

#[test]
fn test_init() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(RandomGenerationContract, ());
    let client = RandomGenerationContractClient::new(&env, &contract_id);

    client.init(&admin);

    let stored_admin = client.admin();
    assert_eq!(stored_admin, admin);
}

#[test]
#[should_panic(expected = "1")]
fn test_init_twice() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(RandomGenerationContract, ());
    let client = RandomGenerationContractClient::new(&env, &contract_id);

    client.init(&admin);
    client.init(&admin);
}

#[test]
fn test_request_and_fulfill() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let requester = Address::generate(&env);

    let contract_id = env.register(RandomGenerationContract, ());
    let client = RandomGenerationContractClient::new(&env, &contract_id);

    client.init(&admin);

    let seed = 12345;
    let commit = [1u8; 32];
    let request_id = client.request_random_number(&requester, &seed, &commit, &None);

    let reveal = [1u8; 32];
    let random_value = 98765;
    client.fulfill_random_request(&request_id, &random_value, &reveal);

    let request = client.get_request(&request_id).unwrap();
    assert!(request.fulfilled);
    assert_eq!(request.random_value, Some(random_value));
}

#[test]
fn test_game_randomness() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(RandomGenerationContract, ());
    let client = RandomGenerationContractClient::new(&env, &contract_id);

    client.init(&admin);

    let game_id = 1;
    let round = 1;
    let random_value = client.get_game_randomness(&game_id, &round);

    let same_value = client.get_game_randomness(&game_id, &round);
    assert_eq!(random_value, same_value);
}

#[test]
fn test_tournament_seeding() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(RandomGenerationContract, ());
    let client = RandomGenerationContractClient::new(&env, &contract_id);

    client.init(&admin);

    let tournament_id = 1;
    let entrants = Vec::from_array(&env, [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ]);

    let seeds = client.generate_tournament_seeds(&tournament_id, &entrants);
    assert_eq!(seeds.len(), 3);
}

#[test]
fn test_audit_history() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(RandomGenerationContract, ());
    let client = RandomGenerationContractClient::new(&env, &contract_id);

    client.init(&admin);

    let game_id = 1;
    client.get_game_randomness(&game_id, &1);
    client.get_game_randomness(&game_id, &2);

    let audit = client.audit_randomness_history(&0, &1000000000);
    assert_eq!(audit.len(), 2);
}

#[test]
fn test_verify_randomness() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let requester = Address::generate(&env);

    let contract_id = env.register(RandomGenerationContract, ());
    let client = RandomGenerationContractClient::new(&env, &contract_id);

    client.init(&admin);

    let seed = 12345;
    let commit = [1u8; 32];
    let request_id = client.request_random_number(&requester, &seed, &commit, &None);

    let reveal = [1u8; 32];
    let random_value = 98765;
    client.fulfill_random_request(&request_id, &random_value, &reveal);

    let verified = client.verify_randomness(&request_id, &reveal);
    assert!(verified);
}
