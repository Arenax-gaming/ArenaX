#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};
use composable_example::{ComposableExample, ComposableExampleClient};

#[test]
fn test_composable_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let contract_id = env.register(ComposableExample, ());
    let client = ComposableExampleClient::new(&env, &contract_id);

    // Initialize
    client.initialize(&owner);

    // Check initial state
    assert_eq!(client.owner(), owner);
    assert_eq!(client.get_counter(), 0);
    assert!(!client.is_paused());

    // Test increment/decrement
    assert_eq!(client.increment(), 1);
    assert_eq!(client.increment(), 2);
    assert_eq!(client.decrement(), 1);
    assert_eq!(client.get_counter(), 1);

    // Test pause
    client.set_paused(&true);
    assert!(client.is_paused());

    // Test pause blocks operations
    let result = std::panic::catch_unwind(|| client.increment());
    assert!(result.is_err());

    // Test unpause
    client.set_paused(&false);
    assert!(!client.is_paused());

    // Test transfer ownership
    let new_owner = Address::generate(&env);
    client.transfer_ownership(&new_owner);
    assert_eq!(client.owner(), new_owner);
}

// Test composition with access-control
#[test]
fn test_contract_composition_with_access_control() {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy access-control contract
    let access_admin = Address::generate(&env);
    let access_id = env.register(access_control::AccessControl, ());
    let access_client = access_control::AccessControlClient::new(&env, &access_id);
    access_client.initialize(&access_admin);

    // Grant operator role to test user
    let operator = Address::generate(&env);
    access_client.grant_role(&operator, &3); // ROLE_OPERATOR

    // Deploy composable example contract
    let owner = Address::generate(&env);
    let example_id = env.register(ComposableExample, ());
    let example_client = ComposableExampleClient::new(&env, &example_id);
    example_client.initialize(&owner);

    // Verify composition works (both contracts deployed independently)
    assert_eq!(access_client.has_role(&operator, &3), true);
    assert_eq!(example_client.get_counter(), 0);
}
