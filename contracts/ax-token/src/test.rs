#![cfg(test)]

extern crate std;
use std::vec;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
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

    client.mint(&user1, &1000i128);
    assert_eq!(client.balance(&user1), 1000);
    assert_eq!(client.total_supply(), 1000);

    client.mint(&user2, &500i128);
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
    client.mint(&user1, &0i128);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_mint_negative_amount() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.mint(&user1, &-100i128);
}

#[test]
#[should_panic]
fn test_mint_unauthorized() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    client.mint(&user1, &1000i128);
}

#[test]
fn test_burn() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    assert_eq!(client.balance(&user1), 1000);
    assert_eq!(client.total_supply(), 1000);

    client.burn(&user1, &300i128);
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

    client.mint(&user1, &1000i128);
    client.burn(&user1, &1500i128);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_burn_zero_amount() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.burn(&user1, &0i128);
}

#[test]
#[should_panic]
fn test_burn_unauthorized() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = Address::generate(&env);
    env.register_contract(&contract_id, AxToken);
    let client = AxTokenClient::new(&env, &contract_id);
    client.initialize(&admin);

    client.burn(&user1, &100i128);
}

#[test]
fn test_transfer() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.mint(&user2, &500i128);

    client.transfer(&user1, &user2, &300i128);
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

    client.mint(&user1, &1000i128);
    client.transfer(&user1, &user2, &1500i128);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_transfer_zero_amount() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.transfer(&user1, &user2, &0i128);
}

#[test]
#[should_panic(expected = "cannot transfer to self")]
fn test_transfer_to_self() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.transfer(&user1, &user1, &100i128);
}

#[test]
#[should_panic]
fn test_transfer_unauthorized() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.mint(&user1, &1000i128);

    // Call without mock_all_auths and without signing should panic
    let env_unauth = Env::default();
    let client_unauth = AxTokenClient::new(&env_unauth, &contract_id);
    client_unauth.transfer(&user1, &user2, &100i128);
}

#[test]
fn test_set_admin() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    assert_eq!(client.get_admin(), admin);
    client.set_admin(&user1);
    assert_eq!(client.get_admin(), user1);
}

#[test]
#[should_panic]
fn test_set_admin_unauthorized() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    // Call without admin authorization should panic
    client.set_admin(&user1);
}

#[test]
fn test_full_lifecycle() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.mint(&user2, &1000i128);
    assert_eq!(client.total_supply(), 2000);

    client.transfer(&user1, &user2, &300i128);
    assert_eq!(client.balance(&user1), 700);
    assert_eq!(client.balance(&user2), 1300);

    client.burn(&user1, &200i128);
    client.burn(&user2, &400i128);
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

    let large_amount = (i128::MAX / 4) / 2 * 2;
    client.mint(&user1, &large_amount);
    client.mint(&user2, &large_amount);

    assert_eq!(client.total_supply(), large_amount * 2);
    assert_eq!(client.balance(&user1), large_amount);
    assert_eq!(client.balance(&user2), large_amount);

    client.transfer(&user1, &user2, &(large_amount / 2));
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
    let amounts = vec![1000i128, 2000i128, 3000i128, 4000i128];

    for (i, user) in users.iter().enumerate() {
        client.mint(user, &amounts[i]);
    }

    assert_eq!(client.total_supply(), 10000);

    client.transfer(&user1, &user2, &500i128);
    client.transfer(&user3, &user4, &1000i128);

    assert_eq!(client.balance(&user1), 500);
    assert_eq!(client.balance(&user2), 2500);
    assert_eq!(client.balance(&user3), 2000);
    assert_eq!(client.balance(&user4), 5000);
    assert_eq!(client.total_supply(), 10000);
}

#[test]
fn test_vesting_flow() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    // Create vesting schedule: start at 100, cliff 50, duration 100, total amount 1000
    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    // Verify schedule
    let schedule = client.get_vesting_schedule(&user1).unwrap();
    assert_eq!(schedule.total_amount, 1000);

    // Claim after cliff (at 160, elapsed since start = 60)
    // Vested: 1000 * 60 / 100 = 600
    env.ledger().set_timestamp(160);
    let claimed = client.claim_vested_tokens(&user1);
    assert_eq!(claimed, 600);
    assert_eq!(client.balance(&user1), 600);

    // Claim remaining after duration (at 210, elapsed = 110 >= 100)
    // Vested: 1000. Claimed already: 600. Remaining: 400.
    env.ledger().set_timestamp(210);
    let claimed2 = client.claim_vested_tokens(&user1);
    assert_eq!(claimed2, 400);
    assert_eq!(client.balance(&user1), 1000);
}

#[test]
#[should_panic(expected = "cliff period not met")]
fn test_vesting_claim_before_cliff() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    env.ledger().set_timestamp(140);
    client.claim_vested_tokens(&user1);
}

#[test]
fn test_locking_flow() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.mint(&user1, &1000i128);

    // Lock 400 tokens until timestamp 500
    env.ledger().set_timestamp(100);
    client.lock_tokens(&user1, &400i128, &500u64);

    assert_eq!(client.balance(&user1), 600);
    assert_eq!(client.get_locked_balance(&user1), 400);
    assert_eq!(client.get_total_locked_supply(), 400);

    // Unlocking after unlock time (at 501)
    env.ledger().set_timestamp(501);
    let unlocked = client.unlock_tokens(&user1);
    assert_eq!(unlocked, 400);
    assert_eq!(client.balance(&user1), 1000);
    assert_eq!(client.get_locked_balance(&user1), 0);
}

#[test]
#[should_panic(expected = "no tokens ready to unlock")]
fn test_unlock_before_unlock_time() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.mint(&user1, &1000i128);

    env.ledger().set_timestamp(100);
    client.lock_tokens(&user1, &400i128, &500u64);

    env.ledger().set_timestamp(400);
    client.unlock_tokens(&user1);
}

#[test]
fn test_governance_flow() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.mint(&user1, &1500i128);
    client.mint(&user2, &500i128);

    // Create a proposal
    env.ledger().set_timestamp(100);
    let proposal_desc = String::from_str(&env, "Improve game matching");
    let proposal_id = client.create_proposal(&user1, &proposal_desc, &3600u64);

    // Vote on proposal
    // user1 votes FOR: voting power = 1500
    client.vote_on_proposal(&user1, &proposal_id, &true);

    // user2 votes AGAINST: voting power = 500
    client.vote_on_proposal(&user2, &proposal_id, &false);

    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert_eq!(proposal.votes_for, 1500);
    assert_eq!(proposal.votes_against, 500);
}
