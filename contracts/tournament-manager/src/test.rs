use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

fn create_test_env() -> Env {
    let env = Env::default();
    env
}

fn create_test_admin(env: &Env) -> Address {
    Address::generate(env)
}

fn create_test_participant(env: &Env) -> Address {
    Address::generate(env)
}

#[test]
fn test_initialize() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_tournament_count(), 0);
}

#[test]
fn test_create_tournament() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    assert_eq!(tournament_id, 1);
    assert_eq!(client.get_tournament_count(), 1);
    
    assert_eq!(client.get_tournament_name(&tournament_id), String::from_str(&env, "Test Tournament"));
    assert_eq!(client.get_tournament_state(&tournament_id), 0); // Created
    assert_eq!(client.get_tournament_admin(&tournament_id), admin);
    assert_eq!(client.get_tournament_entry_fee(&tournament_id), 1000);
    assert_eq!(client.get_tournament_max_participants(&tournament_id), 8);
}

#[test]
#[should_panic(expected = "Only admin can create tournaments")]
fn test_create_tournament_unauthorized() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    let non_admin = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    
    client.create_tournament(
        &non_admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
}

#[test]
fn test_register_participant() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    let participant = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    client.register_participant(&tournament_id, &participant, &1000);
    
    assert!(client.is_participant(&tournament_id, &participant));
    
    let participants = client.get_participants(&tournament_id);
    assert_eq!(participants.len(), 1);
    assert_eq!(participants.get(0), Some(participant));
    
    assert_eq!(client.get_tournament_state(&tournament_id), 1); // RegistrationOpen
}

#[test]
#[should_panic(expected = "Tournament not found")]
fn test_register_participant_nonexistent_tournament() {
    let env = create_test_env();
    let participant = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.register_participant(&999, &participant, &1000);
}

#[test]
#[should_panic(expected = "Tournament is not accepting registrations")]
fn test_register_participant_wrong_state() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    let participant = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    // Move tournament to completed state
    client.update_tournament_state(&tournament_id, &4); // Completed
    
    client.register_participant(&tournament_id, &participant, &1000);
}

#[test]
#[should_panic(expected = "Participant already registered")]
fn test_register_participant_duplicate() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    let participant = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    client.register_participant(&tournament_id, &participant, &1000);
    client.register_participant(&tournament_id, &participant, &1000);
}

#[test]
#[should_panic(expected = "Incorrect entry fee amount")]
fn test_register_participant_wrong_fee() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    let participant = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    client.register_participant(&tournament_id, &participant, &500);
}

#[test]
fn test_update_tournament_state() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    client.update_tournament_state(&tournament_id, &1); // RegistrationOpen
    
    assert_eq!(client.get_tournament_state(&tournament_id), 1);
}

#[test]
#[should_panic(expected = "Only admin can update tournament state")]
fn test_update_tournament_state_unauthorized() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    let _non_admin = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    // This should fail because non_admin is not the tournament admin
    client.update_tournament_state(&tournament_id, &1);
}

#[test]
#[should_panic(expected = "Invalid state transition")]
fn test_update_tournament_state_invalid_transition() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    // Try to go from Created (0) directly to Completed (4) (invalid)
    client.update_tournament_state(&tournament_id, &4);
}

#[test]
fn test_complete_tournament() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    let participant1 = create_test_participant(&env);
    let participant2 = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    // Register participants
    client.register_participant(&tournament_id, &participant1, &1000);
    client.register_participant(&tournament_id, &participant2, &1000);
    
    // Move to in progress
    client.update_tournament_state(&tournament_id, &2); // RegistrationClosed
    client.update_tournament_state(&tournament_id, &3); // InProgress
    
    // Complete tournament
    let mut winners = Vec::new(&env);
    winners.push_back(participant1);
    winners.push_back(participant2);
    
    client.complete_tournament(&tournament_id, &winners);
    
    assert_eq!(client.get_tournament_state(&tournament_id), 4); // Completed
}

#[test]
#[should_panic(expected = "Tournament is not in progress")]
fn test_complete_tournament_wrong_state() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    let winners = Vec::new(&env);
    client.complete_tournament(&tournament_id, &winners);
}

#[test]
#[should_panic(expected = "Winner is not a registered participant")]
fn test_complete_tournament_invalid_winner() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    let participant = create_test_participant(&env);
    let non_participant = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    // Register participant
    client.register_participant(&tournament_id, &participant, &1000);
    
    // Move to in progress
    client.update_tournament_state(&tournament_id, &2); // RegistrationClosed
    client.update_tournament_state(&tournament_id, &3); // InProgress
    
    // Try to complete with non-participant as winner
    let mut winners = Vec::new(&env);
    winners.push_back(non_participant);
    
    client.complete_tournament(&tournament_id, &winners);
}

#[test]
fn test_cancel_tournament() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    let reason = String::from_str(&env, "Insufficient participants");
    client.cancel_tournament(&tournament_id, &reason);
    
    assert_eq!(client.get_tournament_state(&tournament_id), 5); // Cancelled
}

#[test]
#[should_panic(expected = "Cannot cancel completed tournament")]
fn test_cancel_completed_tournament() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    let participant = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    // Register participant and complete tournament
    client.register_participant(&tournament_id, &participant, &1000);
    client.update_tournament_state(&tournament_id, &2); // RegistrationClosed
    client.update_tournament_state(&tournament_id, &3); // InProgress
    
    let mut winners = Vec::new(&env);
    winners.push_back(participant);
    client.complete_tournament(&tournament_id, &winners);
    
    // Try to cancel completed tournament
    let reason = String::from_str(&env, "Test cancellation");
    client.cancel_tournament(&tournament_id, &reason);
}

#[test]
fn test_get_participants() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    let participant1 = create_test_participant(&env);
    let participant2 = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    client.register_participant(&tournament_id, &participant1, &1000);
    client.register_participant(&tournament_id, &participant2, &1000);
    
    let participants = client.get_participants(&tournament_id);
    assert_eq!(participants.len(), 2);
}

#[test]
fn test_is_participant() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    let participant = create_test_participant(&env);
    let non_participant = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    let tournament_id = client.create_tournament(
        &admin,
        &String::from_str(&env, "Test Tournament"),
        &String::from_str(&env, "A test tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    client.register_participant(&tournament_id, &participant, &1000);
    
    assert!(client.is_participant(&tournament_id, &participant));
    assert!(!client.is_participant(&tournament_id, &non_participant));
}

#[test]
fn test_get_tournaments_by_state() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    
    // Create multiple tournaments
    let tournament_id1 = client.create_tournament(
        &admin,
        &String::from_str(&env, "Tournament 1"),
        &String::from_str(&env, "First tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    let tournament_id2 = client.create_tournament(
        &admin,
        &String::from_str(&env, "Tournament 2"),
        &String::from_str(&env, "Second tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    // Update one tournament to RegistrationOpen
    client.update_tournament_state(&tournament_id1, &1); // RegistrationOpen
    
    let created_tournaments = client.get_tournaments_by_state(&0); // Created
    let open_tournaments = client.get_tournaments_by_state(&1); // RegistrationOpen
    
    assert_eq!(created_tournaments.len(), 1);
    assert_eq!(created_tournaments.get(0), Some(tournament_id2));
    assert_eq!(open_tournaments.len(), 1);
    assert_eq!(open_tournaments.get(0), Some(tournament_id1));
}

#[test]
fn test_multiple_tournaments() {
    let env = create_test_env();
    let admin = create_test_admin(&env);
    let participant1 = create_test_participant(&env);
    let participant2 = create_test_participant(&env);
    
    let contract_id = env.register(TournamentManager, ());
    let client = TournamentManagerClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    
    // Create multiple tournaments
    let tournament_id1 = client.create_tournament(
        &admin,
        &String::from_str(&env, "Tournament 1"),
        &String::from_str(&env, "First tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    let tournament_id2 = client.create_tournament(
        &admin,
        &String::from_str(&env, "Tournament 2"),
        &String::from_str(&env, "Second tournament"),
        &1000,
        &8,
        &1000000,
        &1001000,
        &8000
    );
    
    assert_eq!(tournament_id1, 1);
    assert_eq!(tournament_id2, 2);
    assert_eq!(client.get_tournament_count(), 2);
    
    // Register participants in different tournaments
    client.register_participant(&tournament_id1, &participant1, &1000);
    client.register_participant(&tournament_id2, &participant2, &1000);
    
    // Verify participants are registered in correct tournaments
    assert!(client.is_participant(&tournament_id1, &participant1));
    assert!(!client.is_participant(&tournament_id1, &participant2));
    assert!(!client.is_participant(&tournament_id2, &participant1));
    assert!(client.is_participant(&tournament_id2, &participant2));
}