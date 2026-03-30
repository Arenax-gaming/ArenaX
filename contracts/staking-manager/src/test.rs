#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _},
    token, Address, BytesN, Env,
};

// Mock AX Token Client for testing
mod ax_token {
    soroban_sdk::contractimport!(
        file = "../target/wasm32-unknown-unknown/release/ax_token.wasm"
    );
}

// Test helper to create a new staking manager instance
fn create_staking_manager<'a>(
    env: &Env,
) -> (
    StakingManagerClient<'a>,
    Address,
    Address,
    Address,
    Address,
) {
    let contract_id = env.register(StakingManager, ());
    let client = StakingManagerClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let ax_token = Address::generate(env);
    let user1 = Address::generate(env);
    let user2 = Address::generate(env);

    (client, admin, ax_token, user1, user2)
}

// Helper to create a mock token contract
fn create_token_contract<'a>(env: &Env, admin: &'a Address) -> (token::Client<'a>, token::StellarAssetClient<'a>) {
    let contract_address = env.register_stellar_asset_contract_v2(admin.clone());
    (
        token::Client::new(env, &contract_address.address()),
        token::StellarAssetClient::new(env, &contract_address.address()),
    )
}

// ============================================================================
// Initialization Tests
// ============================================================================

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, _, _) = create_staking_manager(&env);

    client.initialize(&admin, &ax_token);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_ax_token(), ax_token);
    assert_eq!(client.is_paused(), false);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, _, _) = create_staking_manager(&env);

    client.initialize(&admin, &ax_token);
    client.initialize(&admin, &ax_token); // Should panic
}

// ============================================================================
// Tournament Creation Tests
// ============================================================================

#[test]
fn test_create_tournament() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, _, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_id = BytesN::random(&env);
    let stake_requirement = 100_000_000i128; // 10 AX tokens

    client.create_tournament(&tournament_id, &stake_requirement);

    let tournament_info = client.get_tournament_info(&tournament_id);
    assert_eq!(tournament_info.tournament_id, tournament_id);
    assert_eq!(tournament_info.stake_requirement, stake_requirement);
    assert_eq!(tournament_info.state, TournamentState::NotStarted as u32);
    assert_eq!(tournament_info.total_staked, 0);
    assert_eq!(tournament_info.participant_count, 0);
}

#[test]
#[should_panic(expected = "tournament already exists")]
fn test_create_duplicate_tournament_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, _, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_id = BytesN::random(&env);
    let stake_requirement = 100_000_000i128;

    client.create_tournament(&tournament_id, &stake_requirement);
    client.create_tournament(&tournament_id, &stake_requirement); // Should panic
}

#[test]
#[should_panic(expected = "stake requirement must be positive")]
fn test_create_tournament_zero_stake_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, _, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_id = BytesN::random(&env);
    client.create_tournament(&tournament_id, &0); // Should panic
}

// ============================================================================
// Tournament State Update Tests
// ============================================================================

#[test]
fn test_update_tournament_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, _, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_id = BytesN::random(&env);
    let stake_requirement = 100_000_000i128;

    client.create_tournament(&tournament_id, &stake_requirement);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let tournament_info = client.get_tournament_info(&tournament_id);
    assert_eq!(tournament_info.state, TournamentState::Active as u32);
}

#[test]
#[should_panic(expected = "tournament not found")]
fn test_update_nonexistent_tournament_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, _, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_id = BytesN::random(&env);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));
}

// ============================================================================
// Staking Tests
// ============================================================================

#[test]
fn test_stake() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, user1, _) = create_staking_manager(&env);
    
    // Create real token contract
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();
    
    client.initialize(&admin, &token_address);

    // Mint tokens to user
    let stake_amount = 100_000_000i128;
    token_admin.mint(&user1, &stake_amount);

    // Create and activate tournament
    let tournament_id = BytesN::random(&env);
    client.create_tournament(&tournament_id, &stake_amount);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    // Stake tokens
    client.stake(&user1, &tournament_id, &stake_amount);

    // Verify stake
    let stake_info = client.get_stake(&user1, &tournament_id);
    assert_eq!(stake_info.user, user1);
    assert_eq!(stake_info.amount, stake_amount);
    assert_eq!(stake_info.is_locked, true);

    // Verify tournament info updated
    let tournament_info = client.get_tournament_info(&tournament_id);
    assert_eq!(tournament_info.total_staked, stake_amount);
    assert_eq!(tournament_info.participant_count, 1);

    // Verify user stake info
    let user_info = client.get_user_stake_info(&user1);
    assert_eq!(user_info.total_staked, stake_amount);
    assert_eq!(user_info.active_tournaments, 1);
}

#[test]
#[should_panic(expected = "tournament not found")]
fn test_stake_nonexistent_tournament_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, user1, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_id = BytesN::random(&env);
    let stake_amount = 100_000_000i128;

    client.stake(&user1, &tournament_id, &stake_amount);
}

#[test]
#[should_panic(expected = "tournament is not active")]
fn test_stake_inactive_tournament_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, user1, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_id = BytesN::random(&env);
    let stake_amount = 100_000_000i128;

    client.create_tournament(&tournament_id, &stake_amount);
    // Don't activate tournament
    client.stake(&user1, &tournament_id, &stake_amount);
}

#[test]
#[should_panic(expected = "amount below stake requirement")]
fn test_stake_insufficient_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, user1, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_id = BytesN::random(&env);
    let stake_requirement = 100_000_000i128;

    client.create_tournament(&tournament_id, &stake_requirement);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    // Try to stake less than required
    client.stake(&user1, &tournament_id, &(stake_requirement - 1));
}

#[test]
#[should_panic(expected = "user already staked for this tournament")]
fn test_double_staking_prevention() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, user1, _) = create_staking_manager(&env);
    
    // Create real token contract
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();
    
    client.initialize(&admin, &token_address);

    // Mint tokens to user (double the amount)
    let stake_amount = 100_000_000i128;
    token_admin.mint(&user1, &(stake_amount * 2));

    // Create and activate tournament
    let tournament_id = BytesN::random(&env);
    client.create_tournament(&tournament_id, &stake_amount);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    // First stake succeeds
    client.stake(&user1, &tournament_id, &stake_amount);

    // Second stake should fail (double-staking prevention)
    client.stake(&user1, &tournament_id, &stake_amount);
}

// ============================================================================
// Withdrawal Tests
// ============================================================================

#[test]
fn test_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, user1, _) = create_staking_manager(&env);
    
    // Create real token contract
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();
    
    client.initialize(&admin, &token_address);

    // Mint tokens to user
    let stake_amount = 100_000_000i128;
    token_admin.mint(&user1, &stake_amount);

    // Create, activate, and stake
    let tournament_id = BytesN::random(&env);
    client.create_tournament(&tournament_id, &stake_amount);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));
    client.stake(&user1, &tournament_id, &stake_amount);

    // Complete tournament (this should unlock stakes)
    client.update_tournament_state(&tournament_id, &(TournamentState::Completed as u32));

    // Note: In the current implementation, we need to manually set can_withdraw
    // In a full implementation, update_tournament_state would handle this

    // For now, we can't test withdrawal without modifying the stake
    // This would be handled by the unlock_tournament_stakes function
}

#[test]
#[should_panic(expected = "no stake found")]
fn test_withdraw_no_stake_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, user1, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_id = BytesN::random(&env);
    client.withdraw(&user1, &tournament_id);
}

// ============================================================================
// Slashing Tests
// ============================================================================

#[test]
fn test_slash() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, user1, _) = create_staking_manager(&env);
    
    // Create real token contract
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();
    
    client.initialize(&admin, &token_address);

    // Mint tokens to user
    let stake_amount = 100_000_000i128;
    token_admin.mint(&user1, &stake_amount);

    // Create, activate, and stake
    let tournament_id = BytesN::random(&env);
    client.create_tournament(&tournament_id, &stake_amount);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));
    client.stake(&user1, &tournament_id, &stake_amount);

    // Slash 50% of stake
    let slash_amount = stake_amount / 2;
    client.slash(&user1, &tournament_id, &slash_amount, &admin);

    // Verify stake reduced
    let stake_info = client.get_stake(&user1, &tournament_id);
    assert_eq!(stake_info.amount, stake_amount - slash_amount);

    // Verify user info updated
    let user_info = client.get_user_stake_info(&user1);
    assert_eq!(user_info.total_slashed, slash_amount);
}

#[test]
#[should_panic(expected = "no stake found")]
fn test_slash_no_stake_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, user1, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_id = BytesN::random(&env);
    let slash_amount = 50_000_000i128;

    client.slash(&user1, &tournament_id, &slash_amount, &admin);
}

#[test]
#[should_panic(expected = "slash amount exceeds staked amount")]
fn test_slash_exceeds_stake_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, user1, _) = create_staking_manager(&env);
    
    // Create real token contract
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();
    
    client.initialize(&admin, &token_address);

    // Mint tokens to user
    let stake_amount = 100_000_000i128;
    token_admin.mint(&user1, &stake_amount);

    // Create, activate, and stake
    let tournament_id = BytesN::random(&env);
    client.create_tournament(&tournament_id, &stake_amount);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));
    client.stake(&user1, &tournament_id, &stake_amount);

    // Try to slash more than staked
    client.slash(&user1, &tournament_id, &(stake_amount + 1), &admin);
}

// ============================================================================
// Query Function Tests
// ============================================================================

#[test]
fn test_get_total_staked() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, user1, user2) = create_staking_manager(&env);
    
    // Create real token contract
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();
    
    client.initialize(&admin, &token_address);

    // Mint tokens to users
    let stake_amount = 100_000_000i128;
    token_admin.mint(&user1, &stake_amount);
    token_admin.mint(&user2, &stake_amount);

    // Create and activate tournament
    let tournament_id = BytesN::random(&env);
    client.create_tournament(&tournament_id, &stake_amount);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    // Both users stake
    client.stake(&user1, &tournament_id, &stake_amount);
    client.stake(&user2, &tournament_id, &stake_amount);

    // Verify total staked
    let total_staked = client.get_total_staked(&tournament_id);
    assert_eq!(total_staked, stake_amount * 2);
}

#[test]
fn test_can_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, user1, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_id = BytesN::random(&env);
    
    // Initially false (no stake)
    assert_eq!(client.can_withdraw(&user1, &tournament_id), false);
}

// ============================================================================
// Pause/Unpause Tests
// ============================================================================

#[test]
fn test_pause_unpause() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, _, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    // Initially not paused
    assert_eq!(client.is_paused(), false);

    // Pause
    client.set_paused(&true);
    assert_eq!(client.is_paused(), true);

    // Unpause
    client.set_paused(&false);
    assert_eq!(client.is_paused(), false);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_stake_when_paused_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, user1, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_id = BytesN::random(&env);
    let stake_amount = 100_000_000i128;

    client.create_tournament(&tournament_id, &stake_amount);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    // Pause contract
    client.set_paused(&true);

    // Try to stake (should fail)
    client.stake(&user1, &tournament_id, &stake_amount);
}

// ============================================================================
// Admin Function Tests
// ============================================================================

#[test]
fn test_set_ax_token() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, _, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let new_token = Address::generate(&env);
    client.set_ax_token(&new_token);

    assert_eq!(client.get_ax_token(), new_token);
}

#[test]
fn test_set_tournament_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, _, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let tournament_contract = Address::generate(&env);
    client.set_tournament_contract(&tournament_contract);
}

#[test]
fn test_set_dispute_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ax_token, _, _) = create_staking_manager(&env);
    client.initialize(&admin, &ax_token);

    let dispute_contract = Address::generate(&env);
    client.set_dispute_contract(&dispute_contract);
}

// ============================================================================
// Complex Scenario Tests
// ============================================================================

#[test]
fn test_multiple_users_tournament_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, user1, user2) = create_staking_manager(&env);
    
    // Create real token contract
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();
    
    client.initialize(&admin, &token_address);

    // Mint tokens to users
    let stake_amount = 100_000_000i128;
    token_admin.mint(&user1, &stake_amount);
    token_admin.mint(&user2, &stake_amount);

    // Create and activate tournament
    let tournament_id = BytesN::random(&env);
    client.create_tournament(&tournament_id, &stake_amount);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    // Both users stake
    client.stake(&user1, &tournament_id, &stake_amount);
    client.stake(&user2, &tournament_id, &stake_amount);

    // Verify tournament state
    let tournament_info = client.get_tournament_info(&tournament_id);
    assert_eq!(tournament_info.participant_count, 2);
    assert_eq!(tournament_info.total_staked, stake_amount * 2);

    // Slash user2 (50%)
    let slash_amount = stake_amount / 2;
    client.slash(&user2, &tournament_id, &slash_amount, &admin);

    // Verify user2's stake reduced
    let user2_stake = client.get_stake(&user2, &tournament_id);
    assert_eq!(user2_stake.amount, stake_amount - slash_amount);

    // Verify tournament total updated
    let tournament_info = client.get_tournament_info(&tournament_id);
    assert_eq!(
        tournament_info.total_staked,
        stake_amount + (stake_amount - slash_amount)
    );
}

#[test]
fn test_user_stake_info_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, user1, _) = create_staking_manager(&env);
    
    // Create real token contract
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();
    
    client.initialize(&admin, &token_address);

    // Mint tokens to user
    let stake_amount = 100_000_000i128;
    token_admin.mint(&user1, &(stake_amount * 2));

    // Create two tournaments
    let tournament_id1 = BytesN::random(&env);
    let tournament_id2 = BytesN::random(&env);
    
    client.create_tournament(&tournament_id1, &stake_amount);
    client.create_tournament(&tournament_id2, &stake_amount);
    
    client.update_tournament_state(&tournament_id1, &(TournamentState::Active as u32));
    client.update_tournament_state(&tournament_id2, &(TournamentState::Active as u32));

    // Stake in both tournaments
    client.stake(&user1, &tournament_id1, &stake_amount);
    client.stake(&user1, &tournament_id2, &stake_amount);

    // Verify user info
    let user_info = client.get_user_stake_info(&user1);
    assert_eq!(user_info.total_staked, stake_amount * 2);
    assert_eq!(user_info.active_tournaments, 2);
    assert_eq!(user_info.total_slashed, 0);
}
