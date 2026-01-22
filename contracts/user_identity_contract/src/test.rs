#![cfg(test)]
use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Env, IntoVal};

#[test]
fn test_initialize_and_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(UserIdentityContract, ());
    let client = UserIdentityContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);

    assert_eq!(client.get_role(&user), 0);
    assert!(client.has_role(&user, &0));

    client.assign_role(&user, &1);
    assert_eq!(client.get_role(&user), 1);
    assert!(client.has_role(&user, &1));
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize() {
    let env = Env::default();
    let contract_id = env.register(UserIdentityContract, ());
    let client = UserIdentityContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.initialize(&admin);
}

#[test]
#[should_panic(expected = "invalid role")]
fn test_invalid_role() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(UserIdentityContract, ());
    let client = UserIdentityContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);
    client.assign_role(&user, &4);
}
