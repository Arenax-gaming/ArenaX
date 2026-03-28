#![cfg(test)]

//! Integration tests for Match Lifecycle + Prize Distribution
//!
//! Tests the full flow: Create Match -> Stake -> Finalize -> Payout
//! Includes dispute handling and cancellation scenarios

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, Vec,
};

// Mock escrow contract for testing
mod escrow_contract {
    soroban_sdk::contractimport!(
        file = "../target/wasm32-unknown-unknown/release/match_escrow_vault.wasm"
    );
}

struct TestContext<'a> {
    env: Env,
    match_client: MatchLifecycleContractClient<'a>,
    escrow_client: escrow_contract::Client<'a>,
    token_client: TokenClient<'a>,
    token_admin_client: StellarAssetClient<'a>,
    admin: Address,
    player_a: Address,
    player_b: Address,
    players: Vec<Address>,
    match_id: BytesN<32>,
}

fn setup_integration_test() -> TestContext<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(12345);

    // Deploy match lifecycle contract
    let match_contract_id = env.register(MatchLifecycleContract, ());
    let match_client = MatchLifecycleContractClient::new(&env, &match_contract_id);

    // Deploy mock token
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_client = TokenClient::new(&env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(&env, &token_contract.address());

    // Deploy escrow contract
    let escrow_id = env.register(escrow_contract::WASM, ());
    let escrow_client = escrow_contract::Client::new(&env, &escrow_id);

    let admin = Address::generate(&env);
    
    // Initialize contracts
    match_client.initialize(&admin);
    escrow_client.initialize(&admin);
    
    // Link contracts
    match_client.set_escrow_contract(&escrow_id);
    match_client.set_finalization_window(&300); // 5 minutes
    escrow_client.set_match_contract(&match_contract_id);

    // Setup players
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    let mut players: Vec<Address> = Vec::new(&env);
    players.push_back(player_a.clone());
    players.push_back(player_b.clone());

    // Mint tokens to players
    token_admin_client.mint(&player_a, &10000);
    token_admin_client.mint(&player_b, &10000);

    let match_id = BytesN::from_array(&env, &[1u8; 32]);

    TestContext {
        env,
        match_client,
        escrow_client,
        token_client,
        token_admin_client,
        admin,
        player_a,
        player_b,
        players,
        match_id,
    }
}

#[test]
fn test_full_match_flow_with_prize_distribution() {
    let ctx = setup_integration_test();
    let stake_amount = 1000i128;

    // 1. Create match (automatically creates escrow)
    ctx.match_client.create_match(
        &ctx.match_id,
        &ctx.players,
        &ctx.token_client.address,
        &stake_amount,
    );

    let match_data = ctx.match_client.get_match(&ctx.match_id);
    assert_eq!(match_data.state, MatchState::Created as u32);

    // Verify escrow was created
    assert!(ctx.escrow_client.escrow_exists(&ctx.match_id));

    // 2. Players deposit stakes
    ctx.escrow_client
        .deposit(&ctx.match_id, &ctx.player_a);
    ctx.escrow_client
        .deposit(&ctx.match_id, &ctx.player_b);

    let escrow_state = ctx.escrow_client.get_escrow_state(&ctx.match_id);
    assert_eq!(escrow_state, 3); // FullyFunded

    // 3. Lock funds when match starts
    ctx.escrow_client.lock_funds(&ctx.match_id);

    // 4. Submit results (dual reporting - both agree)
    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_a, &0); // Player A wins
    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_b, &0);

    let match_data = ctx.match_client.get_match(&ctx.match_id);
    assert_eq!(match_data.state, MatchState::PendingResult as u32);

    // 5. Finalize match
    ctx.match_client
        .finalize_match(&ctx.match_id, &ctx.player_a);

    let match_data = ctx.match_client.get_match(&ctx.match_id);
    assert_eq!(match_data.state, MatchState::Finalized as u32);
    assert_eq!(match_data.winner, Some(ctx.player_a.clone()));

    // 6. Wait for dispute window to expire
    ctx.env.ledger().set_timestamp(12345 + 301); // Past 5-minute window

    // 7. Distribute prize
    let initial_balance = ctx.token_client.balance(&ctx.player_a);
    ctx.match_client.distribute_prize(&ctx.match_id);

    // Verify winner received both stakes
    let final_balance = ctx.token_client.balance(&ctx.player_a);
    assert_eq!(final_balance, initial_balance + (stake_amount * 2));

    // Verify escrow is released
    let escrow_state = ctx.escrow_client.get_escrow_state(&ctx.match_id);
    assert_eq!(escrow_state, 5); // Released
}

#[test]
#[should_panic(expected = "dispute window still active")]
fn test_cannot_distribute_during_dispute_window() {
    let ctx = setup_integration_test();
    let stake_amount = 1000i128;

    ctx.match_client.create_match(
        &ctx.match_id,
        &ctx.players,
        &ctx.token_client.address,
        &stake_amount,
    );

    ctx.escrow_client
        .deposit(&ctx.match_id, &ctx.player_a);
    ctx.escrow_client
        .deposit(&ctx.match_id, &ctx.player_b);
    ctx.escrow_client.lock_funds(&ctx.match_id);

    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_a, &0);
    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_b, &0);
    ctx.match_client
        .finalize_match(&ctx.match_id, &ctx.player_a);

    // Try to distribute immediately (should fail)
    ctx.match_client.distribute_prize(&ctx.match_id);
}

#[test]
fn test_dispute_blocks_payout() {
    let ctx = setup_integration_test();
    let stake_amount = 1000i128;

    ctx.match_client.create_match(
        &ctx.match_id,
        &ctx.players,
        &ctx.token_client.address,
        &stake_amount,
    );

    ctx.escrow_client
        .deposit(&ctx.match_id, &ctx.player_a);
    ctx.escrow_client
        .deposit(&ctx.match_id, &ctx.player_b);
    ctx.escrow_client.lock_funds(&ctx.match_id);

    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_a, &0);
    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_b, &0);
    ctx.match_client
        .finalize_match(&ctx.match_id, &ctx.player_a);

    // Raise dispute within window
    ctx.env.ledger().set_timestamp(12345 + 100); // Within 5-minute window
    ctx.match_client
        .raise_dispute(&ctx.match_id, &ctx.player_b);

    let match_data = ctx.match_client.get_match(&ctx.match_id);
    assert_eq!(match_data.state, MatchState::Disputed as u32);

    // Verify escrow is marked as disputed
    let escrow_state = ctx.escrow_client.get_escrow_state(&ctx.match_id);
    assert_eq!(escrow_state, 7); // Disputed

    // Wait past dispute window
    ctx.env.ledger().set_timestamp(12345 + 400);

    // Try to distribute (should fail because match is disputed)
    let result = ctx.match_client.try_distribute_prize(&ctx.match_id);
    assert!(result.is_err());
}

#[test]
fn test_resolve_dispute_and_distribute() {
    let ctx = setup_integration_test();
    let stake_amount = 1000i128;

    ctx.match_client.create_match(
        &ctx.match_id,
        &ctx.players,
        &ctx.token_client.address,
        &stake_amount,
    );

    ctx.escrow_client
        .deposit(&ctx.match_id, &ctx.player_a);
    ctx.escrow_client
        .deposit(&ctx.match_id, &ctx.player_b);
    ctx.escrow_client.lock_funds(&ctx.match_id);

    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_a, &0);
    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_b, &0);
    ctx.match_client
        .finalize_match(&ctx.match_id, &ctx.player_a);

    // Raise dispute
    ctx.match_client
        .raise_dispute(&ctx.match_id, &ctx.player_b);

    // Admin resolves dispute in favor of player B
    let initial_balance_b = ctx.token_client.balance(&ctx.player_b);
    ctx.match_client.resolve_dispute_and_distribute(
        &ctx.match_id,
        &ctx.player_b,
        &ctx.admin,
    );

    // Verify player B received the prize
    let final_balance_b = ctx.token_client.balance(&ctx.player_b);
    assert_eq!(final_balance_b, initial_balance_b + (stake_amount * 2));

    // Verify match is finalized with correct winner
    let match_data = ctx.match_client.get_match(&ctx.match_id);
    assert_eq!(match_data.state, MatchState::Finalized as u32);
    assert_eq!(match_data.winner, Some(ctx.player_b));
}

#[test]
fn test_cancel_match_refunds_players() {
    let ctx = setup_integration_test();
    let stake_amount = 1000i128;

    ctx.match_client.create_match(
        &ctx.match_id,
        &ctx.players,
        &ctx.token_client.address,
        &stake_amount,
    );

    let initial_balance_a = ctx.token_client.balance(&ctx.player_a);
    let initial_balance_b = ctx.token_client.balance(&ctx.player_b);

    ctx.escrow_client
        .deposit(&ctx.match_id, &ctx.player_a);
    ctx.escrow_client
        .deposit(&ctx.match_id, &ctx.player_b);

    // Admin cancels match
    ctx.match_client
        .cancel_match(&ctx.match_id, &ctx.admin);

    // Verify both players got refunded
    let final_balance_a = ctx.token_client.balance(&ctx.player_a);
    let final_balance_b = ctx.token_client.balance(&ctx.player_b);

    assert_eq!(final_balance_a, initial_balance_a);
    assert_eq!(final_balance_b, initial_balance_b);

    // Verify match is cancelled
    let match_data = ctx.match_client.get_match(&ctx.match_id);
    assert_eq!(match_data.state, MatchState::Cancelled as u32);

    // Verify escrow is refunded
    let escrow_state = ctx.escrow_client.get_escrow_state(&ctx.match_id);
    assert_eq!(escrow_state, 6); // Refunded
}

#[test]
#[should_panic(expected = "cannot cancel finalized match")]
fn test_cannot_cancel_finalized_match() {
    let ctx = setup_integration_test();
    let stake_amount = 1000i128;

    ctx.match_client.create_match(
        &ctx.match_id,
        &ctx.players,
        &ctx.token_client.address,
        &stake_amount,
    );

    ctx.escrow_client
        .deposit(&ctx.match_id, &ctx.player_a);
    ctx.escrow_client
        .deposit(&ctx.match_id, &ctx.player_b);
    ctx.escrow_client.lock_funds(&ctx.match_id);

    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_a, &0);
    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_b, &0);
    ctx.match_client
        .finalize_match(&ctx.match_id, &ctx.player_a);

    // Try to cancel finalized match (should fail)
    ctx.match_client
        .cancel_match(&ctx.match_id, &ctx.admin);
}

#[test]
fn test_funds_never_stuck_on_cancellation() {
    let ctx = setup_integration_test();
    let stake_amount = 1000i128;

    // Test cancellation at various stages
    
    // Stage 1: Cancel after creation, before deposits
    let match_id_1 = BytesN::from_array(&ctx.env, &[10u8; 32]);
    ctx.match_client.create_match(
        &match_id_1,
        &ctx.players,
        &ctx.token_client.address,
        &stake_amount,
    );
    ctx.match_client.cancel_match(&match_id_1, &ctx.admin);
    
    let match_data = ctx.match_client.get_match(&match_id_1);
    assert_eq!(match_data.state, MatchState::Cancelled as u32);

    // Stage 2: Cancel after partial deposit
    let match_id_2 = BytesN::from_array(&ctx.env, &[20u8; 32]);
    ctx.match_client.create_match(
        &match_id_2,
        &ctx.players,
        &ctx.token_client.address,
        &stake_amount,
    );
    
    let balance_before = ctx.token_client.balance(&ctx.player_a);
    ctx.escrow_client.deposit(&match_id_2, &ctx.player_a);
    ctx.match_client.cancel_match(&match_id_2, &ctx.admin);
    
    let balance_after = ctx.token_client.balance(&ctx.player_a);
    assert_eq!(balance_after, balance_before); // Refunded

    // Stage 3: Cancel after both deposits
    let match_id_3 = BytesN::from_array(&ctx.env, &[30u8; 32]);
    ctx.match_client.create_match(
        &match_id_3,
        &ctx.players,
        &ctx.token_client.address,
        &stake_amount,
    );
    
    let balance_a_before = ctx.token_client.balance(&ctx.player_a);
    let balance_b_before = ctx.token_client.balance(&ctx.player_b);
    
    ctx.escrow_client.deposit(&match_id_3, &ctx.player_a);
    ctx.escrow_client.deposit(&match_id_3, &ctx.player_b);
    ctx.match_client.cancel_match(&match_id_3, &ctx.admin);
    
    let balance_a_after = ctx.token_client.balance(&ctx.player_a);
    let balance_b_after = ctx.token_client.balance(&ctx.player_b);
    
    assert_eq!(balance_a_after, balance_a_before); // Both refunded
    assert_eq!(balance_b_after, balance_b_before);
}

#[test]
fn test_prize_distribution_mathematical_correctness() {
    let ctx = setup_integration_test();
    let stake_amount = 1000i128;

    ctx.match_client.create_match(
        &ctx.match_id,
        &ctx.players,
        &ctx.token_client.address,
        &stake_amount,
    );

    let initial_a = ctx.token_client.balance(&ctx.player_a);
    let initial_b = ctx.token_client.balance(&ctx.player_b);

    ctx.escrow_client.deposit(&ctx.match_id, &ctx.player_a);
    ctx.escrow_client.deposit(&ctx.match_id, &ctx.player_b);
    ctx.escrow_client.lock_funds(&ctx.match_id);

    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_a, &0);
    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_b, &0);
    ctx.match_client
        .finalize_match(&ctx.match_id, &ctx.player_a);

    ctx.env.ledger().set_timestamp(12345 + 301);
    ctx.match_client.distribute_prize(&ctx.match_id);

    let final_a = ctx.token_client.balance(&ctx.player_a);
    let final_b = ctx.token_client.balance(&ctx.player_b);

    // Winner gets both stakes
    assert_eq!(final_a, initial_a + stake_amount); // Net gain = opponent's stake
    assert_eq!(final_b, initial_b - stake_amount); // Lost their stake

    // Total supply unchanged (conservation of funds)
    assert_eq!(final_a + final_b, initial_a + initial_b);
}

#[test]
#[should_panic(expected = "dispute window has expired")]
fn test_cannot_dispute_after_window_expires() {
    let ctx = setup_integration_test();
    let stake_amount = 1000i128;

    ctx.match_client.create_match(
        &ctx.match_id,
        &ctx.players,
        &ctx.token_client.address,
        &stake_amount,
    );

    ctx.escrow_client.deposit(&ctx.match_id, &ctx.player_a);
    ctx.escrow_client.deposit(&ctx.match_id, &ctx.player_b);
    ctx.escrow_client.lock_funds(&ctx.match_id);

    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_a, &0);
    ctx.match_client
        .submit_result(&ctx.match_id, &ctx.player_b, &0);
    ctx.match_client
        .finalize_match(&ctx.match_id, &ctx.player_a);

    // Wait past dispute window
    ctx.env.ledger().set_timestamp(12345 + 400);

    // Try to raise dispute (should fail)
    ctx.match_client
        .raise_dispute(&ctx.match_id, &ctx.player_b);
}
