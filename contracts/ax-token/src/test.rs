#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

// Test helper to create a new contract instance
fn create_token_contract<'a>(env: &Env) -> (AxTokenClient<'a>, Address, Address, Address) {
    let contract_id = env.register(AxToken, ());
    let client = AxTokenClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let user = Address::generate(env);

    (client, admin, treasury, user)
}

// ============================================================================
// Initialization Tests
// ============================================================================

#[test]
fn test_initialize() {
    let env = Env::default();
    let (client, admin, treasury, _) = create_token_contract(&env);

    let max_supply = 1_000_000_000 * 10_000_000i128; // 1 billion tokens

    env.mock_all_auths();
    client.initialize(&admin, &max_supply, &treasury);

    // Verify initialization
    assert_eq!(client.admin(), admin);
    assert_eq!(client.treasury(), treasury);
    assert_eq!(client.max_supply(), max_supply);
    assert_eq!(client.total_supply(), 0);

    // Verify token info
    let info = client.token_info();
    assert_eq!(info.name, String::from_str(&env, "ArenaX Token"));
    assert_eq!(info.symbol, String::from_str(&env, "AX"));
    assert_eq!(info.decimals, 7);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_fails() {
    let env = Env::default();
    let (client, admin, treasury, _) = create_token_contract(&env);

    let max_supply = 1_000_000_000 * 10_000_000i128;

    env.mock_all_auths();
    client.initialize(&admin, &max_supply, &treasury);
    client.initialize(&admin, &max_supply, &treasury); // Should panic
}

#[test]
#[should_panic(expected = "max supply must be positive")]
fn test_initialize_with_zero_max_supply_fails() {
    let env = Env::default();
    let (client, admin, treasury, _) = create_token_contract(&env);

    env.mock_all_auths();
    client.initialize(&admin, &0, &treasury); // Should panic
}

// ============================================================================
// Minting Tests
// ============================================================================

#[test]
fn test_mint() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user) = create_token_contract(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 100 * 10_000_000i128; // 100 tokens
    client.mint(&user, &mint_amount);

    assert_eq!(client.balance(&user), mint_amount);
    assert_eq!(client.total_supply(), mint_amount);
}

#[test]
fn test_mint_multiple_times() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user) = create_token_contract(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 50 * 10_000_000i128;
    client.mint(&user, &mint_amount);
    client.mint(&user, &mint_amount);

    assert_eq!(client.balance(&user), mint_amount * 2);
    assert_eq!(client.total_supply(), mint_amount * 2);
}

#[test]
#[should_panic(expected = "minting would exceed max supply")]
fn test_mint_exceeds_max_supply() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user) = create_token_contract(&env);
    let max_supply = 1000 * 10_000_000i128; // 1000 tokens

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 1001 * 10_000_000i128; // Try to mint 1001 tokens
    client.mint(&user, &mint_amount); // Should panic
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_mint_zero_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user) = create_token_contract(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);
    client.mint(&user, &0); // Should panic
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_mint_negative_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user) = create_token_contract(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);
    client.mint(&user, &-100); // Should panic
}

// ============================================================================
// Burning Tests
// ============================================================================

#[test]
fn test_burn() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user) = create_token_contract(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 100 * 10_000_000i128;
    client.mint(&user, &mint_amount);

    let burn_amount = 30 * 10_000_000i128;
    client.burn(&user, &burn_amount);

    assert_eq!(client.balance(&user), mint_amount - burn_amount);
    assert_eq!(client.total_supply(), mint_amount - burn_amount);
}

#[test]
fn test_burn_entire_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user) = create_token_contract(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 100 * 10_000_000i128;
    client.mint(&user, &mint_amount);
    client.burn(&user, &mint_amount);

    assert_eq!(client.balance(&user), 0);
    assert_eq!(client.total_supply(), 0);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_burn_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user) = create_token_contract(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 50 * 10_000_000i128;
    client.mint(&user, &mint_amount);

    let burn_amount = 100 * 10_000_000i128;
    client.burn(&user, &burn_amount); // Should panic
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_burn_zero_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user) = create_token_contract(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 100 * 10_000_000i128;
    client.mint(&user, &mint_amount);
    client.burn(&user, &0); // Should panic
}

// ============================================================================
// Transfer Tests
// ============================================================================

#[test]
fn test_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user1) = create_token_contract(&env);
    let user2 = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 100 * 10_000_000i128;
    client.mint(&user1, &mint_amount);

    let transfer_amount = 30 * 10_000_000i128;
    client.transfer(&user1, &user2, &transfer_amount);

    assert_eq!(client.balance(&user1), mint_amount - transfer_amount);
    assert_eq!(client.balance(&user2), transfer_amount);
    assert_eq!(client.total_supply(), mint_amount);
}

#[test]
fn test_transfer_entire_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user1) = create_token_contract(&env);
    let user2 = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 100 * 10_000_000i128;
    client.mint(&user1, &mint_amount);
    client.transfer(&user1, &user2, &mint_amount);

    assert_eq!(client.balance(&user1), 0);
    assert_eq!(client.balance(&user2), mint_amount);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_transfer_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user1) = create_token_contract(&env);
    let user2 = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 50 * 10_000_000i128;
    client.mint(&user1, &mint_amount);

    let transfer_amount = 100 * 10_000_000i128;
    client.transfer(&user1, &user2, &transfer_amount); // Should panic
}

#[test]
#[should_panic(expected = "cannot transfer to self")]
fn test_transfer_to_self_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user) = create_token_contract(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 100 * 10_000_000i128;
    client.mint(&user, &mint_amount);
    client.transfer(&user, &user, &mint_amount); // Should panic
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_transfer_zero_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user1) = create_token_contract(&env);
    let user2 = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 100 * 10_000_000i128;
    client.mint(&user1, &mint_amount);
    client.transfer(&user1, &user2, &0); // Should panic
}

// ============================================================================
// Approve and TransferFrom Tests
// ============================================================================

#[test]
fn test_approve() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, owner) = create_token_contract(&env);
    let spender = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let approve_amount = 50 * 10_000_000i128;
    client.approve(&owner, &spender, &approve_amount);

    assert_eq!(client.allowance(&owner, &spender), approve_amount);
}

#[test]
fn test_approve_zero_resets_allowance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, owner) = create_token_contract(&env);
    let spender = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let approve_amount = 50 * 10_000_000i128;
    client.approve(&owner, &spender, &approve_amount);
    client.approve(&owner, &spender, &0);

    assert_eq!(client.allowance(&owner, &spender), 0);
}

#[test]
fn test_transfer_from() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, owner) = create_token_contract(&env);
    let spender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 100 * 10_000_000i128;
    client.mint(&owner, &mint_amount);

    let approve_amount = 50 * 10_000_000i128;
    client.approve(&owner, &spender, &approve_amount);

    let transfer_amount = 30 * 10_000_000i128;
    client.transfer_from(&spender, &owner, &recipient, &transfer_amount);

    assert_eq!(client.balance(&owner), mint_amount - transfer_amount);
    assert_eq!(client.balance(&recipient), transfer_amount);
    assert_eq!(
        client.allowance(&owner, &spender),
        approve_amount - transfer_amount
    );
}

#[test]
#[should_panic(expected = "insufficient allowance")]
fn test_transfer_from_exceeds_allowance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, owner) = create_token_contract(&env);
    let spender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 100 * 10_000_000i128;
    client.mint(&owner, &mint_amount);

    let approve_amount = 30 * 10_000_000i128;
    client.approve(&owner, &spender, &approve_amount);

    let transfer_amount = 50 * 10_000_000i128;
    client.transfer_from(&spender, &owner, &recipient, &transfer_amount); // Should panic
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_transfer_from_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, owner) = create_token_contract(&env);
    let spender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    let mint_amount = 30 * 10_000_000i128;
    client.mint(&owner, &mint_amount);

    let approve_amount = 100 * 10_000_000i128;
    client.approve(&owner, &spender, &approve_amount);

    let transfer_amount = 50 * 10_000_000i128;
    client.transfer_from(&spender, &owner, &recipient, &transfer_amount); // Should panic
}

// ============================================================================
// Admin Tests
// ============================================================================

#[test]
fn test_set_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, _) = create_token_contract(&env);
    let new_admin = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);
    client.set_admin(&new_admin);

    assert_eq!(client.admin(), new_admin);
}

#[test]
fn test_set_treasury() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, _) = create_token_contract(&env);
    let new_treasury = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);
    client.set_treasury(&new_treasury);

    assert_eq!(client.treasury(), new_treasury);
}

// ============================================================================
// Query Function Tests
// ============================================================================

#[test]
fn test_balance_of_non_existent_account() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, _) = create_token_contract(&env);
    let non_existent = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    assert_eq!(client.balance(&non_existent), 0);
}

#[test]
fn test_allowance_of_non_existent_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, owner) = create_token_contract(&env);
    let spender = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    assert_eq!(client.allowance(&owner, &spender), 0);
}

// ============================================================================
// Complex Scenario Tests
// ============================================================================

#[test]
fn test_complex_token_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user1) = create_token_contract(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);
    let max_supply = 1_000_000_000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    // Mint to user1
    let mint_amount = 1000 * 10_000_000i128;
    client.mint(&user1, &mint_amount);

    // User1 transfers to user2
    let transfer_amount = 300 * 10_000_000i128;
    client.transfer(&user1, &user2, &transfer_amount);

    // User1 approves user3 to spend
    let approve_amount = 200 * 10_000_000i128;
    client.approve(&user1, &user3, &approve_amount);

    // User3 transfers from user1 to user2
    let transfer_from_amount = 150 * 10_000_000i128;
    client.transfer_from(&user3, &user1, &user2, &transfer_from_amount);

    // User2 burns some tokens
    let burn_amount = 100 * 10_000_000i128;
    client.burn(&user2, &burn_amount);

    // Verify final balances
    assert_eq!(
        client.balance(&user1),
        mint_amount - transfer_amount - transfer_from_amount
    );
    assert_eq!(
        client.balance(&user2),
        transfer_amount + transfer_from_amount - burn_amount
    );
    assert_eq!(client.balance(&user3), 0);
    assert_eq!(
        client.total_supply(),
        mint_amount - burn_amount
    );
    assert_eq!(
        client.allowance(&user1, &user3),
        approve_amount - transfer_from_amount
    );
}

#[test]
fn test_mint_to_max_supply() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user) = create_token_contract(&env);
    let max_supply = 1000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    // Mint exactly to max supply
    client.mint(&user, &max_supply);

    assert_eq!(client.balance(&user), max_supply);
    assert_eq!(client.total_supply(), max_supply);
}

#[test]
fn test_burn_and_remint() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury, user) = create_token_contract(&env);
    let max_supply = 1000 * 10_000_000i128;

    client.initialize(&admin, &max_supply, &treasury);

    // Mint to max
    client.mint(&user, &max_supply);

    // Burn some
    let burn_amount = 300 * 10_000_000i128;
    client.burn(&user, &burn_amount);

    // Should be able to mint again
    client.mint(&user, &burn_amount);

    assert_eq!(client.balance(&user), max_supply);
    assert_eq!(client.total_supply(), max_supply);
}
