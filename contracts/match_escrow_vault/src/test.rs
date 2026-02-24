#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient as SdkTokenClient},
    Address, BytesN, Env,
};

fn create_test_env() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    let treasury = Address::generate(&env);
    (env, admin, player_a, player_b, treasury)
}

fn initialize_contract(env: &Env, admin: &Address) -> Address {
    let contract_id = env.register(MatchEscrowVault, ());
    let client = MatchEscrowVaultClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(admin);

    contract_id
}

fn create_token(env: &Env, admin: &Address) -> Address {
    let token_address = env.register_stellar_asset_contract_v2(admin.clone());
    token_address.address()
}

fn mint_tokens(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
    let stellar_client = StellarAssetClient::new(env, token);
    stellar_client.mint(to, &amount);
}

fn generate_match_id(env: &Env, seed: u32) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0..4].copy_from_slice(&seed.to_be_bytes());
    BytesN::from_array(env, &bytes)
}

fn setup_escrow_with_deposits(
    env: &Env,
    contract_id: &Address,
    admin: &Address,
    player_a: &Address,
    player_b: &Address,
    treasury: &Address,
    amount: i128,
) -> (BytesN<32>, Address) {
    let client = MatchEscrowVaultClient::new(env, contract_id);
    let token = create_token(env, admin);
    let match_id = generate_match_id(env, 1);

    env.mock_all_auths();

    client.set_treasury(treasury);
    mint_tokens(env, &token, admin, player_a, amount * 2);
    mint_tokens(env, &token, admin, player_b, amount * 2);
    client.create_escrow(&match_id, player_a, player_b, &amount, &token);
    client.deposit(&match_id, player_a);
    client.deposit(&match_id, player_b);

    (match_id, token)
}

#[test]
fn test_initialize_success() {
    let (env, admin, _, _, _) = create_test_env();
    env.mock_all_auths();

    let contract_id = env.register(MatchEscrowVault, ());
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    client.initialize(&admin);

    assert_eq!(client.get_admin(), admin);
    assert!(!client.is_paused());
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_fails() {
    let (env, admin, _, _, _) = create_test_env();
    env.mock_all_auths();

    let contract_id = env.register(MatchEscrowVault, ());
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.initialize(&admin); // Should panic
}

#[test]
fn test_set_match_contract() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let match_contract = Address::generate(&env);

    env.mock_all_auths();
    client.set_match_contract(&match_contract);
}

#[test]
fn test_set_identity_contract() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let identity_contract = Address::generate(&env);

    env.mock_all_auths();
    client.set_identity_contract(&identity_contract);
}

#[test]
fn test_set_treasury() {
    let (env, admin, _, _, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.set_treasury(&treasury);
}

#[test]
fn test_pause_contract() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    env.mock_all_auths();

    assert!(!client.is_paused());
    client.set_paused(&true);
    assert!(client.is_paused());
    client.set_paused(&false);
    assert!(!client.is_paused());
}

#[test]
fn test_create_escrow_success() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);
    let amount = 1000i128;

    env.mock_all_auths();
    client.create_escrow(&match_id, &player_a, &player_b, &amount, &token);

    assert!(client.escrow_exists(&match_id));

    let escrow = client.get_escrow(&match_id);
    assert_eq!(escrow.player_a, player_a);
    assert_eq!(escrow.player_b, player_b);
    assert_eq!(escrow.amount, amount);
    assert_eq!(escrow.asset, token);
    assert_eq!(escrow.state, EscrowState::AwaitingDeposits as u32);
    assert!(!escrow.player_a_deposited);
    assert!(!escrow.player_b_deposited);
}

#[test]
#[should_panic(expected = "escrow already exists")]
fn test_create_escrow_duplicate_fails() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);

    env.mock_all_auths();
    client.create_escrow(&match_id, &player_a, &player_b, &1000, &token);
    client.create_escrow(&match_id, &player_a, &player_b, &1000, &token); // Should panic
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_create_escrow_zero_amount_fails() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);

    env.mock_all_auths();
    client.create_escrow(&match_id, &player_a, &player_b, &0, &token); // Should panic
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_create_escrow_negative_amount_fails() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);

    env.mock_all_auths();
    client.create_escrow(&match_id, &player_a, &player_b, &-100, &token); // Should panic
}

#[test]
#[should_panic(expected = "players must be different")]
fn test_create_escrow_same_player_fails() {
    let (env, admin, player_a, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);

    env.mock_all_auths();
    client.create_escrow(&match_id, &player_a, &player_a, &1000, &token); // Should panic
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_create_escrow_when_paused_fails() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);

    env.mock_all_auths();
    client.set_paused(&true);
    client.create_escrow(&match_id, &player_a, &player_b, &1000, &token); // Should panic
}

#[test]
fn test_deposit_player_a_success() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);
    let amount = 1000i128;

    env.mock_all_auths();

    mint_tokens(&env, &token, &admin, &player_a, amount);
    client.create_escrow(&match_id, &player_a, &player_b, &amount, &token);
    client.deposit(&match_id, &player_a);

    let escrow = client.get_escrow(&match_id);
    assert!(escrow.player_a_deposited);
    assert!(!escrow.player_b_deposited);
    assert_eq!(escrow.state, EscrowState::PlayerADeposited as u32);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&contract_id), amount);
    assert_eq!(token_client.balance(&player_a), 0);
}

#[test]
fn test_deposit_player_b_success() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);
    let amount = 1000i128;

    env.mock_all_auths();

    mint_tokens(&env, &token, &admin, &player_b, amount);
    client.create_escrow(&match_id, &player_a, &player_b, &amount, &token);
    client.deposit(&match_id, &player_b);

    let escrow = client.get_escrow(&match_id);
    assert!(!escrow.player_a_deposited);
    assert!(escrow.player_b_deposited);
    assert_eq!(escrow.state, EscrowState::PlayerBDeposited as u32);
}

#[test]
fn test_deposit_both_players_fully_funded() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);
    let amount = 1000i128;

    env.mock_all_auths();

    mint_tokens(&env, &token, &admin, &player_a, amount);
    mint_tokens(&env, &token, &admin, &player_b, amount);
    client.create_escrow(&match_id, &player_a, &player_b, &amount, &token);
    client.deposit(&match_id, &player_a);
    client.deposit(&match_id, &player_b);

    let escrow = client.get_escrow(&match_id);
    assert!(escrow.player_a_deposited);
    assert!(escrow.player_b_deposited);
    assert_eq!(escrow.state, EscrowState::FullyFunded as u32);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&contract_id), amount * 2);
}

#[test]
#[should_panic(expected = "player not in match")]
fn test_deposit_non_player_fails() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);
    let random_player = Address::generate(&env);

    env.mock_all_auths();

    client.create_escrow(&match_id, &player_a, &player_b, &1000, &token);
    client.deposit(&match_id, &random_player); // Should panic
}

#[test]
#[should_panic(expected = "player A already deposited")]
fn test_deposit_player_a_twice_fails() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);
    let amount = 1000i128;

    env.mock_all_auths();

    mint_tokens(&env, &token, &admin, &player_a, amount * 2);
    client.create_escrow(&match_id, &player_a, &player_b, &amount, &token);
    client.deposit(&match_id, &player_a);
    client.deposit(&match_id, &player_a); // Should panic
}

#[test]
#[should_panic(expected = "player B already deposited")]
fn test_deposit_player_b_twice_fails() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);
    let amount = 1000i128;

    env.mock_all_auths();

    mint_tokens(&env, &token, &admin, &player_b, amount * 2);
    client.create_escrow(&match_id, &player_a, &player_b, &amount, &token);
    client.deposit(&match_id, &player_b);
    client.deposit(&match_id, &player_b); // Should panic
}

#[test]
#[should_panic(expected = "escrow not found")]
fn test_deposit_nonexistent_escrow_fails() {
    let (env, admin, player_a, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let match_id = generate_match_id(&env, 999);

    env.mock_all_auths();
    client.deposit(&match_id, &player_a); // Should panic
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_deposit_when_paused_fails() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);

    env.mock_all_auths();

    mint_tokens(&env, &token, &admin, &player_a, 1000);
    client.create_escrow(&match_id, &player_a, &player_b, &1000, &token);
    client.set_paused(&true);
    client.deposit(&match_id, &player_a); // Should panic
}

#[test]
fn test_lock_funds_success() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    env.ledger().set_timestamp(12345);

    let (match_id, _) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);

    let escrow = client.get_escrow(&match_id);
    assert_eq!(escrow.state, EscrowState::Locked as u32);
    assert_eq!(escrow.locked_at, Some(12345));
}

#[test]
#[should_panic(expected = "escrow not fully funded")]
fn test_lock_funds_not_fully_funded_fails() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);

    env.mock_all_auths();

    mint_tokens(&env, &token, &admin, &player_a, 1000);
    client.create_escrow(&match_id, &player_a, &player_b, &1000, &token);
    client.deposit(&match_id, &player_a);
    client.lock_funds(&match_id);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_lock_funds_when_paused_fails() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, _) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.set_paused(&true);
    client.lock_funds(&match_id); // Should panic
}

#[test]
fn test_release_to_winner_player_a_wins() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    env.ledger().set_timestamp(12345);

    let (match_id, token) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);

    env.ledger().set_timestamp(12400);
    client.release_to_winner(&match_id, &player_a);

    let escrow = client.get_escrow(&match_id);
    assert_eq!(escrow.state, EscrowState::Released as u32);
    assert_eq!(escrow.released_at, Some(12400));

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&player_a), 2000);
    assert_eq!(token_client.balance(&contract_id), 0);
}

#[test]
fn test_release_to_winner_player_b_wins() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, token) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);
    client.release_to_winner(&match_id, &player_b);

    let escrow = client.get_escrow(&match_id);
    assert_eq!(escrow.state, EscrowState::Released as u32);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&player_b), 2000);
}

#[test]
#[should_panic(expected = "escrow not locked")]
fn test_release_to_winner_not_locked_fails() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, _) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.release_to_winner(&match_id, &player_a);
}

#[test]
#[should_panic(expected = "winner not in match")]
fn test_release_to_winner_invalid_winner_fails() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, _) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);

    let random_winner = Address::generate(&env);
    client.release_to_winner(&match_id, &random_winner); // Should panic
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_release_to_winner_when_paused_fails() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, _) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);
    client.set_paused(&true);
    client.release_to_winner(&match_id, &player_a); // Should panic
}

#[test]
fn test_refund_fully_funded() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, token) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.refund(&match_id);

    let escrow = client.get_escrow(&match_id);
    assert_eq!(escrow.state, EscrowState::Refunded as u32);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&player_a), 1000);
    assert_eq!(token_client.balance(&player_b), 1000);
    assert_eq!(token_client.balance(&contract_id), 0);
}

#[test]
fn test_refund_partial_deposit_player_a_only() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);
    let amount = 1000i128;

    env.mock_all_auths();

    mint_tokens(&env, &token, &admin, &player_a, amount);
    client.create_escrow(&match_id, &player_a, &player_b, &amount, &token);
    client.deposit(&match_id, &player_a);

    client.refund(&match_id);

    let escrow = client.get_escrow(&match_id);
    assert_eq!(escrow.state, EscrowState::Refunded as u32);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&player_a), 1000);
    assert_eq!(token_client.balance(&player_b), 0);
}

#[test]
fn test_refund_locked_escrow() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, token) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);
    client.refund(&match_id);

    let escrow = client.get_escrow(&match_id);
    assert_eq!(escrow.state, EscrowState::Refunded as u32);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&player_a), 1000);
    assert_eq!(token_client.balance(&player_b), 1000);
}

#[test]
#[should_panic(expected = "escrow already finalized")]
fn test_refund_already_released_fails() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, _) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);
    client.release_to_winner(&match_id, &player_a);
    client.refund(&match_id); // Should panic
}

#[test]
#[should_panic(expected = "escrow already finalized")]
fn test_refund_already_refunded_fails() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, _) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.refund(&match_id);
    client.refund(&match_id); // Should panic
}

#[test]
fn test_mark_disputed() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, _) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);
    client.mark_disputed(&match_id);

    let escrow = client.get_escrow(&match_id);
    assert_eq!(escrow.state, EscrowState::Disputed as u32);
}

#[test]
#[should_panic(expected = "escrow not locked")]
fn test_mark_disputed_not_locked_fails() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, _) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.mark_disputed(&match_id);
}

#[test]
fn test_resolve_dispute_success() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, token) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);
    client.mark_disputed(&match_id);

    client.resolve_dispute(&match_id, &player_b, &admin);

    let escrow = client.get_escrow(&match_id);
    assert_eq!(escrow.state, EscrowState::Released as u32);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&player_b), 2000);
}

#[test]
#[should_panic(expected = "escrow not disputed")]
fn test_resolve_dispute_not_disputed_fails() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, _) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);
    client.resolve_dispute(&match_id, &player_a, &admin);
}

#[test]
#[should_panic(expected = "winner not in match")]
fn test_resolve_dispute_invalid_winner_fails() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, _) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);
    client.mark_disputed(&match_id);

    let random_winner = Address::generate(&env);
    client.resolve_dispute(&match_id, &random_winner, &admin); // Should panic
}

#[test]
fn test_slash_stake_success() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (_, token) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.slash_stake(&player_a, &500, &token);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&treasury), 500);
    assert_eq!(token_client.balance(&contract_id), 1500);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_slash_stake_zero_amount_fails() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (_, token) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.slash_stake(&player_a, &0, &token); // Should panic
}

#[test]
#[should_panic(expected = "insufficient balance for slash")]
fn test_slash_stake_insufficient_balance_fails() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (_, token) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.slash_stake(&player_a, &5000, &token);
}

#[test]
fn test_emergency_withdraw_success() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, token) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    let emergency_recipient = Address::generate(&env);
    client.emergency_withdraw(&match_id, &emergency_recipient);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&emergency_recipient), 2000);
    assert_eq!(token_client.balance(&contract_id), 0);
}

#[test]
fn test_emergency_withdraw_partial_deposits() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);

    env.mock_all_auths();

    mint_tokens(&env, &token, &admin, &player_a, 1000);
    client.create_escrow(&match_id, &player_a, &player_b, &1000, &token);
    client.deposit(&match_id, &player_a);

    let emergency_recipient = Address::generate(&env);
    client.emergency_withdraw(&match_id, &emergency_recipient);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&emergency_recipient), 1000);
}

#[test]
fn test_reentrancy_guard_released_after_deposit() {
    let (env, admin, player_a, player_b, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);

    env.mock_all_auths();

    mint_tokens(&env, &token, &admin, &player_a, 2000);
    mint_tokens(&env, &token, &admin, &player_b, 1000);
    client.create_escrow(&match_id, &player_a, &player_b, &1000, &token);

    client.deposit(&match_id, &player_a);
    client.deposit(&match_id, &player_b);

    let escrow = client.get_escrow(&match_id);
    assert_eq!(escrow.state, EscrowState::FullyFunded as u32);
}

#[test]
fn test_full_lifecycle_happy_path() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    env.ledger().set_timestamp(1000);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);
    let amount = 1000i128;

    env.mock_all_auths();

    client.set_treasury(&treasury);
    mint_tokens(&env, &token, &admin, &player_a, amount);
    mint_tokens(&env, &token, &admin, &player_b, amount);

    client.create_escrow(&match_id, &player_a, &player_b, &amount, &token);
    assert_eq!(client.get_escrow_state(&match_id), EscrowState::AwaitingDeposits as u32);

    client.deposit(&match_id, &player_a);
    assert_eq!(client.get_escrow_state(&match_id), EscrowState::PlayerADeposited as u32);

    client.deposit(&match_id, &player_b);
    assert_eq!(client.get_escrow_state(&match_id), EscrowState::FullyFunded as u32);

    env.ledger().set_timestamp(2000);
    client.lock_funds(&match_id);
    assert_eq!(client.get_escrow_state(&match_id), EscrowState::Locked as u32);

    env.ledger().set_timestamp(3000);
    client.release_to_winner(&match_id, &player_a);
    assert_eq!(client.get_escrow_state(&match_id), EscrowState::Released as u32);

    let escrow = client.get_escrow(&match_id);
    assert_eq!(escrow.locked_at, Some(2000));
    assert_eq!(escrow.released_at, Some(3000));

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&player_a), 2000);
    assert_eq!(token_client.balance(&player_b), 0);
}

#[test]
fn test_full_lifecycle_with_dispute() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, token) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);
    client.mark_disputed(&match_id);
    assert_eq!(client.get_escrow_state(&match_id), EscrowState::Disputed as u32);

    client.resolve_dispute(&match_id, &player_b, &admin);
    assert_eq!(client.get_escrow_state(&match_id), EscrowState::Released as u32);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&player_b), 2000);
}

#[test]
fn test_full_lifecycle_with_cancellation() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, token) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.refund(&match_id);
    assert_eq!(client.get_escrow_state(&match_id), EscrowState::Refunded as u32);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&player_a), 1000);
    assert_eq!(token_client.balance(&player_b), 1000);
}

#[test]
fn test_multiple_escrows_independent() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);

    env.mock_all_auths();
    client.set_treasury(&treasury);

    let match_id_1 = generate_match_id(&env, 1);
    let match_id_2 = generate_match_id(&env, 2);

    mint_tokens(&env, &token, &admin, &player_a, 3000);
    mint_tokens(&env, &token, &admin, &player_b, 3000);

    client.create_escrow(&match_id_1, &player_a, &player_b, &1000, &token);
    client.create_escrow(&match_id_2, &player_a, &player_b, &500, &token);

    client.deposit(&match_id_1, &player_a);
    client.deposit(&match_id_1, &player_b);
    client.deposit(&match_id_2, &player_a);
    client.deposit(&match_id_2, &player_b);

    client.lock_funds(&match_id_1);
    client.release_to_winner(&match_id_1, &player_a);

    assert_eq!(client.get_escrow_state(&match_id_2), EscrowState::FullyFunded as u32);

    client.refund(&match_id_2);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&player_a), 4000);
    assert_eq!(token_client.balance(&player_b), 2000);
}

#[test]
fn test_large_amounts() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);
    let large_amount = i128::MAX / 4;

    env.mock_all_auths();
    client.set_treasury(&treasury);

    mint_tokens(&env, &token, &admin, &player_a, large_amount);
    mint_tokens(&env, &token, &admin, &player_b, large_amount);

    client.create_escrow(&match_id, &player_a, &player_b, &large_amount, &token);
    client.deposit(&match_id, &player_a);
    client.deposit(&match_id, &player_b);
    client.lock_funds(&match_id);
    client.release_to_winner(&match_id, &player_a);

    let token_client = SdkTokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&player_a), large_amount * 2);
}

#[test]
#[should_panic(expected = "invalid escrow state for deposit")]
fn test_deposit_after_lock_fails() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let (match_id, _) =
        setup_escrow_with_deposits(&env, &contract_id, &admin, &player_a, &player_b, &treasury, 1000);

    client.lock_funds(&match_id);

    client.deposit(&match_id, &player_a);
}

#[test]
fn test_view_functions() {
    let (env, admin, player_a, player_b, treasury) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = MatchEscrowVaultClient::new(&env, &contract_id);

    let token = create_token(&env, &admin);
    let match_id = generate_match_id(&env, 1);
    let nonexistent_match = generate_match_id(&env, 999);

    env.mock_all_auths();
    client.set_treasury(&treasury);

    assert!(!client.escrow_exists(&match_id));
    client.create_escrow(&match_id, &player_a, &player_b, &1000, &token);
    assert!(client.escrow_exists(&match_id));
    assert!(!client.escrow_exists(&nonexistent_match));
    assert_eq!(client.get_escrow_state(&match_id), EscrowState::AwaitingDeposits as u32);
    assert_eq!(client.get_admin(), admin);
    assert!(!client.is_paused());
}
