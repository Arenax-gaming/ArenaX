use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec, Symbol};
use reputation::{ReputationContract, ReputationContractClient, ReputationTier, ReputationEventType, PenaltySeverity, ReputationRequirement, Error};

fn create_test_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

fn create_test_contract(env: &Env) -> ReputationContractClient {
    let contract_id = env.register_contract(None, ReputationContract);
    ReputationContractClient::new(env, &contract_id)
}

#[test]
fn test_initialize_contract() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);

    // Initialize contract
    contract.initialize(&admin);
    
    // Verify admin is set
    let stored_admin = contract.get_admin();
    assert_eq!(stored_admin, admin);
    
    // Verify contract is not paused
    let is_paused = contract.is_contract_paused();
    assert_eq!(is_paused, false);
}

#[test]
fn test_initialize_twice_fails() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);

    // Initialize contract
    contract.initialize(&admin);
    
    // Try to initialize again - should fail
    let result = contract.try_initialize(&admin);
    assert!(result.is_err());
    assert_eq!(result.err().unwrap(), Error::InvalidParameter);
}

#[test]
fn test_issue_reputation() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    
    // Issue initial reputation
    contract.issue_reputation(&player, &None);
    
    // Verify reputation was issued
    let reputation = contract.get_reputation(&player);
    assert_eq!(reputation, 100); // Default initial reputation
    
    // Verify player info
    let player_info = contract.get_reputation_info(&player);
    assert_eq!(player_info.player, player);
    assert_eq!(player_info.current_reputation, 100);
    assert_eq!(player_info.reputation_tier, ReputationTier::Beginner);
    assert_eq!(player_info.total_matches, 0);
    assert_eq!(player_info.wins, 0);
    assert_eq!(player_info.losses, 0);
    assert_eq!(player_info.disputes, 0);
    assert_eq!(player_info.penalties, 0);
}

#[test]
fn test_issue_reputation_custom_amount() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    
    // Issue custom initial reputation
    contract.issue_reputation(&player, &Some(500));
    
    // Verify reputation was issued
    let reputation = contract.get_reputation(&player);
    assert_eq!(reputation, 500);
    
    // Verify tier calculation
    let player_info = contract.get_reputation_info(&player);
    assert_eq!(player_info.reputation_tier, ReputationTier::Novice);
}

#[test]
fn test_issue_reputation_duplicate_player() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    
    // Issue initial reputation
    contract.issue_reputation(&player, &None);
    
    // Try to issue again - should fail
    let result = contract.try_issue_reputation(&player, &None);
    assert!(result.is_err());
    assert_eq!(result.err().unwrap(), Error::PlayerAlreadyExists);
}

#[test]
fn test_update_reputation_match_win() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    contract.issue_reputation(&player, &None);
    
    // Update reputation for match win
    contract.update_reputation(
        &player,
        &50,
        &String::from_str(&env, "Won match"),
        &ReputationEventType::MatchWin,
        &None,
        &Some(1),
    );
    
    // Verify reputation updated
    let reputation = contract.get_reputation(&player);
    assert_eq!(reputation, 150);
    
    // Verify player stats updated
    let player_info = contract.get_reputation_info(&player);
    assert_eq!(player_info.wins, 1);
    assert_eq!(player_info.total_matches, 1);
    assert_eq!(player_info.current_reputation, 150);
}

#[test]
fn test_update_reputation_match_loss() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    contract.issue_reputation(&player, &Some(200));
    
    // Update reputation for match loss
    contract.update_reputation(
        &player,
        &-10,
        &String::from_str(&env, "Lost match"),
        &ReputationEventType::MatchLoss,
        &None,
        &Some(1),
    );
    
    // Verify reputation updated
    let reputation = contract.get_reputation(&player);
    assert_eq!(reputation, 190);
    
    // Verify player stats updated
    let player_info = contract.get_reputation_info(&player);
    assert_eq!(player_info.losses, 1);
    assert_eq!(player_info.total_matches, 1);
}

#[test]
fn test_update_reputation_tournament_win() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    contract.issue_reputation(&player, &Some(100));
    
    // Update reputation for tournament win
    contract.update_reputation(
        &player,
        &200,
        &String::from_str(&env, "Won tournament"),
        &ReputationEventType::TournamentWin,
        &Some(1),
        &None,
    );
    
    // Verify reputation updated
    let reputation = contract.get_reputation(&player);
    assert_eq!(reputation, 300);
    
    // Verify tier changed
    let player_info = contract.get_reputation_info(&player);
    assert_eq!(player_info.reputation_tier, ReputationTier::Novice);
}

#[test]
fn test_apply_penalty() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    contract.issue_reputation(&player, &Some(500));
    
    // Apply penalty
    contract.apply_penalty(
        &player,
        &-100,
        &String::from_str(&env, "Cheating detected"),
        &PenaltySeverity::Moderate,
    );
    
    // Verify penalty applied
    let reputation = contract.get_reputation(&player);
    assert_eq!(reputation, 400);
    
    // Verify penalty count updated
    let player_info = contract.get_reputation_info(&player);
    assert_eq!(player_info.penalties, 1);
}

#[test]
fn test_apply_penalty_positive_amount_fails() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    contract.issue_reputation(&player, &Some(500));
    
    // Try to apply positive penalty - should fail
    let result = contract.try_apply_penalty(
        &player,
        &100,
        &String::from_str(&env, "Invalid penalty"),
        &PenaltySeverity::Minor,
    );
    assert!(result.is_err());
    assert_eq!(result.err().unwrap(), Error::InvalidParameter);
}

#[test]
fn test_reputation_history() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    contract.issue_reputation(&player, &Some(100));
    
    // Add some reputation events
    contract.update_reputation(
        &player,
        &50,
        &String::from_str(&env, "Match win"),
        &ReputationEventType::MatchWin,
        &None,
        &Some(1),
    );
    
    contract.update_reputation(
        &player,
        &-10,
        &String::from_str(&env, "Match loss"),
        &ReputationEventType::MatchLoss,
        &None,
        &Some(2),
    );
    
    // Get reputation history
    let history = contract.get_reputation_history(&player, &Some(10));
    assert_eq!(history.len(), 3); // Initial + 2 updates
    
    // Verify first event (initial)
    let first_event = history.get(0).unwrap();
    assert_eq!(first_event.event_type, ReputationEventType::CommunityContribution);
    assert_eq!(first_event.amount, 100);
    
    // Verify second event (match win)
    let second_event = history.get(1).unwrap();
    assert_eq!(second_event.event_type, ReputationEventType::MatchWin);
    assert_eq!(second_event.amount, 50);
    assert_eq!(second_event.match_id, Some(1));
    
    // Verify third event (match loss)
    let third_event = history.get(2).unwrap();
    assert_eq!(third_event.event_type, ReputationEventType::MatchLoss);
    assert_eq!(third_event.amount, -10);
    assert_eq!(third_event.match_id, Some(2));
}

#[test]
fn test_check_reputation_requirement() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    contract.issue_reputation(&player, &Some(500));
    
    // Add some matches
    contract.update_reputation(
        &player,
        &50,
        &String::from_str(&env, "Match win"),
        &ReputationEventType::MatchWin,
        &None,
        &Some(1),
    );
    
    contract.update_reputation(
        &player,
        &50,
        &String::from_str(&env, "Match win"),
        &ReputationEventType::MatchWin,
        &None,
        &Some(2),
    );
    
    // Create requirement
    let requirement = ReputationRequirement {
        min_reputation: 400,
        min_tier: ReputationTier::Novice,
        max_penalties: 0,
        min_matches: 2,
    };
    
    // Check requirement - should pass
    let meets_requirement = contract.check_reputation_requirement(&player, &requirement);
    assert_eq!(meets_requirement, true);
    
    // Create stricter requirement
    let strict_requirement = ReputationRequirement {
        min_reputation: 1000,
        min_tier: ReputationTier::Advanced,
        max_penalties: 0,
        min_matches: 2,
    };
    
    // Check requirement - should fail
    let meets_strict_requirement = contract.check_reputation_requirement(&player, &strict_requirement);
    assert_eq!(meets_strict_requirement, false);
}

#[test]
fn test_transfer_reputation() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    contract.initialize(&admin);
    contract.issue_reputation(&player1, &Some(500));
    
    // Transfer reputation from player1 to player2
    contract.transfer_reputation(
        &player1,
        &player2,
        &100,
        &String::from_str(&env, "Transfer"),
    );
    
    // Verify transfer
    let player1_reputation = contract.get_reputation(&player1);
    let player2_reputation = contract.get_reputation(&player2);
    
    assert_eq!(player1_reputation, 400);
    assert_eq!(player2_reputation, 100);
    
    // Verify player2 info was created
    let player2_info = contract.get_reputation_info(&player2);
    assert_eq!(player2_info.player, player2);
    assert_eq!(player2_info.current_reputation, 100);
    assert_eq!(player2_info.reputation_tier, ReputationTier::Beginner);
}

#[test]
fn test_transfer_reputation_insufficient_balance() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    contract.initialize(&admin);
    contract.issue_reputation(&player1, &Some(100));
    
    // Try to transfer more than available - should fail
    let result = contract.try_transfer_reputation(
        &player1,
        &player2,
        &200,
        &String::from_str(&env, "Transfer"),
    );
    assert!(result.is_err());
    assert_eq!(result.err().unwrap(), Error::InsufficientReputation);
}

#[test]
fn test_calculate_tier() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    
    // Test tier calculations
    assert_eq!(contract.calculate_tier(&0), ReputationTier::Beginner);
    assert_eq!(contract.calculate_tier(&100), ReputationTier::Beginner);
    assert_eq!(contract.calculate_tier(&101), ReputationTier::Novice);
    assert_eq!(contract.calculate_tier(&500), ReputationTier::Novice);
    assert_eq!(contract.calculate_tier(&501), ReputationTier::Intermediate);
    assert_eq!(contract.calculate_tier(&1000), ReputationTier::Intermediate);
    assert_eq!(contract.calculate_tier(&1001), ReputationTier::Advanced);
    assert_eq!(contract.calculate_tier(&2000), ReputationTier::Advanced);
    assert_eq!(contract.calculate_tier(&2001), ReputationTier::Expert);
    assert_eq!(contract.calculate_tier(&5000), ReputationTier::Expert);
    assert_eq!(contract.calculate_tier(&5001), ReputationTier::Master);
}

#[test]
fn test_reset_reputation() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    contract.issue_reputation(&player, &Some(500));
    
    // Add some reputation
    contract.update_reputation(
        &player,
        &200,
        &String::from_str(&env, "Match win"),
        &ReputationEventType::MatchWin,
        &None,
        &Some(1),
    );
    
    // Reset reputation
    contract.reset_reputation(&player, &String::from_str(&env, "Reset for testing"));
    
    // Verify reset
    let reputation = contract.get_reputation(&player);
    assert_eq!(reputation, 0);
    
    let player_info = contract.get_reputation_info(&player);
    assert_eq!(player_info.current_reputation, 0);
    assert_eq!(player_info.reputation_tier, ReputationTier::Beginner);
}

#[test]
fn test_pause_unpause_contract() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    
    // Pause contract
    contract.pause_contract();
    assert_eq!(contract.is_contract_paused(), true);
    
    // Try to issue reputation while paused - should fail
    let result = contract.try_issue_reputation(&player, &None);
    assert!(result.is_err());
    assert_eq!(result.err().unwrap(), Error::ContractPaused);
    
    // Unpause contract
    contract.unpause_contract();
    assert_eq!(contract.is_contract_paused(), false);
    
    // Now should work
    contract.issue_reputation(&player, &None);
    let reputation = contract.get_reputation(&player);
    assert_eq!(reputation, 100);
}

#[test]
fn test_change_admin() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);

    contract.initialize(&admin1);
    
    // Change admin
    contract.change_admin(&admin2);
    
    // Verify admin changed
    let current_admin = contract.get_admin();
    assert_eq!(current_admin, admin2);
}

#[test]
fn test_unauthorized_access() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    contract.issue_reputation(&player, &Some(500));
    
    // Try to pause contract as non-admin - should fail
    let result = contract.try_pause_contract();
    assert!(result.is_err());
    assert_eq!(result.err().unwrap(), Error::Unauthorized);
    
    // Try to reset reputation as non-admin - should fail
    let result = contract.try_reset_reputation(&player, &String::from_str(&env, "Reset"));
    assert!(result.is_err());
    assert_eq!(result.err().unwrap(), Error::Unauthorized);
}

#[test]
fn test_player_not_found() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    
    // Try to get reputation for non-existent player - should fail
    let result = contract.try_get_reputation(&player);
    assert!(result.is_err());
    assert_eq!(result.err().unwrap(), Error::PlayerNotFound);
    
    // Try to update reputation for non-existent player - should fail
    let result = contract.try_update_reputation(
        &player,
        &50,
        &String::from_str(&env, "Match win"),
        &ReputationEventType::MatchWin,
        &None,
        &Some(1),
    );
    assert!(result.is_err());
    assert_eq!(result.err().unwrap(), Error::PlayerNotFound);
}

#[test]
fn test_reputation_bounds() {
    let env = create_test_env();
    let contract = create_test_contract(&env);
    let admin = Address::generate(&env);
    let player = Address::generate(&env);

    contract.initialize(&admin);
    
    // Try to issue negative reputation - should fail
    let result = contract.try_issue_reputation(&player, &Some(-100));
    assert!(result.is_err());
    assert_eq!(result.err().unwrap(), Error::InvalidReputationAmount);
    
    // Try to issue too much reputation - should fail
    let result = contract.try_issue_reputation(&player, &Some(20000));
    assert!(result.is_err());
    assert_eq!(result.err().unwrap(), Error::InvalidReputationAmount);
    
    // Issue normal reputation
    contract.issue_reputation(&player, &Some(100));
    
    // Try to update to negative reputation - should fail
    let result = contract.try_update_reputation(
        &player,
        &-200,
        &String::from_str(&env, "Too much loss"),
        &ReputationEventType::MatchLoss,
        &None,
        &Some(1),
    );
    assert!(result.is_err());
    assert_eq!(result.err().unwrap(), Error::InsufficientReputation);
}
