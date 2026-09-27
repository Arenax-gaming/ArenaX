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

    // Flash-loan guard: a second protected operation by the same address must
    // land in a later ledger sequence (this models a separate transaction).
    env.ledger().set_sequence_number(env.ledger().sequence() + 1);

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

#[test]
fn test_emergency_pause_and_governance_unpause() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.mint(&user1, &1000i128);

    assert!(!client.is_paused());

    // Pause contract
    let reason = soroban_sdk::Symbol::new(&env, "EXPLOIT");
    client.pause(&reason);

    assert!(client.is_paused());

    let pause_info = client.get_pause_info().unwrap();
    assert!(pause_info.paused);
    assert_eq!(pause_info.timeout, 86400);

    // Create governance proposal to unpause
    let proposal_desc = String::from_str(&env, "Unpause Contract");
    let proposal_id = client.create_proposal(&user1, &proposal_desc, &3600u64);
    client.vote_on_proposal(&user1, &proposal_id, &true);

    // Advance time past proposal voting duration
    env.ledger().set_timestamp(3601);

    // Execute unpause via governance
    client.unpause_via_governance(&proposal_id);
    assert!(!client.is_paused());

    // Flash-loan guard: user1 already voted this sequence, so the protected
    // transfer must happen in a later ledger (this models a separate
    // transaction) — same convention as the snapshot-voting tests below.
    env.ledger().set_sequence_number(env.ledger().sequence() + 1);

    // Now transfer should succeed
    client.transfer(&user1, &user2, &200i128);
    assert_eq!(client.balance(&user2), 200);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_transfer_fails_when_paused() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.mint(&user1, &1000i128);

    let reason = soroban_sdk::Symbol::new(&env, "EMERGENCY");
    client.pause(&reason);

    client.transfer(&user1, &user2, &100i128);
}

#[test]
fn test_pause_timeout_expiration() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.mint(&user1, &1000i128);

    env.ledger().set_timestamp(100);
    let reason = soroban_sdk::Symbol::new(&env, "BUG");
    client.pause(&reason);

    assert!(client.is_paused());

    // Advance timestamp beyond 24 hours (86400 seconds + 100)
    env.ledger().set_timestamp(100 + 86400 + 1);

    // Pause should have timed out!
    assert!(!client.is_paused());

    client.transfer(&user1, &user2, &100i128);
    assert_eq!(client.balance(&user2), 100);
}

#[test]
fn test_supply_cap_enforcement_and_burn() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();

    // Set hard supply cap to 2000
    client.set_supply_cap(&2000i128);
    assert_eq!(client.get_supply_cap(), 2000);

    client.mint(&user1, &1500i128);
    assert_eq!(client.total_supply(), 1500);

    // Burn 500 tokens -> cap should decrease by 500 to 1500!
    client.burn(&user1, &500i128);
    assert_eq!(client.total_supply(), 1000);
    assert_eq!(client.get_supply_cap(), 1500);
}

#[test]
#[should_panic(expected = "supply cap exceeded")]
fn test_mint_exceeds_supply_cap() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.set_supply_cap(&1000i128);
    client.mint(&user1, &1001i128);
}

#[test]
fn test_adjust_cap_via_governance() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.set_supply_cap(&1000i128);
    client.mint(&user1, &1000i128);

    // Create proposal to increase cap to 5000
    let proposal_desc = String::from_str(&env, "Increase Cap to 5000");
    let proposal_id = client.create_proposal(&user1, &proposal_desc, &3600u64);
    client.vote_on_proposal(&user1, &proposal_id, &true);

    env.ledger().set_timestamp(3601);
    client.adjust_cap_via_governance(&proposal_id, &5000i128);

    assert_eq!(client.get_supply_cap(), 5000);
    client.mint(&user1, &2000i128);
    assert_eq!(client.total_supply(), 3000);
}

// ============================================================================
// SNAPSHOT VOTING (#919)
// ============================================================================
//
// NOTE: `FlashLoanGuard` (src/flash_loan_protection.rs) treats ledger
// sequence 0 as "no prior operation" and the *first* protected call (burn,
// transfer, or vote_on_proposal) for any address, in any fresh test `Env`,
// also runs at sequence 0 — so it collides with that default and is always
// rejected as a false "flash loan". This is a pre-existing bug, unrelated to
// snapshot voting; every test below advances the ledger sequence to a
// non-zero number before the first such call to avoid tripping it.

#[test]
fn test_snapshot_power_fixed_at_proposal_creation() {
    // Voting power used for a proposal must reflect the balance an address
    // held when the proposal was created, not whatever it holds by the time
    // it actually votes — otherwise a voter could inflate their power after
    // the fact by acquiring more tokens.
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(1_000);
    client.mint(&user1, &1000i128);

    env.ledger().set_sequence_number(101);
    let proposal_desc = String::from_str(&env, "Snapshot test");
    let proposal_id = client.create_proposal(&user1, &proposal_desc, &3600u64);
    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert_eq!(proposal.snapshot_ledger, 101);

    // Balance grows well after the snapshot was taken.
    env.ledger().set_sequence_number(102);
    client.mint(&user1, &5000i128);
    assert_eq!(client.balance(&user1), 6000);

    env.ledger().set_sequence_number(103);
    client.vote_on_proposal(&user1, &proposal_id, &true);

    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert_eq!(
        proposal.votes_for, 1000,
        "vote should be weighted by the snapshot balance (1000), not the current one (6000)"
    );
}

#[test]
fn test_voting_power_at_reflects_delegation_snapshot() {
    // A delegation made after a given ledger must not retroactively change
    // the voting power recorded at that ledger, and must be reflected once
    // it has actually happened.
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    client.mint(&user1, &1000i128);
    client.mint(&user2, &500i128);
    let ledger_before_delegation = env.ledger().sequence();

    env.ledger().set_sequence_number(101);
    client.delegate(&user2, &user1);
    let ledger_after_delegation = env.ledger().sequence();

    // Before the delegation: each holder's own balance.
    assert_eq!(
        client.get_voting_power_at(&user1, &ledger_before_delegation),
        1000
    );
    assert_eq!(
        client.get_voting_power_at(&user2, &ledger_before_delegation),
        500
    );

    // After the delegation: user1 also carries user2's power; user2 has none.
    assert_eq!(
        client.get_voting_power_at(&user1, &ledger_after_delegation),
        1500
    );
    assert_eq!(
        client.get_voting_power_at(&user2, &ledger_after_delegation),
        0
    );

    // A proposal snapshotted after the delegation counts the combined power.
    env.ledger().set_sequence_number(102);
    env.ledger().set_timestamp(1_000);
    let proposal_desc = String::from_str(&env, "Delegated vote");
    let proposal_id = client.create_proposal(&user1, &proposal_desc, &3600u64);

    env.ledger().set_sequence_number(103);
    client.vote_on_proposal(&user1, &proposal_id, &true);

    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert_eq!(proposal.votes_for, 1500);
}

#[test]
fn test_revoke_delegation_restores_snapshot_power() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    client.mint(&user1, &1000i128);
    client.mint(&user2, &500i128);

    env.ledger().set_sequence_number(101);
    client.delegate(&user2, &user1);
    assert_eq!(client.get_voting_power(&user1), 1500);
    assert_eq!(client.get_voting_power(&user2), 0);

    env.ledger().set_sequence_number(102);
    client.revoke_delegation(&user2);
    assert_eq!(client.get_voting_power(&user1), 1000);
    assert_eq!(client.get_voting_power(&user2), 500);

    // The snapshot at the ledger where the delegation was still active is
    // unaffected by the later revocation.
    assert_eq!(client.get_voting_power_at(&user1, &101), 1500);
    assert_eq!(client.get_voting_power_at(&user2, &101), 0);
}

#[test]
fn test_block_number_reference_on_proposal() {
    // The proposal exposes the ledger sequence ("block number") its snapshot
    // was taken at, and it matches the actual current ledger at creation.
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    env.ledger().set_sequence_number(250);
    client.mint(&user1, &1000i128);

    let proposal_desc = String::from_str(&env, "Block reference test");
    let proposal_id = client.create_proposal(&user1, &proposal_desc, &3600u64);
    let proposal = client.get_proposal(&proposal_id).unwrap();

    assert_eq!(proposal.snapshot_ledger, 250);
    assert_eq!(proposal.snapshot_ledger, env.ledger().sequence());
}

#[test]
fn test_vote_aggregation_and_historical_records() {
    // Vote tallies aggregate correctly on-chain, and each individual vote is
    // retrievable afterward for historical/auditing purposes.
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);
    let user3 = Address::generate(&env);

    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(1_000);
    client.mint(&user1, &1500i128);
    client.mint(&user2, &500i128);
    client.mint(&user3, &300i128);

    env.ledger().set_sequence_number(101);
    let proposal_desc = String::from_str(&env, "Aggregate votes");
    let proposal_id = client.create_proposal(&user1, &proposal_desc, &3600u64);

    env.ledger().set_sequence_number(102);
    client.vote_on_proposal(&user1, &proposal_id, &true);
    env.ledger().set_sequence_number(103);
    client.vote_on_proposal(&user2, &proposal_id, &false);
    env.ledger().set_sequence_number(104);
    client.vote_on_proposal(&user3, &proposal_id, &true);

    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert_eq!(proposal.votes_for, 1800);
    assert_eq!(proposal.votes_against, 500);

    let records = client.get_vote_records(&proposal_id);
    assert_eq!(records.len(), 3);

    let r0 = records.get(0).unwrap();
    assert_eq!(r0.voter, user1);
    assert!(r0.support);
    assert_eq!(r0.power, 1500);
    assert_eq!(r0.ledger, 102);

    let r1 = records.get(1).unwrap();
    assert_eq!(r1.voter, user2);
    assert!(!r1.support);
    assert_eq!(r1.power, 500);
    assert_eq!(r1.ledger, 103);

    let r2 = records.get(2).unwrap();
    assert_eq!(r2.voter, user3);
    assert!(r2.support);
    assert_eq!(r2.power, 300);
    assert_eq!(r2.ledger, 104);
}

#[test]
fn test_transfer_and_burn_update_voting_power_checkpoints() {
    // Transfers and burns move checkpointed voting power immediately, so a
    // snapshot taken right after either reflects the new balances.
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AxTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    client.mint(&user1, &1000i128);
    assert_eq!(client.get_voting_power(&user1), 1000);
    assert_eq!(client.get_voting_power(&user2), 0);

    env.ledger().set_sequence_number(101);
    client.transfer(&user1, &user2, &400i128);
    assert_eq!(client.get_voting_power(&user1), 600);
    assert_eq!(client.get_voting_power(&user2), 400);

    env.ledger().set_sequence_number(102);
    client.burn(&user2, &100i128);
    assert_eq!(client.get_voting_power(&user2), 300);

    // Earlier snapshots are untouched by the later transfer/burn.
    assert_eq!(client.get_voting_power_at(&user1, &100), 1000);
    assert_eq!(client.get_voting_power_at(&user2, &100), 0);
}
