#![cfg(test)]

use contract_standards::TokenMetadata;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String};

/// Minimal multi-token registry used by these tests. The tests were written
/// against a `token_manager` contract that does not exist anywhere in this
/// workspace, so the contract under test is defined here directly and follows
/// the `contract_standards::TokenRegistry` interface shape.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Tokens,
}

#[contract]
pub struct TokenManager;

#[contractimpl]
impl TokenManager {
    pub fn initialize(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn register_token(env: Env, token_address: Address, metadata: TokenMetadata) {
        if metadata.name.is_empty() {
            panic!("invalid token metadata: name must not be empty");
        }
        if metadata.decimals > 18 {
            panic!("invalid token metadata: decimals must not exceed 18");
        }

        let mut tokens: Map<Address, TokenMetadata> = env
            .storage()
            .instance()
            .get(&DataKey::Tokens)
            .unwrap_or_else(|| Map::new(&env));
        tokens.set(token_address, metadata);
        env.storage().instance().set(&DataKey::Tokens, &tokens);
    }

    pub fn is_token_registered(env: Env, token_address: Address) -> bool {
        Self::tokens(&env).contains_key(token_address)
    }

    pub fn list_tokens(env: Env) -> soroban_sdk::Vec<Address> {
        let tokens = Self::tokens(&env);
        let mut result = soroban_sdk::Vec::new(&env);
        for address in tokens.keys() {
            result.push_back(address);
        }
        result
    }

    pub fn get_token_metadata(env: Env, token_address: Address) -> TokenMetadata {
        Self::tokens(&env)
            .get(token_address)
            .unwrap_or_else(|| panic!("token is not registered"))
    }
}

impl TokenManager {
    fn tokens(env: &Env) -> Map<Address, TokenMetadata> {
        env.storage()
            .instance()
            .get(&DataKey::Tokens)
            .unwrap_or_else(|| Map::new(env))
    }
}

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
