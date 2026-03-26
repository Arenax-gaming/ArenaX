#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env,
};

fn create_test_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    (env, admin, user1, user2)
}

fn initialize_contract(env: &Env, admin: &Address) -> Address {
    let contract_id = Address::generate(env);
    env.register_contract(&contract_id, AxToken);
    let client = AxTokenClient::new(env, &contract_id);
    client.initialize(admin);
    contract_id
}

#[test]
fn test_initialization() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.total_supply(), 0);
    assert_eq!(client.balance(&user1), 0);
    assert_eq!(client.balance(&user2), 0);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialization() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    client.initialize(&admin);
}

#[test]
fn test_mint() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, 1000);
    assert_eq!(client.balance(&user1), 1000);
    assert_eq!(client.total_supply(), 1000);

    client.mint(&user2, 500);
    assert_eq!(client.balance(&user2), 500);
    assert_eq!(client.total_supply(), 1500);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_mint_zero_amount() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.mint(&user1, 0);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_mint_negative_amount() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.mint(&user1, -100);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_mint_unauthorized() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    client.mint(&user1, 1000);
}

#[test]
fn test_burn() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, 1000);
    assert_eq!(client.balance(&user1), 1000);
    assert_eq!(client.total_supply(), 1000);

    client.burn(&user1, 300);
    assert_eq!(client.balance(&user1), 700);
    assert_eq!(client.total_supply(), 700);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_burn_insufficient_balance() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, 1000);
    client.burn(&user1, 1500);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_burn_zero_amount() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, 1000);
    client.burn(&user1, 0);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_burn_unauthorized() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.mint(&user1, 1000);

    client.burn(&user1, 100);
}

#[test]
fn test_transfer() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, 1000);
    client.mint(&user2, 500);

    client.transfer(&user1, &user2, 300);
    assert_eq!(client.balance(&user1), 700);
    assert_eq!(client.balance(&user2), 800);
    assert_eq!(client.total_supply(), 1500);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_transfer_insufficient_balance() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, 1000);
    client.transfer(&user1, &user2, 1500);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_transfer_zero_amount() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, 1000);
    client.transfer(&user1, &user2, 0);
}

#[test]
#[should_panic(expected = "cannot transfer to self")]
fn test_transfer_to_self() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, 1000);
    client.transfer(&user1, &user1, 100);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_transfer_unauthorized() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, 1000);
    client.mint(&user2, 500);

    client.transfer(&user1, &user2, 100);
}

#[test]
fn test_set_admin() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    assert_eq!(client.get_admin(), admin);
    client.set_admin(&user1);
    assert_eq!(client.get_admin(), user1);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_set_admin_unauthorized() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    client.set_admin(&user1);
}

#[test]
fn test_full_lifecycle() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, 1000);
    client.mint(&user2, 1000);
    assert_eq!(client.total_supply(), 2000);

    client.transfer(&user1, &user2, 300);
    assert_eq!(client.balance(&user1), 700);
    assert_eq!(client.balance(&user2), 1300);

    client.burn(&user1, 200);
    client.burn(&user2, 400);
    assert_eq!(client.balance(&user1), 500);
    assert_eq!(client.balance(&user2), 900);
    assert_eq!(client.total_supply(), 1400);
}

#[test]
fn test_large_amounts() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    let large_amount = i128::MAX / 4;
    client.mint(&user1, large_amount);
    client.mint(&user2, large_amount);

    assert_eq!(client.total_supply(), large_amount * 2);
    assert_eq!(client.balance(&user1), large_amount);
    assert_eq!(client.balance(&user2), large_amount);

    client.transfer(&user1, &user2, large_amount / 2);
    assert_eq!(client.balance(&user1), large_amount / 2);
    assert_eq!(client.balance(&user2), large_amount * 3 / 2);
}

#[test]
fn test_multiple_users() {
    let (env, admin, user1, user2) = create_test_env();
    let user3 = Address::generate(&env);
    let user4 = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    let users = vec![user1.clone(), user2.clone(), user3.clone(), user4.clone()];
    let amounts = vec![1000, 2000, 3000, 4000];

    for (i, user) in users.iter().enumerate() {
        client.mint(user, amounts[i]);
    }

    assert_eq!(client.total_supply(), 10000);

    client.transfer(&user1, &user2, 500);
    client.transfer(&user3, &user4, 1000);

    assert_eq!(client.balance(&user1), 500);
    assert_eq!(client.balance(&user2), 2500);
    assert_eq!(client.balance(&user3), 2000);
    assert_eq!(client.balance(&user4), 5000);
    assert_eq!(client.total_supply(), 10000);
}
