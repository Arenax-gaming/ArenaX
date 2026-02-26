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
