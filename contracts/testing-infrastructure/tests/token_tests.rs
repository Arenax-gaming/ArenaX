#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use contract_standards::TokenMetadata;
use token_manager::{TokenManager, TokenManagerClient};

#[test]
fn test_token_manager() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(TokenManager, ());
    let client = TokenManagerClient::new(&env, &contract_id);
    client.initialize(&admin);

    // Create test token metadata
    let token1_addr = Address::generate(&env);
    let token1_meta = TokenMetadata {
        name: String::from_str(&env, "ArenaX Token"),
        symbol: String::from_str(&env, "AXT"),
        decimals: 7,
    };

    // Register token
    client.register_token(&token1_addr, &token1_meta);

    // Verify token is registered
    assert!(client.is_token_registered(&token1_addr));
    assert_eq!(client.list_tokens().len(), 1);

    // Get token metadata
    let retrieved_meta = client.get_token_metadata(&token1_addr);
    assert_eq!(retrieved_meta.name, token1_meta.name);
    assert_eq!(retrieved_meta.symbol, token1_meta.symbol);
    assert_eq!(retrieved_meta.decimals, token1_meta.decimals);

    // Register another token
    let token2_addr = Address::generate(&env);
    let token2_meta = TokenMetadata {
        name: String::from_str(&env, "Stellar Lumens"),
        symbol: String::from_str(&env, "XLM"),
        decimals: 7,
    };
    client.register_token(&token2_addr, &token2_meta);
    assert_eq!(client.list_tokens().len(), 2);
}

#[test]
#[should_panic(expected = "invalid token metadata")]
fn test_invalid_token_metadata_empty_name() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(TokenManager, ());
    let client = TokenManagerClient::new(&env, &contract_id);
    client.initialize(&admin);

    let token_addr = Address::generate(&env);
    let bad_meta = TokenMetadata {
        name: String::from_str(&env, ""), // Empty name invalid
        symbol: String::from_str(&env, "BAD"),
        decimals: 7,
    };
    client.register_token(&token_addr, &bad_meta);
}

#[test]
#[should_panic(expected = "invalid token metadata")]
fn test_invalid_token_metadata_high_decimals() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(TokenManager, ());
    let client = TokenManagerClient::new(&env, &contract_id);
    client.initialize(&admin);

    let token_addr = Address::generate(&env);
    let bad_meta = TokenMetadata {
        name: String::from_str(&env, "Test"),
        symbol: String::from_str(&env, "TST"),
        decimals: 20, // More than 18 invalid
    };
    client.register_token(&token_addr, &bad_meta);
}
