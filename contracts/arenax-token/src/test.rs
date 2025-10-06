use crate::{
    contract::ArenaXToken,
    contract::ArenaXTokenClient,
    storage_types::{DECIMAL, NAME, SYMBOL, ZERO_ADDRESS},
};
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

fn create_token_contract_with_decimals<'a>(
    env: &'a Env,
    decimals: u32,
) -> (Address, ArenaXTokenClient<'a>) {
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
    assert_eq!(
        client.allowance(&owner, &spender),
        ALLOWANCE_AMOUNT - TRANSFER_AMOUNT
    );
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
    assert_eq!(
        client.allowance(&owner, &spender),
        ALLOWANCE_AMOUNT - BURN_AMOUNT
    );
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

// ========== EVENT TESTING ==========

#[test]
fn test_mint_event() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let user = Address::generate(&env);
    let zero_address = Address::from_str(&env, ZERO_ADDRESS);

    client.mint(&user, &MINT_AMOUNT);

    // Verify mint event
    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let mint_event = events.get(0).unwrap();

    // Check topics
    let mint_topics = mint_event.1;
    assert_eq!(
        mint_topics,
        vec![&env, Symbol::new(&env, "mint")].into_val(&env)
    );

    // Check event data
    let mint_data = mint_event.2;
    let mint_data_map: soroban_sdk::Map<Symbol, Val> =
        soroban_sdk::Map::try_from_val(&env, &mint_data).unwrap();

    let expected_mint_data: soroban_sdk::Map<Symbol, Val> = soroban_sdk::Map::from_array(
        &env,
        [
            (Symbol::new(&env, "to"), user.clone().into_val(&env)),
            (Symbol::new(&env, "from"), zero_address.into_val(&env)),
            (Symbol::new(&env, "amount"), MINT_AMOUNT.into_val(&env)),
        ],
    );

    assert_eq!(mint_data_map, expected_mint_data);
}

#[test]
fn test_transfer_event() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    client.mint(&user1, &MINT_AMOUNT);
    client.transfer(&user1, &user2, &TRANSFER_AMOUNT);

    // Get only the transfer event (skip mint event)
    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let transfer_event = events.get(0).unwrap();

    // Check topics
    let transfer_topics = transfer_event.1;
    assert_eq!(
        transfer_topics,
        vec![&env, Symbol::new(&env, "transfer")].into_val(&env)
    );

    // Check event data
    let transfer_data = transfer_event.2;
    let transfer_data_map: soroban_sdk::Map<Symbol, Val> =
        soroban_sdk::Map::try_from_val(&env, &transfer_data).unwrap();

    let expected_transfer_data: soroban_sdk::Map<Symbol, Val> = soroban_sdk::Map::from_array(
        &env,
        [
            (Symbol::new(&env, "from"), user1.clone().into_val(&env)),
            (Symbol::new(&env, "to"), user2.clone().into_val(&env)),
            (Symbol::new(&env, "amount"), TRANSFER_AMOUNT.into_val(&env)),
        ],
    );

    assert_eq!(transfer_data_map, expected_transfer_data);
}

#[test]
fn test_burn_event() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let user = Address::generate(&env);
    let zero_address = Address::from_str(&env, ZERO_ADDRESS);

    client.mint(&user, &MINT_AMOUNT);
    client.burn(&user, &BURN_AMOUNT);

    // Get only the burn event
    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let burn_event = events.get(0).unwrap();

    // Check topics
    let burn_topics = burn_event.1;
    assert_eq!(
        burn_topics,
        vec![&env, Symbol::new(&env, "burn")].into_val(&env)
    );

    // Check event data
    let burn_data = burn_event.2;
    let burn_data_map: soroban_sdk::Map<Symbol, Val> =
        soroban_sdk::Map::try_from_val(&env, &burn_data).unwrap();

    let expected_burn_data: soroban_sdk::Map<Symbol, Val> = soroban_sdk::Map::from_array(
        &env,
        [
            (Symbol::new(&env, "from"), user.clone().into_val(&env)),
            (Symbol::new(&env, "to"), zero_address.into_val(&env)),
            (Symbol::new(&env, "amount"), BURN_AMOUNT.into_val(&env)),
        ],
    );

    assert_eq!(burn_data_map, expected_burn_data);
}

#[test]
fn test_approve_event() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&owner, &MINT_AMOUNT);

    let expiration_ledger = env.ledger().sequence() + 100;
    client.approve(&owner, &spender, &ALLOWANCE_AMOUNT, &expiration_ledger);

    // Get only the approve event
    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let approve_event = events.get(0).unwrap();

    // Check topics
    let approve_topics = approve_event.1;
    assert_eq!(
        approve_topics,
        vec![&env, Symbol::new(&env, "approve")].into_val(&env)
    );

    // Check event data
    let approve_data = approve_event.2;
    let approve_data_map: soroban_sdk::Map<Symbol, Val> =
        soroban_sdk::Map::try_from_val(&env, &approve_data).unwrap();

    let expected_approve_data: soroban_sdk::Map<Symbol, Val> = soroban_sdk::Map::from_array(
        &env,
        [
            (Symbol::new(&env, "from"), owner.clone().into_val(&env)),
            (Symbol::new(&env, "spender"), spender.clone().into_val(&env)),
            (Symbol::new(&env, "amount"), ALLOWANCE_AMOUNT.into_val(&env)),
            (
                Symbol::new(&env, "expiration_ledger"),
                expiration_ledger.into_val(&env),
            ),
        ],
    );

    assert_eq!(approve_data_map, expected_approve_data);
}

#[test]
fn test_complete_workflow() {
    let env = Env::default();
    let (_admin, client) = create_token_contract(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    // Mint tokens to user1
    client.mint(&user1, &MINT_AMOUNT);

    // Transfer tokens from user1 to user2
    client.transfer(&user1, &user2, &TRANSFER_AMOUNT);

    // Burn tokens from user2
    client.burn(&user2, &BURN_AMOUNT);

    // Verify final balances
    assert_eq!(client.balance(&user1), MINT_AMOUNT - TRANSFER_AMOUNT);
    assert_eq!(client.balance(&user2), TRANSFER_AMOUNT - BURN_AMOUNT);
    assert_eq!(client.total_supply(), MINT_AMOUNT - BURN_AMOUNT);

    // Note: Events are cleared after each operation in this test env
}
