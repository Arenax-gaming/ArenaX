#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_initialize_and_add_oracle() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);

    let contract_id = env.register(AntiCheatOracle, ());
    let client = AntiCheatOracleClient::new(&env, &contract_id);

    client.initialize(&admin);
    assert!(!client.is_authorized_oracle(&oracle));

    client.add_authorized_oracle(&oracle);
    assert!(client.is_authorized_oracle(&oracle));

    client.remove_authorized_oracle(&oracle);
    assert!(!client.is_authorized_oracle(&oracle));
}

#[test]
fn test_submit_flag_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let player = Address::generate(&env);

    let contract_id = env.register(AntiCheatOracle, ());
    let client = AntiCheatOracleClient::new(&env, &contract_id);
    client.initialize(&admin);

    let result = client.try_submit_flag(&unauthorized, &player, &1u64, &2u32);
    assert_eq!(result, Err(Ok(AntiCheatError::Unauthorized)));
}

#[test]
fn test_submit_flag_invalid_severity() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let player = Address::generate(&env);

    let contract_id = env.register(AntiCheatOracle, ());
    let client = AntiCheatOracleClient::new(&env, &contract_id);
    client.initialize(&admin);
    client.add_authorized_oracle(&oracle);

    assert_eq!(
        client.try_submit_flag(&oracle, &player, &1u64, &0u32),
        Err(Ok(AntiCheatError::InvalidSeverity))
    );
    assert_eq!(
        client.try_submit_flag(&oracle, &player, &1u64, &4u32),
        Err(Ok(AntiCheatError::InvalidSeverity))
    );
}

#[test]
fn test_submit_flag_and_get_confirmation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let player = Address::generate(&env);
    let match_id = 42u64;

    let contract_id = env.register(AntiCheatOracle, ());
    let client = AntiCheatOracleClient::new(&env, &contract_id);
    client.initialize(&admin);
    client.add_authorized_oracle(&oracle);

    assert!(client.get_confirmation(&player, &match_id).is_none());

    client.submit_flag(&oracle, &player, &match_id, &2u32); // severity 2 = medium

    let conf = client.get_confirmation(&player, &match_id).unwrap();
    assert_eq!(conf.player, player);
    assert_eq!(conf.match_id, match_id);
    assert_eq!(conf.severity, 2);
    assert_eq!(conf.penalty_applied, 15); // PENALTY_MEDIUM
    assert_eq!(conf.oracle, oracle);
}

// Integration with Reputation Index is tested by calling submit_flag with
// set_reputation_contract set: the contract uses invoke_contract to call
// apply_anticheat_penalty. See reputation-index tests for penalty capping and no underflow.
