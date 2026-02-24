#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, vec, Address, Env};

#[test]
fn test_reputation_index() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let match_contract = Address::generate(&env);
    let player1 = Address::generate(&env);
    
    let contract_id = env.register(ReputationIndex, ());
    let client = ReputationIndexClient::new(&env, &contract_id);

    // Initialize with 10 points decay per day
    client.initialize(&admin, &match_contract, &10);

    // Initial reputation (default)
    let rep = client.get_reputation(&player1);
    assert_eq!(rep.skill, 1000);
    assert_eq!(rep.fair_play, 100);

    // Update match outcome
    let players = vec![&env, player1.clone()];
    let outcomes = vec![&env, 25i128]; // +25 skill
    client.update_on_match(&1, &players, &outcomes);

    let rep = client.get_reputation(&player1);
    assert_eq!(rep.skill, 1025);
    assert_eq!(rep.fair_play, 101);

    // Test decay after 1 day (86400 seconds)
    let one_day_later = env.ledger().timestamp() + 86400;
    client.apply_decay(&player1, &one_day_later);

    let rep = client.get_reputation(&player1);
    // 1025 - 10 = 1015
    // 101 - 10 = 91
    assert_eq!(rep.skill, 1015);
    assert_eq!(rep.fair_play, 91);
    assert_eq!(rep.last_update_ts, one_day_later);
}
