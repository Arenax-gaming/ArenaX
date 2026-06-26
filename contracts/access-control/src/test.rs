#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Env};

#[test]
fn test_access_control_workflow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let contract_id = env.register(AccessControl, ());
    let client = AccessControlClient::new(&env, &contract_id);

    // Initialize
    client.initialize(&admin);
    assert_eq!(client.get_admin(), admin);

    // Verify Admin has ROLE_ADMIN and ROLE_OPERATOR (due to admin override)
    assert!(client.has_role(&admin, &ROLE_ADMIN));
    assert!(client.has_role(&admin, &ROLE_OPERATOR));

    // User1 should not have ROLE_OPERATOR initially
    assert!(!client.has_role(&user1, &ROLE_OPERATOR));

    // Grant role
    client.grant_role(&user1, &ROLE_OPERATOR);
    assert!(client.has_role(&user1, &ROLE_OPERATOR));

    // Delegate role
    // env.ledger().set_timestamp(100);
    client.delegate_role(&user1, &user2, &ROLE_OPERATOR, &100);
    
    // Delegation is active
    assert!(client.is_delegation_active(&user1, &user2, &ROLE_OPERATOR));
    assert!(client.has_delegated_role(&user1, &user2, &ROLE_OPERATOR));

    // Advance time to expire delegation
    env.ledger().with_mut(|l| l.timestamp = 200);
    assert!(!client.is_delegation_active(&user1, &user2, &ROLE_OPERATOR));

    // Revoke role
    client.revoke_role(&user1, &ROLE_OPERATOR);
    assert!(!client.has_role(&user1, &ROLE_OPERATOR));
}

#[test]
fn test_batch_role_check() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let contract_id = env.register(AccessControl, ());
    let client = AccessControlClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.grant_role(&user1, &ROLE_GOVERNANCE);

    let mut accounts = Vec::new(&env);
    accounts.push_back(user1.clone());
    accounts.push_back(user2.clone());

    let mut roles = Vec::new(&env);
    roles.push_back(ROLE_GOVERNANCE);
    roles.push_back(ROLE_GOVERNANCE);

    let results = client.batch_has_roles(&accounts, &roles);
    assert_eq!(results.get(0).unwrap(), true);
    assert_eq!(results.get(1).unwrap(), false);
}
