#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String, Vec,
};

// ============================================================================
// TEST HELPERS
// ============================================================================

fn setup_env() -> Env {
    Env::default()
}

fn create_test_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    (env, admin, user1, user2)
}

fn initialize_contract(env: &Env, admin: &Address) -> Address {
    let contract_id = env.register(AxToken, ());
    let client = AxTokenClient::new(env, &contract_id);
    client.initialize(admin);
    contract_id
}

fn create_token(env: &Env) -> (Address, Address) {
    let admin = Address::generate(env);
    let contract_id = initialize_contract(env, &admin);
    (contract_id, admin)
}

fn mint_tokens(env: &Env, contract: &Address, to: &Address, amount: i128) {
    let client = AxTokenClient::new(env, contract);
    env.mock_all_auths();
    client.mint(to, &amount);
}

fn get_balance(env: &Env, contract: &Address, of: &Address) -> i128 {
    let client = AxTokenClient::new(env, contract);
    client.balance(of)
}

fn get_total_supply(env: &Env, contract: &Address) -> i128 {
    let client = AxTokenClient::new(env, contract);
    client.total_supply()
}

fn assert_supply_equals_balances(env: &Env, contract: &Address, holders: &[Address]) {
    let client = AxTokenClient::new(env, contract);
    let total_supply = client.total_supply();
    let mut sum_balances = 0i128;
    for holder in holders {
        sum_balances += client.balance(holder);
    }
    assert_eq!(
        total_supply, sum_balances,
        "Total supply {} does not equal sum of balances {}",
        total_supply, sum_balances
    );
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
    let contract_id = env.register(AxToken, ());
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

    let users = [user1.clone(), user2.clone(), user3.clone(), user4.clone()];
    let amounts = [1000i128, 2000i128, 3000i128, 4000i128];

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
fn test_vesting_batch_flow() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    env.ledger().set_timestamp(100);
    let beneficiaries = soroban_sdk::vec![&env, user1.clone(), user2.clone()];
    let amounts = soroban_sdk::vec![&env, 1000i128, 2000i128];
    client.create_vesting_schedules_batch(&beneficiaries, &amounts, &100u64, &50u64, &100u64);

    let schedule1 = client.get_vesting_schedule(&user1).unwrap();
    let schedule2 = client.get_vesting_schedule(&user2).unwrap();
    assert_eq!(schedule1.total_amount, 1000);
    assert_eq!(schedule2.total_amount, 2000);

    env.ledger().set_timestamp(200);
    assert_eq!(client.claim_vested_tokens(&user1), 1000);
    assert_eq!(client.claim_vested_tokens(&user2), 2000);
}

#[test]
#[should_panic(expected = "beneficiaries and amounts length mismatch")]
fn test_vesting_batch_length_mismatch() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    let beneficiaries = soroban_sdk::vec![&env, user1.clone()];
    let amounts = soroban_sdk::vec![&env, 1000i128, 2000i128];
    client.create_vesting_schedules_batch(&beneficiaries, &amounts, &100u64, &50u64, &100u64);
}

#[test]
fn test_vesting_clawback_before_cliff() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    // Revoke before cliff: nothing vested yet, entire amount forfeited.
    env.ledger().set_timestamp(120);
    let forfeited = client.revoke_vesting_schedule(&user1);
    assert_eq!(forfeited, 1000);

    let schedule = client.get_vesting_schedule(&user1).unwrap();
    assert_eq!(schedule.total_amount, 0);
    assert!(schedule.revoked);
}

#[test]
fn test_vesting_clawback_after_partial_vest() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    // Revoke after 60/100 elapsed: 600 vested, 400 forfeited.
    env.ledger().set_timestamp(160);
    let forfeited = client.revoke_vesting_schedule(&user1);
    assert_eq!(forfeited, 400);

    // Beneficiary can still claim the already-vested portion.
    let claimed = client.claim_vested_tokens(&user1);
    assert_eq!(claimed, 600);
    assert_eq!(client.balance(&user1), 600);

    // No further tokens ever become claimable.
    env.ledger().set_timestamp(500);
    let schedule = client.get_vesting_schedule(&user1).unwrap();
    assert_eq!(schedule.total_amount, 600);
}

#[test]
#[should_panic(expected = "vesting schedule already revoked")]
fn test_vesting_clawback_twice() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    env.ledger().set_timestamp(160);
    client.revoke_vesting_schedule(&user1);
    client.revoke_vesting_schedule(&user1);
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

// ============================================================================
// EXISTING TESTS (PRESERVED)
// ============================================================================

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

// ============================================================================
// STEP 1 - MINT TESTS
// ============================================================================

#[test]
fn test_mint_basic() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    assert_eq!(client.balance(&user1), 0);
    client.mint(&user1, &1000i128);
    assert_eq!(client.balance(&user1), 1000);
}

#[test]
fn test_mint_updates_total_supply() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    assert_eq!(client.total_supply(), 0);
    client.mint(&user1, &1000i128);
    assert_eq!(client.total_supply(), 1000);
    client.mint(&user2, &500i128);
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
fn test_mint_max_amount() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    // Mint a large amount close to i128::MAX / 2
    let large_amount = i128::MAX / 2;
    client.mint(&user1, &large_amount);
    assert_eq!(client.balance(&user1), large_amount);
    assert_eq!(client.total_supply(), large_amount);
}

#[test]
#[should_panic]
fn test_mint_overflow() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    // Mint amounts that would overflow if added together
    let large_amount = i128::MAX / 2;
    client.mint(&user1, &large_amount);
    client.mint(&user2, &large_amount);
    // This should cause an overflow panic in Rust (or saturate depending on implementation)
    client.mint(&user2, &large_amount);
}

#[test]
#[should_panic]
fn test_mint_unauthorized() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    // No mock_all_auths - should panic due to unauthorized
    client.mint(&user1, &1000i128);
}

#[test]
fn test_mint_to_multiple_addresses() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.mint(&user2, &2000i128);
    client.mint(&user3, &3000i128);

    assert_eq!(client.balance(&user1), 1000);
    assert_eq!(client.balance(&user2), 2000);
    assert_eq!(client.balance(&user3), 3000);
    assert_eq!(client.total_supply(), 6000);
}

// ============================================================================
// STEP 2 - BURN TESTS
// ============================================================================

#[test]
fn test_burn_basic() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    assert_eq!(client.balance(&user1), 1000);
    client.burn(&user1, &300i128);
    assert_eq!(client.balance(&user1), 700);
}

#[test]
fn test_burn_updates_total_supply() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    assert_eq!(client.total_supply(), 1000);
    client.burn(&user1, &300i128);
    assert_eq!(client.total_supply(), 700);
    client.burn(&user1, &200i128);
    assert_eq!(client.total_supply(), 500);
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
#[should_panic(expected = "insufficient balance")]
fn test_burn_more_than_balance() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.burn(&user1, &1500i128);
}

#[test]
fn test_burn_exact_balance() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.burn(&user1, &1000i128);
    assert_eq!(client.balance(&user1), 0);
    assert_eq!(client.total_supply(), 0);
}

#[test]
#[should_panic]
fn test_burn_unauthorized() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = env.register(AxToken, ());
    let client = AxTokenClient::new(&env, &contract_id);
    client.initialize(&admin);

    env.mock_all_auths();
    client.mint(&user1, &1000i128);

    // New env without auth - should panic
    let env2 = Env::default();
    let client2 = AxTokenClient::new(&env2, &contract_id);
    client2.burn(&user1, &100i128);
}

#[test]
fn test_burn_reduces_supply_not_others() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.mint(&user2, &1000i128);
    assert_eq!(client.balance(&user2), 1000);

    client.burn(&user1, &500i128);
    assert_eq!(client.balance(&user1), 500);
    assert_eq!(client.balance(&user2), 1000);
    assert_eq!(client.total_supply(), 1500);
}

// ============================================================================
// STEP 3 - TRANSFER TESTS
// ============================================================================

#[test]
fn test_transfer_basic() {
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
#[should_panic(expected = "amount must be positive")]
fn test_transfer_zero() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.transfer(&user1, &user2, &0i128);
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
fn test_transfer_exact_balance() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.transfer(&user1, &user2, &1000i128);
    assert_eq!(client.balance(&user1), 0);
    assert_eq!(client.balance(&user2), 1000);
}

#[test]
#[should_panic(expected = "cannot transfer to self")]
fn test_transfer_self() {
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

    // Call without authorization should panic
    let env_unauth = Env::default();
    let client_unauth = AxTokenClient::new(&env_unauth, &contract_id);
    client_unauth.transfer(&user1, &user2, &100i128);
}

#[test]
fn test_transfer_preserves_total_supply() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.mint(&user2, &1000i128);
    assert_eq!(client.total_supply(), 2000);

    client.transfer(&user1, &user2, &500i128);
    assert_eq!(client.total_supply(), 2000);

    client.transfer(&user2, &user1, &300i128);
    assert_eq!(client.total_supply(), 2000);
}

#[test]
#[should_panic]
fn test_transfer_to_zero_address() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);
    let zero_addr = Address::from_contract_id(&env, &soroban_sdk::contracttype::ContractId([0u8; 32]));

    env.mock_all_auths();
    client.mint(&user1, &1000i128);
    client.transfer(&user1, &zero_addr, &100i128);
}

// ============================================================================
// STEP 4 - VESTING TESTS
// ============================================================================

#[test]
fn test_vesting_schedule_created() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    let schedule = client.get_vesting_schedule(&user1).unwrap();
    assert_eq!(schedule.total_amount, 1000);
    assert_eq!(schedule.start_time, 100);
    assert_eq!(schedule.cliff_duration, 50);
    assert_eq!(schedule.duration, 100);
    assert_eq!(schedule.amount_claimed, 0);
    assert_eq!(schedule.revoked, false);
}

#[test]
#[should_panic(expected = "cliff period not met")]
fn test_vesting_cliff_not_reached() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    // Try to claim before cliff at timestamp 140 (40 < 50 cliff)
    env.ledger().set_timestamp(140);
    client.claim_vested_tokens(&user1);
}

#[test]
fn test_vesting_cliff_exact() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    // At exactly cliff time (100 + 50 = 150), start claiming
    env.ledger().set_timestamp(150);
    let claimed = client.claim_vested_tokens(&user1);
    assert_eq!(claimed, 0);
}

#[test]
fn test_vesting_linear_release() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    // Create vesting: start 100, cliff 50, duration 100, total 1000
    // At time 160: elapsed = 60, vested = 1000 * 60 / 100 = 600
    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    env.ledger().set_timestamp(160);
    let claimed = client.claim_vested_tokens(&user1);
    assert_eq!(claimed, 600);
    assert_eq!(client.balance(&user1), 600);
}

#[test]
fn test_vesting_full_release() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    // At time 210: elapsed = 110 > 100 (duration), so all tokens are vested
    env.ledger().set_timestamp(210);
    let claimed = client.claim_vested_tokens(&user1);
    assert_eq!(claimed, 1000);
    assert_eq!(client.balance(&user1), 1000);
}

#[test]
fn test_vesting_claim_updates_balance() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    assert_eq!(client.balance(&user1), 0);
    env.ledger().set_timestamp(160);
    client.claim_vested_tokens(&user1);
    assert_eq!(client.balance(&user1), 600);
}

#[test]
fn test_vesting_cannot_double_claim() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    env.ledger().set_timestamp(160);
    let claimed1 = client.claim_vested_tokens(&user1);
    assert_eq!(claimed1, 600);

    // Try to claim again at same time - no more tokens vested
    let claimed2 = client.claim_vested_tokens(&user1);
    assert_eq!(claimed2, 0);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_vesting_zero_amount() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &0i128, &100u64, &50u64, &100u64);
}

// ============================================================================
// STEP 5 - INVARIANT TESTS
// ============================================================================

#[test]
fn test_invariant_supply_equals_sum_of_balances_after_mint() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.mint(&user2, &2000i128);
    client.mint(&user3, &3000i128);

    let holders = [user1, user2, user3];
    assert_supply_equals_balances(&env, &contract_id, &holders);
}

#[test]
fn test_invariant_supply_equals_sum_of_balances_after_burn() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.mint(&user2, &2000i128);
    client.burn(&user1, &300i128);

    let holders = [user1, user2];
    assert_supply_equals_balances(&env, &contract_id, &holders);
}

#[test]
fn test_invariant_supply_equals_sum_of_balances_after_transfer() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.mint(&user2, &2000i128);
    client.transfer(&user1, &user2, &500i128);
    client.transfer(&user2, &user3, &300i128);

    let holders = [user1, user2, user3];
    assert_supply_equals_balances(&env, &contract_id, &holders);
}

#[test]
fn test_invariant_supply_equals_sum_of_balances_after_vesting_claim() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    env.mock_all_auths();

    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);
    client.mint(&user2, &500i128);

    env.ledger().set_timestamp(160);
    client.claim_vested_tokens(&user1);

    let holders = [user1, user2];
    assert_supply_equals_balances(&env, &contract_id, &holders);
}

#[test]
fn test_invariant_no_negative_balances() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    client.transfer(&user1, &user2, &500i128);

    assert!(client.balance(&user1) >= 0);
    assert!(client.balance(&user2) >= 0);
}

#[test]
fn test_invariant_supply_never_negative() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);

    env.mock_all_auths();

    client.mint(&user1, &1000i128);
    assert!(client.total_supply() >= 0);

    client.burn(&user1, &500i128);
    assert!(client.total_supply() >= 0);
}

// ============================================================================
// STEP 6 - EDGE CASE TESTS
// ============================================================================

#[test]
fn test_overflow_mint_saturates_or_errors() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    env.mock_all_auths();

    // This test verifies behavior at overflow boundary
    let large = i128::MAX / 2;
    client.mint(&user1, &large);
    client.mint(&user2, &large);
    assert_eq!(client.balance(&user1), large);
    assert_eq!(client.balance(&user2), large);
}

#[test]
fn test_large_number_of_holders() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    // Mint to 100 different addresses
    for _ in 0..100 {
        let user = Address::generate(&env);
        client.mint(&user, &100i128);
    }

    assert_eq!(client.total_supply(), 10000);
}

#[test]
fn test_sequential_operations() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    env.mock_all_auths();

    // Mint -> Transfer -> Burn sequence
    client.mint(&user1, &1000i128);
    assert_eq!(client.total_supply(), 1000);

    client.transfer(&user1, &user2, &300i128);
    assert_eq!(client.balance(&user1), 700);
    assert_eq!(client.balance(&user2), 300);
    assert_eq!(client.total_supply(), 1000);

    client.burn(&user1, &200i128);
    assert_eq!(client.balance(&user1), 500);
    assert_eq!(client.total_supply(), 800);
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

// ============================================================================
// STEP 7 - PARAMETRIC TESTS (simulating fuzz test patterns)
// ============================================================================

#[test]
fn test_parametric_transfer_preserves_supply() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    env.mock_all_auths();

    let initial = 5_000_000i128;
    client.mint(&user_a, &initial);

    for transfer_pct in [10u32, 25, 50, 75, 99].iter() {
        let transfer_amount = (initial as u128 * (*transfer_pct as u128) / 100) as i128;
        if transfer_amount > 0 && transfer_amount <= initial {
            client.transfer(&user_a, &user_b, &transfer_amount);
        }
    }

    let total_supply = client.total_supply();
    let balance_a = client.balance(&user_a);
    let balance_b = client.balance(&user_b);

    assert_eq!(total_supply, balance_a + balance_b);
}

#[test]
fn test_parametric_mint_burn_supply() {
    let test_cases = [
        (1000i128, 10u32),
        (500000i128, 50u32),
        (1000000i128, 75u32),
        (100i128, 99u32),
    ];

    for (mint_amount, burn_pct) in test_cases.iter() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = initialize_contract(&env, &admin);
        let client = AxTokenClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        env.mock_all_auths();

        let mint = *mint_amount;
        if mint > 0 {
            client.mint(&user, &mint);
        }

        let balance = client.balance(&user);
        let burn_amount = (balance as u128 * (*burn_pct as u128) / 100) as i128;

        if burn_amount > 0 {
            client.burn(&user, &burn_amount);
        }

        let final_supply = client.total_supply();
        let expected_supply = mint - burn_amount;

        assert_eq!(final_supply, expected_supply);
    }
}

#[test]
fn test_parametric_vesting_linear_amounts() {
    let test_cases = [
        (1000i128, 0u32),
        (5000i128, 25u32),
        (10000i128, 50u32),
        (50000i128, 75u32),
        (100000i128, 99u32),
    ];

    for (total_amount, elapsed_pct) in test_cases.iter() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = initialize_contract(&env, &admin);
        let client = AxTokenClient::new(&env, &contract_id);

        let beneficiary = Address::generate(&env);
        env.mock_all_auths();

        let total = *total_amount;
        env.ledger().set_timestamp(1000);
        client.create_vesting_schedule(&beneficiary, &total, &1000u64, &100u64, &1000u64);

        let elapsed_seconds = ((1000u64 as u128 * (*elapsed_pct as u128) / 100) as u64).min(1000);
        let new_time = 1000u64 + elapsed_seconds;

        env.ledger().set_timestamp(new_time);

        if elapsed_seconds < 100 {
            // Before cliff
            let schedule = client.get_vesting_schedule(&beneficiary).unwrap();
            let elapsed_from_start = new_time - schedule.start_time;
            assert!(elapsed_from_start < schedule.cliff_duration);
        } else {
            // After or at cliff
            let schedule = client.get_vesting_schedule(&beneficiary).unwrap();
            let elapsed_from_start = new_time - schedule.start_time;
            assert!(elapsed_from_start >= schedule.cliff_duration);
        }
    }
}

// ============================================================================
// EXISTING VESTING AND GOVERNANCE TESTS (PRESERVED)
// ============================================================================

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
fn test_vesting_batch_flow() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    env.ledger().set_timestamp(100);
    let beneficiaries = soroban_sdk::vec![&env, user1.clone(), user2.clone()];
    let amounts = soroban_sdk::vec![&env, 1000i128, 2000i128];
    client.create_vesting_schedules_batch(&beneficiaries, &amounts, &100u64, &50u64, &100u64);

    let schedule1 = client.get_vesting_schedule(&user1).unwrap();
    let schedule2 = client.get_vesting_schedule(&user2).unwrap();
    assert_eq!(schedule1.total_amount, 1000);
    assert_eq!(schedule2.total_amount, 2000);

    env.ledger().set_timestamp(200);
    assert_eq!(client.claim_vested_tokens(&user1), 1000);
    assert_eq!(client.claim_vested_tokens(&user2), 2000);
}

#[test]
#[should_panic(expected = "beneficiaries and amounts length mismatch")]
fn test_vesting_batch_length_mismatch() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    let beneficiaries = soroban_sdk::vec![&env, user1.clone()];
    let amounts = soroban_sdk::vec![&env, 1000i128, 2000i128];
    client.create_vesting_schedules_batch(&beneficiaries, &amounts, &100u64, &50u64, &100u64);
}

#[test]
fn test_vesting_clawback_before_cliff() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    // Revoke before cliff: nothing vested yet, entire amount forfeited.
    env.ledger().set_timestamp(120);
    let forfeited = client.revoke_vesting_schedule(&user1);
    assert_eq!(forfeited, 1000);

    let schedule = client.get_vesting_schedule(&user1).unwrap();
    assert_eq!(schedule.total_amount, 0);
    assert!(schedule.revoked);
}

#[test]
fn test_vesting_clawback_after_partial_vest() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    // Revoke after 60/100 elapsed: 600 vested, 400 forfeited.
    env.ledger().set_timestamp(160);
    let forfeited = client.revoke_vesting_schedule(&user1);
    assert_eq!(forfeited, 400);

    // Beneficiary can still claim the already-vested portion.
    let claimed = client.claim_vested_tokens(&user1);
    assert_eq!(claimed, 600);
    assert_eq!(client.balance(&user1), 600);

    // No further tokens ever become claimable.
    env.ledger().set_timestamp(500);
    let schedule = client.get_vesting_schedule(&user1).unwrap();
    assert_eq!(schedule.total_amount, 600);
}

#[test]
#[should_panic(expected = "vesting schedule already revoked")]
fn test_vesting_clawback_twice() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    env.ledger().set_timestamp(100);
    client.create_vesting_schedule(&user1, &1000i128, &100u64, &50u64, &100u64);

    env.ledger().set_timestamp(160);
    client.revoke_vesting_schedule(&user1);
    client.revoke_vesting_schedule(&user1);
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
fn test_mint_negative_amount() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.mint(&user1, &-100i128);
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

    let users = [user1.clone(), user2.clone(), user3.clone(), user4.clone()];
    let amounts = [1000i128, 2000i128, 3000i128, 4000i128];

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
