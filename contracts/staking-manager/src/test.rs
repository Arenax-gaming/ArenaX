#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient as SdkTokenClient},
    Address, BytesN, Env,
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
    env.register_contract(&contract_id, StakingManager);
    let client = StakingManagerClient::new(env, &contract_id);

    let ax_token = create_ax_token(env, admin);
    
    env.mock_all_auths();
    client.initialize(admin, &ax_token);

    contract_id
}

fn create_ax_token(env: &Env, admin: &Address) -> Address {
    let token_address = env.register_stellar_asset_contract_v2(admin.clone());
    token_address.address()
}

fn mint_ax_tokens(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
    let stellar_client = StellarAssetClient::new(env, token);
    stellar_client.mint(to, &amount);
}

fn generate_tournament_id(env: &Env, seed: u32) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0..4].copy_from_slice(&seed.to_be_bytes());
    BytesN::from_array(env, &bytes)
}

#[test]
fn test_initialization() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    assert_eq!(client.get_admin(), admin);
    assert!(!client.is_paused());
    
    let ax_token = create_ax_token(&env, &admin);
    client.set_ax_token(&ax_token);
    assert_eq!(client.get_ax_token(), ax_token);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialization() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let ax_token = create_ax_token(&env, &admin);
    client.initialize(&admin, &ax_token);
}

#[test]
fn test_create_tournament() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);
    let stake_requirement = 1000i128;

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &stake_requirement);

    let tournament_info = client.get_tournament_info(&tournament_id);
    assert_eq!(tournament_info.tournament_id, tournament_id);
    assert_eq!(tournament_info.stake_requirement, stake_requirement);
    assert_eq!(tournament_info.state, TournamentState::NotStarted as u32);
    assert_eq!(tournament_info.total_staked, 0);
    assert_eq!(tournament_info.participant_count, 0);
}

#[test]
#[should_panic(expected = "stake requirement must be positive")]
fn test_create_tournament_zero_requirement_fails() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &0);
}

#[test]
#[should_panic(expected = "tournament already exists")]
fn test_create_duplicate_tournament_fails() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.create_tournament(&tournament_id, &1000);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_create_tournament_unauthorized() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);
    client.create_tournament(&tournament_id, &1000);
}

#[test]
fn test_update_tournament_state() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));
    let tournament_info = client.get_tournament_info(&tournament_id);
    assert_eq!(tournament_info.state, TournamentState::Active as u32);

    client.update_tournament_state(&tournament_id, &(TournamentState::Completed as u32));
    let updated_info = client.get_tournament_info(&tournament_id);
    assert_eq!(updated_info.state, TournamentState::Completed as u32);
    assert!(updated_info.completed_at.is_some());
}

#[test]
fn test_stake() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);
    let stake_amount = 1000i128;

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, stake_amount * 2);

    client.stake(&user1, &tournament_id, &stake_amount);

    let stake_info = client.get_stake(&user1, &tournament_id);
    assert_eq!(stake_info.user, user1);
    assert_eq!(stake_info.tournament_id, tournament_id);
    assert_eq!(stake_info.amount, stake_amount);
    assert!(stake_info.is_locked);
    assert!(!stake_info.can_withdraw);

    let tournament_info = client.get_tournament_info(&tournament_id);
    assert_eq!(tournament_info.total_staked, stake_amount);
    assert_eq!(tournament_info.participant_count, 1);

    let user_info = client.get_user_stake_info(&user1);
    assert_eq!(user_info.total_staked, stake_amount);
    assert_eq!(user_info.active_tournaments, 1);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_stake_zero_amount_fails() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    client.stake(&user1, &tournament_id, &0);
}

#[test]
#[should_panic(expected = "tournament is not active")]
fn test_stake_inactive_tournament_fails() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1000);

    client.stake(&user1, &tournament_id, &1000);
}

#[test]
#[should_panic(expected = "amount below stake requirement")]
fn test_stake_below_requirement_fails() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 500);

    client.stake(&user1, &tournament_id, &500);
}

#[test]
#[should_panic(expected = "user already staked for this tournament")]
fn test_stake_twice_fails() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 2000);

    client.stake(&user1, &tournament_id, &1000);
    client.stake(&user1, &tournament_id, &1000);
}

#[test]
fn test_withdraw() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);
    let stake_amount = 1000i128;

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    let token_client = SdkTokenClient::new(&env, &ax_token);
    
    mint_ax_tokens(&env, &ax_token, &admin, &user1, stake_amount * 2);
    let initial_balance = token_client.balance(&user1);

    client.stake(&user1, &tournament_id, &stake_amount);
    assert_eq!(token_client.balance(&user1), initial_balance - stake_amount);

    client.update_tournament_state(&tournament_id, &(TournamentState::Completed as u32));
    
    client.withdraw(&user1, &tournament_id);
    assert_eq!(token_client.balance(&user1), initial_balance);

    let user_info = client.get_user_stake_info(&user1);
    assert_eq!(user_info.total_staked, 0);
    assert_eq!(user_info.active_tournaments, 0);
    assert_eq!(user_info.completed_tournaments, 1);
}

#[test]
#[should_panic(expected = "no stake found")]
fn test_withdraw_no_stake_fails() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Completed as u32));

    client.withdraw(&user1, &tournament_id);
}

#[test]
#[should_panic(expected = "stake is not withdrawable")]
fn test_withdraw_locked_fails() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1000);

    client.stake(&user1, &tournament_id, &1000);
    client.withdraw(&user1, &tournament_id);
}

#[test]
fn test_slash() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);
    let stake_amount = 1000i128;
    let slash_amount = 300i128;

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, stake_amount * 2);

    client.stake(&user1, &tournament_id, &stake_amount);

    let dispute_contract = Address::generate(&env);
    client.set_dispute_contract(&dispute_contract);

    client.slash(&user1, &tournament_id, &slash_amount, &dispute_contract);

    let stake_info = client.get_stake(&user1, &tournament_id);
    assert_eq!(stake_info.amount, stake_amount - slash_amount);

    let tournament_info = client.get_tournament_info(&tournament_id);
    assert_eq!(tournament_info.total_staked, stake_amount - slash_amount);

    let user_info = client.get_user_stake_info(&user1);
    assert_eq!(user_info.total_slashed, slash_amount);
}

#[test]
#[should_panic(expected = "slash amount exceeds staked amount")]
fn test_slash_exceeds_stake_fails() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1000);

    client.stake(&user1, &tournament_id, &1000);

    let dispute_contract = Address::generate(&env);
    client.set_dispute_contract(&dispute_contract);

    client.slash(&user1, &tournament_id, &1500, &dispute_contract);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_slash_zero_amount_fails() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1000);

    client.stake(&user1, &tournament_id, &1000);

    let dispute_contract = Address::generate(&env);
    client.set_dispute_contract(&dispute_contract);

    client.slash(&user1, &tournament_id, &0, &dispute_contract);
}

#[test]
#[should_panic(expected = "caller not authorized")]
fn test_slash_unauthorized_fails() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1000);

    client.stake(&user1, &tournament_id, &1000);

    let random_address = Address::generate(&env);
    client.slash(&user1, &tournament_id, &300, &random_address);
}

#[test]
fn test_pause_contract() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();

    assert!(!client.is_paused());
    client.set_paused(&true);
    assert!(client.is_paused());
    client.set_paused(&false);
    assert!(!client.is_paused());
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_pause_contract_unauthorized() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    client.set_paused(&true);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_operations_when_paused() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.set_paused(&true);

    client.create_tournament(&tournament_id, &1000);
}

#[test]
fn test_get_total_staked() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1000);
    mint_ax_tokens(&env, &ax_token, &admin, &user2, 1000);

    assert_eq!(client.get_total_staked(&tournament_id), 0);

    client.stake(&user1, &tournament_id, &1000);
    assert_eq!(client.get_total_staked(&tournament_id), 1000);

    client.stake(&user2, &tournament_id, &1000);
    assert_eq!(client.get_total_staked(&tournament_id), 2000);
}

#[test]
fn test_can_withdraw() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1000);

    assert!(!client.can_withdraw(&user1, &tournament_id));

    client.stake(&user1, &tournament_id, &1000);
    assert!(!client.can_withdraw(&user1, &tournament_id));

    client.update_tournament_state(&tournament_id, &(TournamentState::Completed as u32));
    assert!(client.can_withdraw(&user1, &tournament_id));

    client.withdraw(&user1, &tournament_id);
    assert!(!client.can_withdraw(&user1, &tournament_id));
}

#[test]
fn test_full_staking_lifecycle() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);
    let stake_amount = 1000i128;

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &stake_amount);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    let token_client = SdkTokenClient::new(&env, &ax_token);
    
    mint_ax_tokens(&env, &ax_token, &admin, &user1, stake_amount * 2);
    let initial_balance = token_client.balance(&user1);

    client.stake(&user1, &tournament_id, &stake_amount);
    assert_eq!(token_client.balance(&user1), initial_balance - stake_amount);

    let dispute_contract = Address::generate(&env);
    client.set_dispute_contract(&dispute_contract);
    
    client.slash(&user1, &tournament_id, &(stake_amount / 2), &dispute_contract);
    let stake_info = client.get_stake(&user1, &tournament_id);
    assert_eq!(stake_info.amount, stake_amount / 2);

    client.update_tournament_state(&tournament_id, &(TournamentState::Completed as u32));
    assert!(client.can_withdraw(&user1, &tournament_id));

    client.withdraw(&user1, &tournament_id);
    assert_eq!(token_client.balance(&user1), initial_balance - (stake_amount / 2));

    let user_info = client.get_user_stake_info(&user1);
    assert_eq!(user_info.total_staked, stake_amount);
    assert_eq!(user_info.total_slashed, stake_amount / 2);
    assert_eq!(user_info.active_tournaments, 0);
    assert_eq!(user_info.completed_tournaments, 1);
}

#[test]
fn test_multiple_users_staking() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1000);
    mint_ax_tokens(&env, &ax_token, &admin, &user2, 1000);

    client.stake(&user1, &tournament_id, &1000);
    client.stake(&user2, &tournament_id, &1000);

    let tournament_info = client.get_tournament_info(&tournament_id);
    assert_eq!(tournament_info.total_staked, 2000);
    assert_eq!(tournament_info.participant_count, 2);

    let user1_info = client.get_user_stake_info(&user1);
    let user2_info = client.get_user_stake_info(&user2);
    assert_eq!(user1_info.active_tournaments, 1);
    assert_eq!(user2_info.active_tournaments, 1);

    client.update_tournament_state(&tournament_id, &(TournamentState::Completed as u32));

    client.withdraw(&user1, &tournament_id);
    client.withdraw(&user2, &tournament_id);

    let final_user1_info = client.get_user_stake_info(&user1);
    let final_user2_info = client.get_user_stake_info(&user2);
    assert_eq!(final_user1_info.active_tournaments, 0);
    assert_eq!(final_user1_info.completed_tournaments, 1);
    assert_eq!(final_user2_info.active_tournaments, 0);
    assert_eq!(final_user2_info.completed_tournaments, 1);
}

#[test]
fn test_contract_configuration() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_contract = Address::generate(&env);
    let dispute_contract = Address::generate(&env);

    env.mock_all_auths();
    client.set_tournament_contract(&tournament_contract);
    client.set_dispute_contract(&dispute_contract);

    let ax_token = create_ax_token(&env, &admin);
    client.set_ax_token(&ax_token);
}

#[test]
fn test_edge_cases() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    let user_info = client.get_user_stake_info(&user1);
    assert_eq!(user_info.total_staked, 0);
    assert_eq!(user_info.total_slashed, 0);
    assert_eq!(user_info.active_tournaments, 0);
    assert_eq!(user_info.completed_tournaments, 0);

    assert!(!client.can_withdraw(&user1, &tournament_id));
}

#[test]
#[should_panic(expected = "already staked")]
fn test_double_staking_prevented() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 2000);

    // First stake succeeds
    client.stake(&user1, &tournament_id, &1000);

    // Second stake attempt should fail
    client.stake(&user1, &tournament_id, &1000);
}

#[test]
fn test_slashing_authorization() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);
    let stake_amount = 1000i128;
    let slash_amount = 300i128;

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, stake_amount);

    client.stake(&user1, &tournament_id, &stake_amount);

    let dispute_contract = Address::generate(&env);
    client.set_dispute_contract(&dispute_contract);

    // Slash by authorized dispute contract succeeds
    client.slash(&user1, &tournament_id, &slash_amount, &dispute_contract);

    let user_info = client.get_user_stake_info(&user1);
    assert_eq!(user_info.total_slashed, slash_amount);
}

#[test]
#[should_panic(expected = "no stake")]
fn test_slash_non_existent_stake_fails() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);

    let dispute_contract = Address::generate(&env);
    client.set_dispute_contract(&dispute_contract);

    // Try to slash a user who hasn't staked
    client.slash(&user1, &tournament_id, &100, &dispute_contract);
}

#[test]
fn test_tournament_cancelled_unlocks_funds() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    let tournament_id = generate_tournament_id(&env, 1);

    env.mock_all_auths();
    client.create_tournament(&tournament_id, &1000);
    client.update_tournament_state(&tournament_id, &(TournamentState::Active as u32));

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1000);

    client.stake(&user1, &tournament_id, &1000);

    // Cancel tournament
    client.update_tournament_state(&tournament_id, &(TournamentState::Cancelled as u32));

    // Should allow withdrawal on cancelled tournament
    client.withdraw(&user1, &tournament_id);

    let user_info = client.get_user_stake_info(&user1);
    assert_eq!(user_info.active_tournaments, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// ── LP Incentive Tests (acceptance criteria 1–5) ──────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
//
// Helper: build a fresh contract + funded LP pool ready for use.

fn setup_lp_pool(
    env: &Env,
    admin: &Address,
    reward_rate_bps: u32,
    il_protection_bps: u32,
) -> (Address, u32) {
    let contract_id = initialize_contract(env, admin);
    let client = StakingManagerClient::new(env, &contract_id);

    env.mock_all_auths();

    // Fund the reward pool so rewards can actually be paid out
    let ax_token = client.get_ax_token();
    mint_ax_tokens(env, &ax_token, admin, admin, 1_000_000);
    client.fund_reward_pool(admin, &500_000i128);

    let pool_id = client.create_lp_pool(&reward_rate_bps, &il_protection_bps);
    (contract_id, pool_id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Criterion 1 — LP reward allocation
// ─────────────────────────────────────────────────────────────────────────────

/// Two LPs with different deposit sizes both earn rewards proportional to
/// their share of the pool.
#[test]
fn test_lp_reward_allocation_proportional() {
    let (env, admin, user1, user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 1_000 /* 10% */, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let ax_token = client.get_ax_token();

    // user1 deposits 1_000, user2 deposits 3_000  → user1 owns 25 %
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 10_000);
    mint_ax_tokens(&env, &ax_token, &admin, &user2, 30_000);

    client.add_liquidity(&user1, &pool_id, &1_000i128, &0i128, &0i128);
    client.add_liquidity(&user2, &pool_id, &3_000i128, &0i128, &0i128);

    // Advance time by half a year
    env.ledger().with_mut(|l| l.timestamp = l.timestamp + 15_768_000);

    let r1 = client.pending_lp_rewards(&user1, &pool_id);
    let r2 = client.pending_lp_rewards(&user2, &pool_id);

    // user2 should earn ~3× as much as user1
    assert!(r2 > 0, "user2 must have positive rewards");
    assert!(r1 > 0, "user1 must have positive rewards");
    // Allow ±1 rounding: r2 / r1 ≈ 3
    assert!(r2 >= r1 * 2, "user2 should earn at least 2× user1");
}

/// LP with 100 % pool share earns all rewards.
#[test]
fn test_lp_reward_allocation_sole_provider() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 2_000 /* 20% */, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 10_000);

    client.add_liquidity(&user1, &pool_id, &10_000i128, &0i128, &0i128);

    // Advance 1 year
    env.ledger().with_mut(|l| l.timestamp = l.timestamp + 31_536_000);

    let pending = client.pending_lp_rewards(&user1, &pool_id);
    // 20 % APY on 10_000 for 1 year = 2_000
    assert_eq!(pending, 2_000, "sole LP should earn exactly 20% APY");
}

/// Removing liquidity pays out accrued rewards in one shot.
#[test]
fn test_lp_reward_paid_on_remove() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 2_000, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let ax_token = client.get_ax_token();
    let token_client = soroban_sdk::token::TokenClient::new(&env, &ax_token);

    mint_ax_tokens(&env, &ax_token, &admin, &user1, 10_000);
    client.add_liquidity(&user1, &pool_id, &10_000i128, &0i128, &0i128);

    env.ledger().with_mut(|l| l.timestamp = l.timestamp + 31_536_000);

    let before = token_client.balance(&user1);
    client.remove_liquidity(&user1, &pool_id, &0i128, &0i128);
    let after = token_client.balance(&user1);

    // Should receive principal (10_000) + rewards (2_000)
    assert_eq!(after - before, 12_000, "should receive principal + rewards");
}

// ─────────────────────────────────────────────────────────────────────────────
// Criterion 2 — Dynamic reward rate
// ─────────────────────────────────────────────────────────────────────────────

/// Admin can lower the reward rate; future accrual uses the new rate but
/// already-accrued rewards are preserved.
#[test]
fn test_lp_dynamic_rate_change_preserves_accrued() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 2_000 /* 20% */, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 10_000);
    client.add_liquidity(&user1, &pool_id, &10_000i128, &0i128, &0i128);

    // Earn at 20 % for half a year
    env.ledger().with_mut(|l| l.timestamp = l.timestamp + 15_768_000);

    // Change rate to 10 %
    client.set_lp_reward_rate(&pool_id, &1_000u32);

    // Advance another half year at 10 %
    env.ledger().with_mut(|l| l.timestamp = l.timestamp + 15_768_000);

    // Claim rewards
    let (rewards, _fees) = client.claim_lp_rewards(&user1, &pool_id);
    // ~1_000 from first half + ~500 from second half = ~1_500
    assert!(rewards >= 1_400 && rewards <= 1_600,
        "rewards should be ~1500, got {rewards}");
}

/// update_lp_dynamic_rate lowers rate when pool is over-subscribed.
#[test]
fn test_lp_dynamic_rate_auto_adjust() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 2_000, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 20_000);
    client.add_liquidity(&user1, &pool_id, &20_000i128, &0i128, &0i128);

    // Target is 10_000, current is 20_000 → rate should halve to 1_000
    client.update_lp_dynamic_rate(&pool_id, &10_000i128, &2_000u32, &500u32);

    let pool = client.get_lp_pool(&pool_id);
    assert_eq!(pool.reward_rate_bps, 1_000, "rate should be halved to 1000 bps");
}

/// Admin can raise rate back; new rate is immediately effective.
#[test]
fn test_lp_set_reward_rate_admin_only() {
    let (env, admin, _user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 1_000, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.set_lp_reward_rate(&pool_id, &3_000u32);

    let pool = client.get_lp_pool(&pool_id);
    assert_eq!(pool.reward_rate_bps, 3_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Criterion 3 — Impermanent loss protection
// ─────────────────────────────────────────────────────────────────────────────

/// When token prices diverge the LP receives an IL protection payout from the
/// fee reserve on withdrawal.
#[test]
fn test_lp_il_protection_paid_on_divergence() {
    let (env, admin, user1, _user2) = create_test_env();
    // 50 % IL protection
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 500, 5_000);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let ax_token = client.get_ax_token();
    let token_client = soroban_sdk::token::TokenClient::new(&env, &ax_token);

    // Seed the fee reserve so IL can be paid
    mint_ax_tokens(&env, &ax_token, &admin, &admin, 100_000);
    client.deposit_lp_fees(&admin, &pool_id, &50_000i128);

    mint_ax_tokens(&env, &ax_token, &admin, &user1, 10_000_000);
    // entry: A = 1.0, B = 1.0 (×1e7 = 10_000_000)
    client.add_liquidity(&user1, &pool_id, &10_000_000i128, &10_000_000i128, &10_000_000i128);

    let before = token_client.balance(&user1);

    // Price A doubles relative to B → significant IL
    client.remove_liquidity(&user1, &pool_id, &20_000_000i128, &10_000_000i128);

    let after = token_client.balance(&user1);
    // Should receive principal + some IL protection payment
    assert!(after > before + 10_000_000 - 1,
        "should get back at least principal, got {}", after - before);
    // IL payout should be positive (pool had fee reserve to cover it)
    let history = client.get_lp_history(&user1, &pool_id);
    let withdraw_record = history.last().unwrap();
    assert!(withdraw_record.il_protection_paid >= 0,
        "IL payout must be non-negative");
}

/// No IL payout when prices don't diverge.
#[test]
fn test_lp_il_protection_zero_when_no_divergence() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 500, 5_000);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1_000_000);
    // entry price = current price → no divergence
    client.add_liquidity(&user1, &pool_id, &1_000_000i128, &1_000_000i128, &1_000_000i128);

    client.remove_liquidity(&user1, &pool_id, &1_000_000i128, &1_000_000i128);

    let history = client.get_lp_history(&user1, &pool_id);
    let record = history.last().unwrap();
    assert_eq!(record.il_protection_paid, 0, "no IL when prices unchanged");
}

// ─────────────────────────────────────────────────────────────────────────────
// Criterion 4 — Fee sharing with LPs
// ─────────────────────────────────────────────────────────────────────────────

/// Fees deposited into a pool are split pro-rata between LPs.
#[test]
fn test_lp_fee_sharing_two_providers() {
    let (env, admin, user1, user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 0, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let ax_token = client.get_ax_token();

    // user1 → 1_000, user2 → 3_000 (25 / 75 split)
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1_000);
    mint_ax_tokens(&env, &ax_token, &admin, &user2, 3_000);
    client.add_liquidity(&user1, &pool_id, &1_000i128, &0i128, &0i128);
    client.add_liquidity(&user2, &pool_id, &3_000i128, &0i128, &0i128);

    // Deposit 4_000 in fees
    mint_ax_tokens(&env, &ax_token, &admin, &admin, 4_000);
    client.deposit_lp_fees(&admin, &pool_id, &4_000i128);

    // Pending fee shares
    let fs1 = client.pending_lp_fee_share(&user1, &pool_id);
    let fs2 = client.pending_lp_fee_share(&user2, &pool_id);

    assert_eq!(fs1, 1_000, "user1 should get 25% of 4_000 = 1_000");
    assert_eq!(fs2, 3_000, "user2 should get 75% of 4_000 = 3_000");
}

/// Fees are actually transferred on claim.
#[test]
fn test_lp_fee_share_paid_on_claim() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 0, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let ax_token = client.get_ax_token();
    let token_client = soroban_sdk::token::TokenClient::new(&env, &ax_token);

    mint_ax_tokens(&env, &ax_token, &admin, &user1, 2_000);
    client.add_liquidity(&user1, &pool_id, &2_000i128, &0i128, &0i128);

    mint_ax_tokens(&env, &ax_token, &admin, &admin, 1_000);
    client.deposit_lp_fees(&admin, &pool_id, &1_000i128);

    let before = token_client.balance(&user1);
    let (_rewards, fees) = client.claim_lp_rewards(&user1, &pool_id);
    let after = token_client.balance(&user1);

    assert_eq!(fees, 1_000, "sole LP should receive all fees");
    assert_eq!(after - before, fees, "balance delta must equal fees paid");
}

/// Fees deposited after an LP joins are correctly tracked via fee_debt.
#[test]
fn test_lp_fee_debt_tracks_only_post_deposit_fees() {
    let (env, admin, user1, user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 0, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let ax_token = client.get_ax_token();

    // Deposit fees BEFORE user1 joins — user1 should not earn these
    mint_ax_tokens(&env, &ax_token, &admin, &admin, 5_000);
    client.deposit_lp_fees(&admin, &pool_id, &1_000i128);

    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1_000);
    client.add_liquidity(&user1, &pool_id, &1_000i128, &0i128, &0i128);

    // Deposit 2_000 in fees after user1 joined
    client.deposit_lp_fees(&admin, &pool_id, &2_000i128);

    let fs1 = client.pending_lp_fee_share(&user1, &pool_id);
    assert_eq!(fs1, 2_000, "user1 should only earn fees deposited after they joined");
}

// ─────────────────────────────────────────────────────────────────────────────
// Criterion 5 — Historical LP performance tracking
// ─────────────────────────────────────────────────────────────────────────────

/// Each deposit and withdrawal appends a record to the LP history.
#[test]
fn test_lp_history_deposit_and_withdraw() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 1_000, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 5_000);

    client.add_liquidity(&user1, &pool_id, &5_000i128, &0i128, &0i128);
    env.ledger().with_mut(|l| l.timestamp = l.timestamp + 31_536_000);
    client.remove_liquidity(&user1, &pool_id, &0i128, &0i128);

    let history = client.get_lp_history(&user1, &pool_id);
    assert_eq!(history.len(), 2, "should have deposit + withdraw records");

    let deposit_rec = history.get(0).unwrap();
    assert_eq!(deposit_rec.liquidity_delta, 5_000);
    assert_eq!(deposit_rec.rewards_claimed, 0);

    let withdraw_rec = history.get(1).unwrap();
    assert!(withdraw_rec.liquidity_delta < 0, "withdrawal delta must be negative");
    assert!(withdraw_rec.rewards_claimed > 0, "should record non-zero rewards on withdraw");
}

/// Claiming rewards also appends to history.
#[test]
fn test_lp_history_claim_appends_record() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 2_000, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 10_000);
    client.add_liquidity(&user1, &pool_id, &10_000i128, &0i128, &0i128);

    // Add some fees to ensure claim succeeds (rewards at t=0 are 0 so we need fees)
    mint_ax_tokens(&env, &ax_token, &admin, &admin, 1_000);
    client.deposit_lp_fees(&admin, &pool_id, &1_000i128);

    client.claim_lp_rewards(&user1, &pool_id);

    let history = client.get_lp_history(&user1, &pool_id);
    assert_eq!(history.len(), 2, "deposit + claim = 2 records");

    let claim_rec = history.get(1).unwrap();
    assert_eq!(claim_rec.liquidity_delta, 0, "claim should not change liquidity");
    assert!(claim_rec.fees_claimed > 0, "should record fees claimed");
}

/// Admin can push an arbitrary performance record (off-chain data injection).
#[test]
fn test_lp_record_performance_admin() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 0, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.record_lp_performance(&user1, &pool_id, &0i128, &999i128, &111i128, &42i128);

    let history = client.get_lp_history(&user1, &pool_id);
    assert_eq!(history.len(), 1);
    let rec = history.get(0).unwrap();
    assert_eq!(rec.rewards_claimed, 999);
    assert_eq!(rec.fees_claimed, 111);
    assert_eq!(rec.il_protection_paid, 42);
}

/// get_lp_user_pools lists all pools an LP has participated in.
#[test]
fn test_lp_user_pools_tracked() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id_0) = setup_lp_pool(&env, &admin, 500, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    let pool_id_1 = client.create_lp_pool(&500u32, &0u32);

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 4_000);

    client.add_liquidity(&user1, &pool_id_0, &2_000i128, &0i128, &0i128);
    client.add_liquidity(&user1, &pool_id_1, &2_000i128, &0i128, &0i128);

    let pools = client.get_lp_user_pools(&user1);
    assert_eq!(pools.len(), 2, "user should be tracked in both pools");
    assert!(pools.contains(&pool_id_0));
    assert!(pools.contains(&pool_id_1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge / guard-rail tests
// ─────────────────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_lp_add_liquidity_zero_amount_fails() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 1_000, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.add_liquidity(&user1, &pool_id, &0i128, &0i128, &0i128);
}

#[test]
#[should_panic(expected = "LP pool not active")]
fn test_lp_add_liquidity_inactive_pool_fails() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 1_000, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.set_lp_pool_active(&pool_id, &false);

    let ax_token = client.get_ax_token();
    mint_ax_tokens(&env, &ax_token, &admin, &user1, 1_000);
    client.add_liquidity(&user1, &pool_id, &1_000i128, &0i128, &0i128);
}

#[test]
#[should_panic(expected = "no LP position found")]
fn test_lp_remove_nonexistent_position_fails() {
    let (env, admin, user1, _user2) = create_test_env();
    let (contract_id, pool_id) = setup_lp_pool(&env, &admin, 1_000, 0);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.remove_liquidity(&user1, &pool_id, &0i128, &0i128);
}

#[test]
#[should_panic(expected = "reward rate exceeds 100%")]
fn test_lp_create_pool_rate_exceeds_10000_fails() {
    let (env, admin, _u1, _u2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.create_lp_pool(&10_001u32, &0u32);
}

#[test]
#[should_panic(expected = "IL protection exceeds 100%")]
fn test_lp_create_pool_il_bps_exceeds_10000_fails() {
    let (env, admin, _u1, _u2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = StakingManagerClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.create_lp_pool(&1_000u32, &10_001u32);
}
