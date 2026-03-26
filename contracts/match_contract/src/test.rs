#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{BytesN, Env};

// Mock User Identity Contract for testing
#[contract]
pub struct MockIdentityContract;

#[contractimpl]
impl MockIdentityContract {
    pub fn get_role(_env: Env, _user: Address) -> u32 {
        2
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
