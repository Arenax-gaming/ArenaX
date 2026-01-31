#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, BytesN, Env, Vec};

// Mock Match Contract for testing
#[contract]
pub struct MockMatchContract;

#[contractimpl]
impl MockMatchContract {
    pub fn get_match(env: Env, _match_id: BytesN<32>) -> match_contract::MatchData {
        match_contract::MatchData {
            player_a: Address::generate(&env),
            player_b: Address::generate(&env),
            state: 2, // MatchState::Completed
            winner: Some(Address::generate(&env)),
            started_at: 0,
            ended_at: Some(0),
        }
    }
}

#[test]
fn test_tournament_finalization_success() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(100);

    let admin = Address::generate(&env);
    let match_contract_addr = env.register(MockMatchContract, ());

    let contract_id = env.register(TournamentFinalizer, ());
    let client = TournamentFinalizerClient::new(&env, &contract_id);

    client.initialize(&admin, &match_contract_addr);

    let tournament_id = BytesN::from_array(&env, &[1u8; 32]);
    let match_ids = Vec::from_array(&env, [BytesN::from_array(&env, &[2u8; 32])]);

    let rankings = Vec::from_array(
        &env,
        [RankingEntry {
            player: Address::generate(&env),
            position: 1,
            score: 100,
        }],
    );

    let rewards = Vec::from_array(
        &env,
        [RewardAllocation {
            player: rankings.get(0).unwrap().player.clone(),
            amount: 1000,
            asset: Address::generate(&env),
        }],
    );

    client.finalize_tournament(&tournament_id, &match_ids, &rankings, &rewards);

    assert!(client.is_finalized(&tournament_id));

    let snapshot = client.get_tournament_snapshot(&tournament_id);
    assert_eq!(snapshot.tournament_id, tournament_id);
    assert_eq!(snapshot.finalized_at, 100);
}

#[test]
#[should_panic(expected = "tournament already finalized")]
fn test_prevent_re_finalization() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let match_contract_addr = env.register(MockMatchContract, ());

    let contract_id = env.register(TournamentFinalizer, ());
    let client = TournamentFinalizerClient::new(&env, &contract_id);

    client.initialize(&admin, &match_contract_addr);

    let tournament_id = BytesN::from_array(&env, &[1u8; 32]);
    let match_ids = Vec::new(&env);
    let rankings = Vec::new(&env);
    let rewards = Vec::new(&env);

    client.finalize_tournament(&tournament_id, &match_ids, &rankings, &rewards);
    client.finalize_tournament(&tournament_id, &match_ids, &rankings, &rewards);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_prevent_re_initialization() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let match_contract_addr = Address::generate(&env);

    let contract_id = env.register(TournamentFinalizer, ());
    let client = TournamentFinalizerClient::new(&env, &contract_id);

    client.initialize(&admin, &match_contract_addr);
    client.initialize(&admin, &match_contract_addr);
}
