#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, Env};

fn setup() -> (Env, Address, PlayerReputationContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PlayerReputationContract, ());
    let client = PlayerReputationContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    (env, admin, client)
}

#[test]
fn test_initialize() {
    let (_, _, client) = setup();
    // Double-init should fail
    let admin2 = Address::generate(&client.env);
    let result = client.try_initialize(&admin2);
    assert!(result.is_err());
}

#[test]
fn test_update_reputation_win() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    let new_score = client.update_reputation(&player, &0u32, &50i128); // ACTION_WIN
    assert!(new_score > 1000); // base 1000 + 50
}

#[test]
fn test_update_reputation_loss() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    let new_score = client.update_reputation(&player, &1u32, &30i128); // ACTION_LOSS
    assert!(new_score < 1000); // base 1000 - 30
}

#[test]
fn test_update_reputation_draw() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    let new_score = client.update_reputation(&player, &2u32, &30i128); // ACTION_DRAW
                                                                       // Draw gives impact/3 = 10 points
    assert!(new_score >= 1000);
}

#[test]
fn test_update_reputation_penalty() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    let new_score = client.update_reputation(&player, &3u32, &100i128); // ACTION_PENALTY
    assert!(new_score < 1000);
}

#[test]
fn test_update_reputation_bonus() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    let new_score = client.update_reputation(&player, &4u32, &200i128); // ACTION_BONUS
    assert_eq!(new_score, 1200);
}

#[test]
fn test_calculate_skill_rating() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    // game_history: [opp_rating, outcome, ...] — beat a 1000-rated opponent
    let history = vec![&env, 1000i128, 1i128]; // opponent 1000, outcome win
    let new_rating = client.calculate_skill_rating(&player, &history);
    // Should be close to 1000 + K/2 = 1016
    assert!(new_rating > 1000);
}

#[test]
fn test_calculate_skill_rating_loss() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    let history = vec![&env, 1000i128, 0i128]; // opponent 1000, outcome loss
    let new_rating = client.calculate_skill_rating(&player, &history);
    assert!(new_rating < 1000);
}

#[test]
fn test_unlock_achievement() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    client.unlock_achievement(&player, &1u32);

    assert!(client.is_achievement_unlocked(&player, &1u32));
    assert!(!client.is_achievement_unlocked(&player, &2u32));

    // Reputation should have increased by ACHIEVEMENT_BONUS (25)
    let score = client.get_reputation_score(&player);
    assert!(score > 1000);
}

#[test]
fn test_unlock_achievement_duplicate_fails() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    client.unlock_achievement(&player, &5u32);

    let result = client.try_unlock_achievement(&player, &5u32);
    assert!(result.is_err());
}

#[test]
fn test_record_sportsmanship() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    let reviewer = Address::generate(&env);

    client.record_sportsmanship(&player, &5u32, &reviewer);

    let profile = client.get_player_profile(&player);
    assert_eq!(profile.review_count, 1);
    assert_eq!(profile.sportsmanship_score, 100); // 5 * 20 = 100
}

#[test]
fn test_sportsmanship_self_review_fails() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    let result = client.try_record_sportsmanship(&player, &5u32, &player);
    assert!(result.is_err());
}

#[test]
fn test_sportsmanship_invalid_rating_fails() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    let reviewer = Address::generate(&env);

    // Rating 0 is invalid
    let result = client.try_record_sportsmanship(&player, &0u32, &reviewer);
    assert!(result.is_err());

    // Rating 6 is invalid (max is 5)
    let result = client.try_record_sportsmanship(&player, &6u32, &reviewer);
    assert!(result.is_err());
}

#[test]
fn test_sportsmanship_duplicate_review_fails() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    let reviewer = Address::generate(&env);

    client.record_sportsmanship(&player, &4u32, &reviewer);
    let result = client.try_record_sportsmanship(&player, &5u32, &reviewer);
    assert!(result.is_err());
}

#[test]
fn test_verify_reputation_pass() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    // Default score is 1000, verify against 500 should pass
    assert!(client.verify_reputation(&player, &500i128));
}

#[test]
fn test_verify_reputation_fail() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    // Default score is 1000, verify against 9999 should fail
    assert!(!client.verify_reputation(&player, &9999i128));
}

#[test]
fn test_reputation_decay() {
    let (env, _, client) = setup();

    let player = Address::generate(&env);
    // Set initial timestamp
    env.ledger().set_timestamp(1000);
    client.update_reputation(&player, &4u32, &0i128); // touch to create profile

    // Advance time past grace period (30 days = 2_592_000 secs) + 10 more days
    let future_ts = 1000 + (40 * 86_400u64);
    env.ledger().set_timestamp(future_ts);

    let score_after_decay = client.apply_decay(&player);
    // Should have decayed: 10 days * 2 pts/day = 20 pts
    assert!(score_after_decay < 1000);
}

#[test]
fn test_no_decay_within_grace_period() {
    let (env, _, client) = setup();

    let player = Address::generate(&env);
    env.ledger().set_timestamp(1000);
    client.update_reputation(&player, &4u32, &0i128);

    // Advance only 10 days (within 30-day grace period)
    env.ledger().set_timestamp(1000 + 10 * 86_400u64);
    let score = client.apply_decay(&player);
    assert_eq!(score, 1000); // no decay
}

#[test]
fn test_privacy_settings() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    client.set_privacy(&player, &true);

    let profile = client.get_player_profile(&player);
    assert!(profile.is_private);

    client.set_privacy(&player, &false);
    let profile = client.get_player_profile(&player);
    assert!(!profile.is_private);
}

#[test]
fn test_get_reputation_score_composite() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    // Win to boost skill
    client.update_reputation(&player, &0u32, &100i128);
    // Unlock achievement
    client.unlock_achievement(&player, &0u32);
    // Get composite score
    let score = client.get_reputation_score(&player);
    assert!(score > 1000);
}

#[test]
fn test_add_remove_authorized_updater() {
    let (env, _, client) = setup();

    let updater = Address::generate(&env);
    client.add_authorized_updater(&updater);
    client.remove_authorized_updater(&updater);
    // No panic = success
}

#[test]
fn test_multiple_sportsmanship_reviews_average() {
    let (env, _, client) = setup();
    env.ledger().set_timestamp(1000);

    let player = Address::generate(&env);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let r3 = Address::generate(&env);

    client.record_sportsmanship(&player, &2u32, &r1); // 2 stars
    client.record_sportsmanship(&player, &4u32, &r2); // 4 stars
    client.record_sportsmanship(&player, &3u32, &r3); // 3 stars

    let profile = client.get_player_profile(&player);
    assert_eq!(profile.review_count, 3);
    // avg = (2+4+3)/3 = 3, score = 3*20 = 60
    assert_eq!(profile.sportsmanship_score, 60);
}
