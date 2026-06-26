#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{BytesN, Env, contract, contractimpl};

// Mock User Identity Contract for testing
#[contract]
pub struct MockIdentityContract;

#[contractimpl]
impl MockIdentityContract {
    pub fn get_role(_env: Env, _user: Address) -> u32 {
        2
    }
}

#[contract]
pub struct MockEmergencyPauseContract;

#[contractimpl]
impl MockEmergencyPauseContract {
    pub fn is_paused(_env: Env, _contract: Address) -> bool {
        false
    }
}

#[contract]
pub struct MockPausedEmergencyContract;

#[contractimpl]
impl MockPausedEmergencyContract {
    pub fn is_paused(_env: Env, _contract: Address) -> bool {
        true
    }
}

#[test]
fn test_match_lifecycle_success() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(12345);

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);

    let match_id = BytesN::from_array(&env, &[0u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::Created as u32);

    client.start_match(&match_id);
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::Started as u32);
    assert_eq!(data.started_at, 12345);

    // Advance time for completion
    env.ledger().set_timestamp(12346);
    client.complete_match(&match_id, &player_a);
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::Completed as u32);
    assert_eq!(data.winner, Some(player_a));
    assert_eq!(data.ended_at, Some(12346));
}

#[test]
fn test_dispute_resolution() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(12345);

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);

    let identity_contract_id = env.register(MockIdentityContract, ());

    let match_id = BytesN::from_array(&env, &[1u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    let referee = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    client.start_match(&match_id);
    client.raise_dispute(&match_id);

    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::Disputed as u32);

    env.ledger().set_timestamp(12346);
    client.resolve_dispute(&match_id, &player_b, &identity_contract_id, &referee);
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::Completed as u32);
    assert_eq!(data.winner, Some(player_b));
    assert_eq!(data.ended_at, Some(12346));
}

#[test]
#[should_panic(expected = "invalid state transition")]
fn test_invalid_transition() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);

    let match_id = BytesN::from_array(&env, &[2u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    client.complete_match(&match_id, &player_a);
}

#[test]
fn test_cancel_match() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);

    let match_id = BytesN::from_array(&env, &[3u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    client.cancel_match(&match_id);
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::Cancelled as u32);
}

#[test]
#[should_panic(expected = "match already exists")]
fn test_create_duplicate_match() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);

    let match_id = BytesN::from_array(&env, &[4u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    client.create_match(&match_id, &player_a, &player_b);
}

#[test]
#[should_panic(expected = "winner must be one of the players")]
fn test_complete_with_invalid_winner() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);

    let match_id = BytesN::from_array(&env, &[5u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    let invalid_winner = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    client.start_match(&match_id);
    client.complete_match(&match_id, &invalid_winner);
}

#[test]
#[should_panic(expected = "winner must be one of the players")]
fn test_resolve_dispute_with_invalid_winner() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);

    let identity_contract_id = env.register(MockIdentityContract, ());
    let match_id = BytesN::from_array(&env, &[6u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    let referee = Address::generate(&env);
    let invalid_winner = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    client.start_match(&match_id);
    client.raise_dispute(&match_id);
    client.resolve_dispute(&match_id, &invalid_winner, &identity_contract_id, &referee);
}

#[test]
#[should_panic(expected = "invalid state transition")]
fn test_start_from_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);

    let match_id = BytesN::from_array(&env, &[7u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    client.cancel_match(&match_id);
    client.start_match(&match_id);
}

#[test]
#[should_panic(expected = "invalid state transition")]
fn test_cancel_from_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);

    let match_id = BytesN::from_array(&env, &[8u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    client.start_match(&match_id);
    client.cancel_match(&match_id);
}

#[test]
#[should_panic(expected = "invalid state transition")]
fn test_dispute_from_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);

    let match_id = BytesN::from_array(&env, &[9u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    client.raise_dispute(&match_id);
}

#[test]
#[should_panic(expected = "invalid state transition")]
fn test_resolve_dispute_from_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);
    let identity_contract_id = env.register(MockIdentityContract, ());

    let match_id = BytesN::from_array(&env, &[10u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    let referee = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    client.resolve_dispute(&match_id, &player_a, &identity_contract_id, &referee);
}

#[test]
#[should_panic(expected = "only referee or admin can resolve disputes")]
fn test_resolve_dispute_unauthorized_role() {
    #[contract]
    struct MockUnauthorizedIdentityContract;
    #[contractimpl]
    impl MockUnauthorizedIdentityContract {
        pub fn get_role(_env: Env, _user: Address) -> u32 {
            0 // Not authorized
        }
    }

    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);
    let identity_contract_id = env.register(MockUnauthorizedIdentityContract, ());
    let match_id = BytesN::from_array(&env, &[11u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    let referee = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    client.start_match(&match_id);
    client.raise_dispute(&match_id);
    client.resolve_dispute(&match_id, &player_a, &identity_contract_id, &referee);
}

#[test]
#[should_panic(expected = "contract execution is paused")]
fn test_create_match_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);
    let pause_contract_id = env.register(MockPausedEmergencyContract, ());
    let admin = Address::generate(&env);
    client.set_pause_contract(&admin, &pause_contract_id);

    let match_id = BytesN::from_array(&env, &[12u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
}

#[test]
fn test_set_pause_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MatchContract, ());
    let client = MatchContractClient::new(&env, &contract_id);
    let pause_contract_id = env.register(MockEmergencyPauseContract, ());
    let admin = Address::generate(&env);

    client.set_pause_contract(&admin, &pause_contract_id);

    // Should work fine
    let match_id = BytesN::from_array(&env, &[13u8; 32]);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    client.create_match(&match_id, &player_a, &player_b);
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::Created as u32);
}
