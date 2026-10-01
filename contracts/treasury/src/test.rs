#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Env, Vec,
};
use time_lock::{TimeLock, TimeLockClient};

struct TestSetup<'a> {
    client: TreasuryClient<'a>,
    admin: Address,
    signers: Vec<Address>,
    token: Address,
    token_admin: token::StellarAssetClient<'a>,
    token_client: token::Client<'a>,
}

fn setup(env: &Env) -> TestSetup<'_> {
    env.mock_all_auths();
    let admin = Address::generate(env);

    let token_sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token_sac.address();
    let token_admin = token::StellarAssetClient::new(env, &token);
    let token_client = token::Client::new(env, &token);

    let timelock_id = env.register(TimeLock, ());
    let timelock = TimeLockClient::new(env, &timelock_id);
    timelock.initialize(&admin, &3600, &86400, &1);

    let contract_id = env.register(Treasury, ());
    let client = TreasuryClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    let signer2 = Address::generate(env);
    signers.push_back(signer2);

    client.initialize(&admin, &token, &signers, &2, &3600, &timelock_id, &None);
    timelock.add_governor(&admin, &contract_id);

    TestSetup {
        client,
        admin,
        signers,
        token,
        token_admin,
        token_client,
    }
}

/// Mint `amount` treasury tokens to a fresh depositor.
fn funded_depositor(env: &Env, client: &TreasuryClient, amount: i128) -> Address {
    let depositor = Address::generate(env);
    token::StellarAssetClient::new(env, &client.get_token()).mint(&depositor, &amount);
    depositor
}

#[test]
fn deposit_moves_tokens_and_updates_counter() {
    let env = Env::default();
    let s = setup(&env);
    let depositor = funded_depositor(&env, &s.client, 1_000);
    let tok = token::Client::new(&env, &s.client.get_token());

    s.client.deposit(&depositor, &400);

    assert_eq!(s.client.get_balance(), 400);
    assert_eq!(tok.balance(&s.client.address), 400);
    assert_eq!(tok.balance(&depositor), 600);
}

#[test]
fn deposit_with_insufficient_tokens_fails_and_leaves_storage_unchanged() {
    let env = Env::default();
    let s = setup(&env);
    let depositor = funded_depositor(&env, &s.client, 100);

    assert!(s.client.try_deposit(&depositor, &500).is_err());
    assert_eq!(s.client.get_balance(), 0);
    assert_eq!(
        token::Client::new(&env, &s.client.get_token()).balance(&depositor),
        100
    );
}

#[test]
fn pause_round_trip() {
    let env = Env::default();
    let s = setup(&env);

    assert!(!s.client.is_paused());
    s.client.set_paused(&s.admin, &true);
    assert!(s.client.is_paused());
    s.client.set_paused(&s.admin, &false);
    assert!(!s.client.is_paused());
}

#[test]
#[should_panic(expected = "caller is not admin")]
fn pause_by_non_admin_fails() {
    let env = Env::default();
    let s = setup(&env);

    let intruder = Address::generate(&env);
    s.client.set_paused(&intruder, &true);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn deposit_blocked_while_paused() {
    let env = Env::default();
    let s = setup(&env);

    s.client.set_paused(&s.admin, &true);
    let depositor = Address::generate(&env);
    s.client.deposit(&depositor, &100);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn spending_proposal_blocked_while_paused() {
    let env = Env::default();
    let s = setup(&env);

    s.client.set_paused(&s.admin, &true);
    let recipient = Address::generate(&env);
    s.client.create_spending_proposal(
        &s.signers.get(1).unwrap(),
        &recipient,
        &100,
        &Symbol::new(&env, "ops"),
        &String::from_str(&env, "paused treasury"),
    );
}

#[test]
fn reads_work_while_paused() {
    let env = Env::default();
    let s = setup(&env);

    let depositor = funded_depositor(&env, &s.client, 500);
    s.client.deposit(&depositor, &500);

    s.client.set_paused(&s.admin, &true);

    // Read entry points must stay available during an emergency stop.
    assert!(s.client.is_paused());
    assert_eq!(s.client.get_balance(), 500);
    assert_eq!(s.client.get_signers().len(), s.signers.len());
    assert_eq!(s.client.get_threshold(), 2);
    assert_eq!(s.client.get_admin(), s.admin);
    assert_eq!(s.client.get_token(), s.token);
    assert_eq!(s.client.get_dashboard().balance, 500);
}

#[test]
fn unpause_restores_mutations() {
    let env = Env::default();
    let s = setup(&env);

    s.client.set_paused(&s.admin, &true);
    let depositor = funded_depositor(&env, &s.client, 250);

    // Unpause restores normal operation.
    s.client.set_paused(&s.admin, &false);
    s.client.deposit(&depositor, &250);
    assert_eq!(s.client.get_balance(), 250);
}

// -----------------------------------------------------------------
// Issue #1149: deposit must perform a real token transfer
// -----------------------------------------------------------------

#[test]
fn deposit_moves_tokens_atomically_and_updates_counter() {
    let env = Env::default();
    let s = setup(&env);

    let depositor = Address::generate(&env);
    s.token_admin.mint(&depositor, &500);

    s.client.deposit(&depositor, &200);

    // Real tokens moved from the depositor to the contract.
    assert_eq!(s.token_client.balance(&depositor), 300);
    assert_eq!(s.token_client.balance(&s.client.address), 200);
    // Internal counter matches the tokens actually custodied.
    assert_eq!(s.client.get_balance(), 200);

    // A second deposit accumulates both the real and the ledger balance.
    s.client.deposit(&depositor, &150);
    assert_eq!(s.token_client.balance(&depositor), 150);
    assert_eq!(s.token_client.balance(&s.client.address), 350);
    assert_eq!(s.client.get_balance(), 350);
}

#[test]
fn deposit_with_insufficient_balance_fails_and_storage_unchanged() {
    let env = Env::default();
    let s = setup(&env);

    let depositor = Address::generate(&env);
    s.token_admin.mint(&depositor, &50);

    // Attempting to deposit more than the depositor holds must fail.
    let result = s.client.try_deposit(&depositor, &100);
    assert!(result.is_err());

    // Storage untouched: internal counter and token balances unchanged.
    assert_eq!(s.client.get_balance(), 0);
    assert_eq!(s.token_client.balance(&depositor), 50);
    assert_eq!(s.token_client.balance(&s.client.address), 0);
}

#[test]
fn deposit_without_any_tokens_fails() {
    let env = Env::default();
    let s = setup(&env);

    let depositor = Address::generate(&env);

    let result = s.client.try_deposit(&depositor, &1);
    assert!(result.is_err());
    assert_eq!(s.client.get_balance(), 0);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn deposit_zero_amount_fails() {
    let env = Env::default();
    let s = setup(&env);

    let depositor = Address::generate(&env);
    s.token_admin.mint(&depositor, &100);
    s.client.deposit(&depositor, &0);
}

// -----------------------------------------------------------------
// Spending lifecycle funded by real transfers
// -----------------------------------------------------------------

#[test]
fn spending_proposal_executes_against_real_deposits() {
    let env = Env::default();
    let s = setup(&env);

    // Pre-fund the treasury via a real token transfer.
    let depositor = Address::generate(&env);
    s.token_admin.mint(&depositor, &1_000);
    s.client.deposit(&depositor, &1_000);
    assert_eq!(s.client.get_balance(), 1_000);

    // Allocate a budget for the "ops" category (quorum of 2 votes).
    let allocation_id =
        s.client
            .propose_budget_allocation(&s.admin, &Symbol::new(&env, "ops"), &400);
    s.client
        .vote_budget_allocation(&s.signers.get(1).unwrap(), &allocation_id, &true);
    s.client.finalize_budget_allocation(&s.admin, &allocation_id);

    // Create + approve a spending proposal (threshold of 2 approvals).
    let recipient = Address::generate(&env);
    let proposal_id = s.client.create_spending_proposal(
        &s.signers.get(1).unwrap(),
        &recipient,
        &300,
        &Symbol::new(&env, "ops"),
        &String::from_str(&env, "infra costs"),
    );
    s.client.approve_proposal(&s.admin, &proposal_id);

    // Fast-forward past the time-lock, then execute.
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + 3600);
    s.client.execute_proposal(&s.admin, &proposal_id);

    // Real tokens paid out; internal ledger stays in sync.
    assert_eq!(s.token_client.balance(&recipient), 300);
    assert_eq!(s.token_client.balance(&s.client.address), 700);
    assert_eq!(s.client.get_balance(), 700);
    assert!(s.client.get_spending_proposal(&proposal_id).unwrap().executed);
}

#[test]
#[should_panic(expected = "insufficient treasury balance")]
fn spending_proposal_exceeding_real_balance_fails() {
    let env = Env::default();
    let s = setup(&env);

    // Only 100 real tokens in the treasury.
    let depositor = Address::generate(&env);
    s.token_admin.mint(&depositor, &100);
    s.client.deposit(&depositor, &100);

    let allocation_id =
        s.client
            .propose_budget_allocation(&s.admin, &Symbol::new(&env, "ops"), &500);
    s.client
        .vote_budget_allocation(&s.signers.get(1).unwrap(), &allocation_id, &true);
    s.client.finalize_budget_allocation(&s.admin, &allocation_id);

    let recipient = Address::generate(&env);
    let proposal_id = s.client.create_spending_proposal(
        &s.admin,
        &recipient,
        &200,
        &Symbol::new(&env, "ops"),
        &String::from_str(&env, "overspend"),
    );
    s.client
        .approve_proposal(&s.signers.get(1).unwrap(), &proposal_id);

    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + 3600);
    s.client.execute_proposal(&s.admin, &proposal_id);
}

#[test]
fn timelock_integration_duration_change_preserves_execute_after() {
    let env = Env::default();
    let s = setup(&env);

    let depositor = Address::generate(&env);
    s.token_admin.mint(&depositor, &10000);
    s.client.deposit(&depositor, &10000);

    let category = Symbol::new(&env, "ops");
    let alloc_id = s
        .client
        .propose_budget_allocation(&s.admin, &category, &10000);
    s.client
        .vote_budget_allocation(&s.signers.get(1).unwrap(), &alloc_id, &true);
    s.client.finalize_budget_allocation(&s.admin, &alloc_id);

    let recipient = Address::generate(&env);
    let proposal_id = s.client.create_spending_proposal(
        &s.admin,
        &recipient,
        &1000,
        &category,
        &String::from_str(&env, "high-value spend"),
    );
    let original = s.client.get_spending_proposal(&proposal_id).unwrap();
    assert_eq!(original.execute_after, 3600);
    s.client
        .approve_proposal(&s.signers.get(1).unwrap(), &proposal_id);

    let duration_id = s.client.propose_time_lock_update(&s.admin, &0);
    s.client
        .vote_time_lock_update(&s.signers.get(1).unwrap(), &duration_id, &true);
    s.client.finalize_time_lock_update(&s.admin, &duration_id);
    assert_eq!(s.client.get_dashboard().time_lock_duration, 0);

    let preserved = s.client.get_spending_proposal(&proposal_id).unwrap();
    assert_eq!(preserved.execute_after, 3600);

    env.ledger().with_mut(|l| l.timestamp = 100);
    assert!(s
        .client
        .try_execute_proposal(&s.admin, &proposal_id)
        .is_err());

    env.ledger().with_mut(|l| l.timestamp = 3600);
    s.client.execute_proposal(&s.admin, &proposal_id);
    let executed = s.client.get_spending_proposal(&proposal_id).unwrap();
    assert!(executed.executed);
    assert_eq!(s.client.get_balance(), 9000);
}
