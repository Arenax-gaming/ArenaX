use crate::{contract::ArenaXToken, contract::ArenaXTokenClient, storage_types::{DECIMAL, NAME, SYMBOL, ZERO_ADDRESS}};
use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{vec, Address, Env, IntoVal, String, Symbol, TryFromVal, Val};


// Test constants
static INITIAL_SUPPLY: i128 = 0i128; // Start with 0, mint as needed
const MINT_AMOUNT: i128 = 1_000_0000000i128; // 1,000 tokens with 7 decimals
const TRANSFER_AMOUNT: i128 = 100_0000000i128; // 100 tokens
const BURN_AMOUNT: i128 = 50_0000000i128; // 50 tokens
const ALLOWANCE_AMOUNT: i128 = 500_0000000i128; // 500 tokens

// Test helper functions
fn create_token_contract<'a>(env: &'a Env) -> (Address, ArenaXTokenClient<'a>) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let contract_id = env.register(ArenaXToken, ());
    let client = ArenaXTokenClient::new(env, &contract_id);

    client.initialize(
        &admin,
        &DECIMAL,
        &String::from_str(env, NAME),
        &String::from_str(env, SYMBOL),
    );

    (admin, client)
}

fn create_token_contract_with_decimals<'a>(env: &'a Env, decimals: u32) -> (Address, ArenaXTokenClient<'a>) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let contract_id = env.register(ArenaXToken, ());
    let client = ArenaXTokenClient::new(env, &contract_id);

    client.initialize(
        &admin,
        &decimals,
        &String::from_str(env, NAME),
        &String::from_str(env, SYMBOL),
    );

    (admin, client)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    let (admin, client) = create_token_contract(&env);

    assert_eq!(client.admin(), admin);
    assert_eq!(client.decimals(), DECIMAL);
    assert_eq!(client.name(), String::from_str(&env, NAME));
    assert_eq!(client.symbol(), String::from_str(&env, SYMBOL));
    assert_eq!(client.total_supply(), INITIAL_SUPPLY);
}

#[test]
fn test_mint() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let user = Address::generate(&env);

    client.mint(&user, &MINT_AMOUNT);
    assert_eq!(client.balance(&user), MINT_AMOUNT);
    assert_eq!(client.total_supply(), MINT_AMOUNT);
}

#[test]
fn test_transfer() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    client.mint(&user1, &MINT_AMOUNT);
    client.transfer(&user1, &user2, &TRANSFER_AMOUNT);

    assert_eq!(client.balance(&user1), MINT_AMOUNT - TRANSFER_AMOUNT);
    assert_eq!(client.balance(&user2), TRANSFER_AMOUNT);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_transfer_insufficient_balance() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    client.mint(&user1, &100);
    client.transfer(&user1, &user2, &200);
}

#[test]
fn test_approve_and_transfer_from() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.mint(&owner, &MINT_AMOUNT);

    // Approve spender
    let expiration_ledger = env.ledger().sequence() + 100;
    client.approve(&owner, &spender, &ALLOWANCE_AMOUNT, &expiration_ledger);
    assert_eq!(client.allowance(&owner, &spender), ALLOWANCE_AMOUNT);

    // Transfer from owner to recipient using allowance
    client.transfer_from(&spender, &owner, &recipient, &TRANSFER_AMOUNT);

    assert_eq!(client.balance(&owner), MINT_AMOUNT - TRANSFER_AMOUNT);
    assert_eq!(client.balance(&recipient), TRANSFER_AMOUNT);
    assert_eq!(client.allowance(&owner, &spender), ALLOWANCE_AMOUNT - TRANSFER_AMOUNT);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_transfer_from_insufficient_allowance() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.mint(&owner, &MINT_AMOUNT);

    let expiration_ledger = env.ledger().sequence() + 100;
    client.approve(&owner, &spender, &100, &expiration_ledger);
    client.transfer_from(&spender, &owner, &recipient, &200);
}

#[test]
fn test_burn() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let user = Address::generate(&env);

    client.mint(&user, &MINT_AMOUNT);
    client.burn(&user, &BURN_AMOUNT);

    assert_eq!(client.balance(&user), MINT_AMOUNT - BURN_AMOUNT);
    assert_eq!(client.total_supply(), MINT_AMOUNT - BURN_AMOUNT);
}

#[test]
fn test_burn_from() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&owner, &MINT_AMOUNT);

    let expiration_ledger = env.ledger().sequence() + 100;
    client.approve(&owner, &spender, &ALLOWANCE_AMOUNT, &expiration_ledger);
    client.burn_from(&spender, &owner, &BURN_AMOUNT);

    assert_eq!(client.balance(&owner), MINT_AMOUNT - BURN_AMOUNT);
    assert_eq!(client.allowance(&owner, &spender), ALLOWANCE_AMOUNT - BURN_AMOUNT);
    assert_eq!(client.total_supply(), MINT_AMOUNT - BURN_AMOUNT);
}

#[test]
fn test_set_admin() {
    let env = Env::default();
    let (admin1, client) = create_token_contract(&env);
    let admin2 = Address::generate(&env);

    assert_eq!(client.admin(), admin1);

    client.set_admin(&admin2);
    assert_eq!(client.admin(), admin2);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_decimals_too_large() {
    let env = Env::default();
    let (_admin, _client) = create_token_contract_with_decimals(&env, 19);
}

#[test]
fn test_allowance_expiration() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&owner, &MINT_AMOUNT);

    // Set allowance with expiration at current ledger (already expired)
    let expiration_ledger = env.ledger().sequence();
    client.approve(&owner, &spender, &ALLOWANCE_AMOUNT, &expiration_ledger);

    // Allowance should return 0 when expired
    assert_eq!(client.allowance(&owner, &spender), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_negative_amount() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let user = Address::generate(&env);

    let _ = client.mint(&user, &-100);
}

