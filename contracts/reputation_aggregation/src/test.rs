#![cfg(test)]

use crate::storage::ReputationConfig;
use crate::{ArenaXReputationAggregation, ArenaXReputationAggregationClient, ReputationError};
use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, Env, Vec,
};

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXReputationAggregation, ());
    let client = ArenaXReputationAggregationClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    // Should initialize successfully
    client.initialize(&admin);

    // Should fail on double initialization
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(ReputationError::AlreadyInitialized)));
}

#[test]
fn test_add_remove_authorized_resolver() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXReputationAggregation, ());
    let client = ArenaXReputationAggregationClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);

    // Initialize first
    client.initialize(&admin);

    // Add resolver
    client.add_authorized_resolver(&resolver);

    // Check if authorized
    assert!(client.is_authorized_resolver(&resolver));

    // Remove resolver
    client.remove_authorized_resolver(&resolver);

    // Check if no longer authorized
    assert!(!client.is_authorized_resolver(&resolver));
}

#[test]
fn test_update_reputation_win() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXReputationAggregation, ());
    let client = ArenaXReputationAggregationClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player = Address::generate(&env);

    // Initialize and authorize resolver
    client.initialize(&admin);
    client.add_authorized_resolver(&resolver);

    // Update reputation with win
    client.update_reputation(&resolver, &player, &0u32, &1u64);

    // Check reputation
    let reputation = client.get_reputation(&player);
    assert_eq!(reputation.wins, 1);
    assert_eq!(reputation.losses, 0);
    assert_eq!(reputation.draws, 0);
    assert_eq!(reputation.matches_played, 1);
    assert_eq!(reputation.score, 1025); // 1000 + 25
}

#[test]
fn test_update_reputation_loss() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXReputationAggregation, ());
    let client = ArenaXReputationAggregationClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player = Address::generate(&env);

    // Initialize and authorize resolver
    client.initialize(&admin);
    client.add_authorized_resolver(&resolver);

    // Update reputation with loss
    client.update_reputation(&resolver, &player, &1u32, &1u64);

    // Check reputation
    let reputation = client.get_reputation(&player);
    assert_eq!(reputation.wins, 0);
    assert_eq!(reputation.losses, 1);
    assert_eq!(reputation.draws, 0);
    assert_eq!(reputation.matches_played, 1);
    assert_eq!(reputation.score, 990); // 1000 - 10
}

#[test]
fn test_update_reputation_draw() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXReputationAggregation, ());
    let client = ArenaXReputationAggregationClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player = Address::generate(&env);

    // Initialize and authorize resolver
    client.initialize(&admin);
    client.add_authorized_resolver(&resolver);

    // Update reputation with draw
    client.update_reputation(&resolver, &player, &2u32, &1u64);

    // Check reputation
    let reputation = client.get_reputation(&player);
    assert_eq!(reputation.wins, 0);
    assert_eq!(reputation.losses, 0);
    assert_eq!(reputation.draws, 1);
    assert_eq!(reputation.matches_played, 1);
    assert_eq!(reputation.score, 1005); // 1000 + 5
}

#[test]
fn test_multiple_matches() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXReputationAggregation, ());
    let client = ArenaXReputationAggregationClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player = Address::generate(&env);

    // Initialize and authorize resolver
    client.initialize(&admin);
    client.add_authorized_resolver(&resolver);

    // Win, Loss, Draw
    client.update_reputation(&resolver, &player, &0u32, &1u64); // Win
    client.update_reputation(&resolver, &player, &1u32, &2u64); // Loss
    client.update_reputation(&resolver, &player, &2u32, &3u64); // Draw

    // Check reputation
    let reputation = client.get_reputation(&player);
    assert_eq!(reputation.wins, 1);
    assert_eq!(reputation.losses, 1);
    assert_eq!(reputation.draws, 1);
    assert_eq!(reputation.matches_played, 3);
    assert_eq!(reputation.score, 1020); // 1000 + 25 - 10 + 5
}

#[test]
fn test_unauthorized_update() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXReputationAggregation, ());
    let client = ArenaXReputationAggregationClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let player = Address::generate(&env);

    // Initialize without authorizing anyone
    client.initialize(&admin);

    // Try to update reputation with unauthorized address
    let result = client.try_update_reputation(&unauthorized, &player, &0u32, &1u64);
    assert_eq!(result, Err(Ok(ReputationError::Unauthorized)));
}

#[test]
fn test_invalid_outcome() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXReputationAggregation, ());
    let client = ArenaXReputationAggregationClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player = Address::generate(&env);

    // Initialize and authorize resolver
    client.initialize(&admin);
    client.add_authorized_resolver(&resolver);

    // Try to update with invalid outcome
    let result = client.try_update_reputation(&resolver, &player, &3u32, &1u64);
    assert_eq!(result, Err(Ok(ReputationError::InvalidMatchOutcome)));
}

#[test]
fn test_score_floor() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXReputationAggregation, ());
    let client = ArenaXReputationAggregationClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player = Address::generate(&env);

    // Initialize and authorize resolver
    client.initialize(&admin);
    client.add_authorized_resolver(&resolver);

    // Update config with high loss penalty
    let harsh_config = ReputationConfig {
        win_weight: 25,
        loss_weight: -100, // High penalty
        draw_weight: 5,
        base_score: 50, // Low starting score
        decay_factor: 0,
    };
    client.update_config(&harsh_config);

    // Loss that would bring score below 0
    client.update_reputation(&resolver, &player, &1u32, &1u64);

    // Check that score is floored at 0
    let reputation = client.get_reputation(&player);
    assert_eq!(reputation.score, 0); // Should not go below 0
}

#[test]
fn test_individual_queries() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXReputationAggregation, ());
    let client = ArenaXReputationAggregationClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player = Address::generate(&env);

    // Initialize and authorize resolver
    client.initialize(&admin);
    client.add_authorized_resolver(&resolver);

    // Add some matches
    client.update_reputation(&resolver, &player, &0u32, &1u64); // Win

    // Test individual queries
    assert_eq!(client.get_wins(&player), 1);
    assert_eq!(client.get_losses(&player), 0);
    assert_eq!(client.get_draws(&player), 0);
    assert_eq!(client.get_matches_played(&player), 1);
    assert_eq!(client.get_score(&player), 1025);
}

#[test]
fn test_batch_reputations() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXReputationAggregation, ());
    let client = ArenaXReputationAggregationClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    // Initialize and authorize resolver
    client.initialize(&admin);
    client.add_authorized_resolver(&resolver);

    // Add matches for both players
    client.update_reputation(&resolver, &player1, &0u32, &1u64); // Win
    client.update_reputation(&resolver, &player2, &1u32, &2u64); // Loss

    // Get batch reputations
    let players = Vec::from_array(&env, [player1.clone(), player2.clone()]);
    let reputations = client.get_batch_reputations(&players);

    assert_eq!(reputations.len(), 2);
    assert_eq!(reputations.get(0).unwrap().score, 1025); // Win
    assert_eq!(reputations.get(1).unwrap().score, 990); // Loss
}

#[test]
fn test_events() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXReputationAggregation, ());
    let client = ArenaXReputationAggregationClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player = Address::generate(&env);

    // Initialize and authorize resolver
    client.initialize(&admin);
    client.add_authorized_resolver(&resolver);

    // Update reputation
    client.update_reputation(&resolver, &player, &0u32, &1u64);

    // Check events were emitted
    let events = env.events().all();
    assert!(events.len() >= 2); // At least ReputationUpdated and MatchRecorded

    // Events were emitted (topics verification would require complex symbol creation)
}
