#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{BytesN, Env, Vec};

fn setup(env: &Env) -> (MatchLifecycleContractClient<'_>, Address, Vec<Address>, BytesN<32>) {
    env.mock_all_auths();
    env.ledger().set_timestamp(12345);

    let contract_id = env.register(MatchLifecycleContract, ());
    let client = MatchLifecycleContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    client.initialize(&admin);

    let mut players: Vec<Address> = Vec::new(env);
    let player_a = Address::generate(env);
    let player_b = Address::generate(env);
    players.push_back(player_a.clone());
    players.push_back(player_b.clone());

    let stake_asset = Address::generate(env);
    let match_id = BytesN::from_array(env, &[1u8; 32]);

    (client, stake_asset, players, match_id)
}

#[test]
fn test_create_match_and_lifecycle() {
    let env = Env::default();
    let (client, stake_asset, players, match_id) = setup(&env);

    client.create_match(&match_id, &players, &stake_asset, &1000);
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::Created as u32);
    assert_eq!(data.stake_amount, 1000);
    assert_eq!(data.players.len(), 2);
}

#[test]
fn test_submit_result_dual_reporting_agree() {
    let env = Env::default();
    let (client, stake_asset, players, match_id) = setup(&env);
    let player_a = players.get(0).unwrap();
    let player_b = players.get(1).unwrap();

    client.create_match(&match_id, &players, &stake_asset, &1000);

    client.submit_result(&match_id, &player_a, &0); // score 0 = player 0 wins
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::InProgress as u32);
    assert!(data.report1_reporter.is_some());
    assert_eq!(data.report1_score, Some(0));

    client.submit_result(&match_id, &player_b, &0); // same score
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::PendingResult as u32);
    assert!(data.report2_reporter.is_some());
    assert_eq!(data.report2_score, Some(0));
}

#[test]
fn test_submit_result_dual_reporting_dispute() {
    let env = Env::default();
    let (client, stake_asset, players, match_id) = setup(&env);
    let player_a = players.get(0).unwrap();
    let player_b = players.get(1).unwrap();

    client.create_match(&match_id, &players, &stake_asset, &1000);
    client.submit_result(&match_id, &player_a, &0);
    client.submit_result(&match_id, &player_b, &1); // different score -> dispute
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::Disputed as u32);
}

#[test]
fn test_finalize_match_as_participant() {
    let env = Env::default();
    let (client, stake_asset, players, match_id) = setup(&env);
    let player_a = players.get(0).unwrap();
    let player_b = players.get(1).unwrap();

    client.create_match(&match_id, &players, &stake_asset, &1000);
    client.submit_result(&match_id, &player_a, &0);
    client.submit_result(&match_id, &player_b, &0);

    client.finalize_match(&match_id, &player_a);
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::Finalized as u32);
    assert_eq!(data.winner, Some(player_a));
    assert!(data.finalized_at.is_some());
}

#[test]
#[should_panic(expected = "same reporter cannot submit twice")]
fn test_submit_result_same_reporter_twice_fails() {
    let env = Env::default();
    let (client, stake_asset, players, match_id) = setup(&env);
    let player_a = players.get(0).unwrap();

    client.create_match(&match_id, &players, &stake_asset, &1000);
    client.submit_result(&match_id, &player_a, &0);
    client.submit_result(&match_id, &player_a, &0);
}

#[test]
#[should_panic(expected = "match must be in PendingResult to finalize")]
fn test_finalize_before_pending_result_fails() {
    let env = Env::default();
    let (client, stake_asset, players, match_id) = setup(&env);
    let player_a = players.get(0).unwrap();

    client.create_match(&match_id, &players, &stake_asset, &1000);
    client.finalize_match(&match_id, &player_a);
}

#[test]
#[should_panic(expected = "reporter must be a participant")]
fn test_submit_result_non_participant_fails() {
    let env = Env::default();
    let (client, stake_asset, players, match_id) = setup(&env);
    let outsider = Address::generate(&env);

    client.create_match(&match_id, &players, &stake_asset, &1000);
    client.submit_result(&match_id, &outsider, &0);
}

#[test]
fn test_finalize_match_as_operator() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(MatchLifecycleContract, ());
    let client = MatchLifecycleContractClient::new(&env, &contract_id);
    client.initialize(&admin);
    let mut players: Vec<Address> = Vec::new(&env);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    players.push_back(player_a.clone());
    players.push_back(player_b.clone());
    let stake_asset = Address::generate(&env);
    let match_id = BytesN::from_array(&env, &[3u8; 32]);
    client.create_match(&match_id, &players, &stake_asset, &1000);
    client.submit_result(&match_id, &player_a, &1);
    client.submit_result(&match_id, &player_b, &1);
    client.finalize_match(&match_id, &admin);
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::Finalized as u32);
    assert_eq!(data.winner, Some(player_b));
}

#[test]
fn test_match_exists() {
    let env = Env::default();
    let (client, stake_asset, players, match_id) = setup(&env);
    let other_id = BytesN::from_array(&env, &[2u8; 32]);

    assert!(!client.match_exists(&match_id));
    assert!(!client.match_exists(&other_id));
    client.create_match(&match_id, &players, &stake_asset, &1000);
    assert!(client.match_exists(&match_id));
    assert!(!client.match_exists(&other_id));
}
