#![cfg(test)]

use soroban_sdk::{
    contracttype, symbol_short, Address, BytesN, Env, Map, String, Symbol, Vec,
};

use crate::{
    Bracket, DataKey, Dispute, Match, MatchStatus, PlayerRegistration, PrizeAllocation,
    PrizeEscrow, Tournament, TournamentAnalytics, TournamentConfig, TournamentManager,
    TournamentState, TournamentType,
};

#[test]
fn test_initialize() {
    let env = Env::default();
    let admin = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin.clone());

    let stored_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin not found");
    assert_eq!(stored_admin, admin);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice() {
    let env = Env::default();
    let admin = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin.clone());
    TournamentManager::initialize(env.clone(), admin);
}

#[test]
fn test_create_tournament() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 4,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer, config);

    let tournament: Tournament = env
        .storage()
        .persistent()
        .get(&DataKey::Tournament(tournament_id))
        .expect("tournament not found");

    assert_eq!(tournament.state, TournamentState::Created as u32);
    assert_eq!(tournament.total_players, 0);
}

#[test]
#[should_panic(expected = "max_players must be >= min_players")]
fn test_create_tournament_invalid_config() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 4,
        min_players: 8,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    TournamentManager::create_tournament(env, organizer, config);
}

#[test]
fn test_open_registration() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 4,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);

    TournamentManager::open_registration(env.clone(), tournament_id);

    let tournament: Tournament = env
        .storage()
        .persistent()
        .get(&DataKey::Tournament(tournament_id))
        .expect("tournament not found");

    assert_eq!(tournament.state, TournamentState::RegistrationOpen as u32);
}

#[test]
fn test_register_player() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 4,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player.clone(), 1);

    let players: Vec<PlayerRegistration> = env
        .storage()
        .persistent()
        .get(&DataKey::TournamentPlayers(tournament_id))
        .expect("players not found");

    assert_eq!(players.len(), 1);
    assert_eq!(players.get(0).unwrap().player, player);
}

#[test]
#[should_panic(expected = "player already registered")]
fn test_register_player_duplicate() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 4,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player.clone(), 1);
    TournamentManager::register_player(env.clone(), tournament_id, player, 1);
}

#[test]
#[should_panic(expected = "tournament is full")]
fn test_register_player_full() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let player3 = Address::generate(&env);
    let player4 = Address::generate(&env);
    let player5 = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 4,
        min_players: 2,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player1, 1);
    TournamentManager::register_player(env.clone(), tournament_id, player2, 2);
    TournamentManager::register_player(env.clone(), tournament_id, player3, 3);
    TournamentManager::register_player(env.clone(), tournament_id, player4, 4);
    TournamentManager::register_player(env.clone(), tournament_id, player5, 5);
}

#[test]
fn test_close_registration() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 2,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player1, 1);
    TournamentManager::register_player(env.clone(), tournament_id, player2, 2);

    TournamentManager::close_registration(env.clone(), tournament_id);

    let tournament: Tournament = env
        .storage()
        .persistent()
        .get(&DataKey::Tournament(tournament_id))
        .expect("tournament not found");

    assert_eq!(tournament.state, TournamentState::RegistrationClosed as u32);
}

#[test]
#[should_panic(expected = "not enough players to start tournament")]
fn test_close_registration_insufficient_players() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player1 = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 2,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player1, 1);

    TournamentManager::close_registration(env, tournament_id);
}

#[test]
fn test_generate_bracket_single_elimination() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let player3 = Address::generate(&env);
    let player4 = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 2,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player1, 1);
    TournamentManager::register_player(env.clone(), tournament_id, player2, 2);
    TournamentManager::register_player(env.clone(), tournament_id, player3, 3);
    TournamentManager::register_player(env.clone(), tournament_id, player4, 4);

    TournamentManager::close_registration(env.clone(), tournament_id);

    let seed_data: Vec<u32> = Vec::new(&env);
    TournamentManager::generate_bracket(env.clone(), tournament_id, seed_data);

    let bracket: Bracket = env
        .storage()
        .persistent()
        .get(&DataKey::TournamentBracket(tournament_id))
        .expect("bracket not found");

    assert_eq!(bracket.bracket_type, TournamentType::SingleElimination as u32);
}

#[test]
fn test_generate_bracket_swiss_system() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let player3 = Address::generate(&env);
    let player4 = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SwissSystem as u32,
        max_players: 8,
        min_players: 2,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player1, 1);
    TournamentManager::register_player(env.clone(), tournament_id, player2, 2);
    TournamentManager::register_player(env.clone(), tournament_id, player3, 3);
    TournamentManager::register_player(env.clone(), tournament_id, player4, 4);

    TournamentManager::close_registration(env.clone(), tournament_id);

    let seed_data: Vec<u32> = Vec::new(&env);
    TournamentManager::generate_bracket(env.clone(), tournament_id, seed_data);

    let bracket: Bracket = env
        .storage()
        .persistent()
        .get(&DataKey::TournamentBracket(tournament_id))
        .expect("bracket not found");

    assert_eq!(bracket.bracket_type, TournamentType::SwissSystem as u32);
}

#[test]
fn test_update_match_result() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 2,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player1.clone(), 1);
    TournamentManager::register_player(env.clone(), tournament_id, player2.clone(), 2);

    TournamentManager::close_registration(env.clone(), tournament_id);

    let seed_data: Vec<u32> = Vec::new(&env);
    TournamentManager::generate_bracket(env.clone(), tournament_id, seed_data);

    TournamentManager::start_tournament(env.clone(), tournament_id);

    // Get the first match
    let bracket: Bracket = env
        .storage()
        .persistent()
        .get(&DataKey::TournamentBracket(tournament_id))
        .expect("bracket not found");

    // For this test, we'll create a match manually
    let match_id = BytesN::from_array(&env, &[1u8; 32]);
    let match_data = Match {
        match_id: match_id.clone(),
        player_a: player1.clone(),
        player_b: player2.clone(),
        round: 1,
        status: MatchStatus::Scheduled as u32,
        winner: None,
        score_a: 0,
        score_b: 0,
        started_at: None,
        completed_at: None,
    };

    env.storage()
        .persistent()
        .set(&DataKey::TournamentMatch(tournament_id.clone(), match_id.clone()), &match_data);

    TournamentManager::update_match_result(
        env.clone(),
        tournament_id,
        match_id,
        player1.clone(),
        3,
        1,
    );

    let updated_match: Match = env
        .storage()
        .persistent()
        .get(&DataKey::TournamentMatch(tournament_id, match_id))
        .expect("match not found");

    assert_eq!(updated_match.winner, Some(player1));
    assert_eq!(updated_match.score_a, 3);
    assert_eq!(updated_match.score_b, 1);
    assert_eq!(updated_match.status, MatchStatus::Completed as u32);
}

#[test]
#[should_panic(expected = "winner must be one of the players")]
fn test_update_match_result_invalid_winner() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let player3 = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 2,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player1, 1);
    TournamentManager::register_player(env.clone(), tournament_id, player2, 2);

    TournamentManager::close_registration(env.clone(), tournament_id);

    let seed_data: Vec<u32> = Vec::new(&env);
    TournamentManager::generate_bracket(env.clone(), tournament_id, seed_data);

    TournamentManager::start_tournament(env.clone(), tournament_id);

    let match_id = BytesN::from_array(&env, &[1u8; 32]);
    let match_data = Match {
        match_id: match_id.clone(),
        player_a: player1,
        player_b: player2,
        round: 1,
        status: MatchStatus::Scheduled as u32,
        winner: None,
        score_a: 0,
        score_b: 0,
        started_at: None,
        completed_at: None,
    };

    env.storage()
        .persistent()
        .set(&DataKey::TournamentMatch(tournament_id.clone(), match_id.clone()), &match_data);

    TournamentManager::update_match_result(env, tournament_id, match_id, player3, 3, 1);
}

#[test]
fn test_start_tournament() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 2,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player1, 1);
    TournamentManager::register_player(env.clone(), tournament_id, player2, 2);

    TournamentManager::close_registration(env.clone(), tournament_id);

    let seed_data: Vec<u32> = Vec::new(&env);
    TournamentManager::generate_bracket(env.clone(), tournament_id, seed_data);

    TournamentManager::start_tournament(env.clone(), tournament_id);

    let tournament: Tournament = env
        .storage()
        .persistent()
        .get(&DataKey::Tournament(tournament_id))
        .expect("tournament not found");

    assert_eq!(tournament.state, TournamentState::InProgress as u32);
}

#[test]
fn test_pause_tournament() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 2,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player1, 1);
    TournamentManager::register_player(env.clone(), tournament_id, player2, 2);

    TournamentManager::close_registration(env.clone(), tournament_id);

    let seed_data: Vec<u32> = Vec::new(&env);
    TournamentManager::generate_bracket(env.clone(), tournament_id, seed_data);

    TournamentManager::start_tournament(env.clone(), tournament_id);

    TournamentManager::pause_tournament(env.clone(), tournament_id);

    let tournament: Tournament = env
        .storage()
        .persistent()
        .get(&DataKey::Tournament(tournament_id))
        .expect("tournament not found");

    assert_eq!(tournament.state, TournamentState::Paused as u32);
}

#[test]
fn test_resume_tournament() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 2,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player1, 1);
    TournamentManager::register_player(env.clone(), tournament_id, player2, 2);

    TournamentManager::close_registration(env.clone(), tournament_id);

    let seed_data: Vec<u32> = Vec::new(&env);
    TournamentManager::generate_bracket(env.clone(), tournament_id, seed_data);

    TournamentManager::start_tournament(env.clone(), tournament_id);
    TournamentManager::pause_tournament(env.clone(), tournament_id);
    TournamentManager::resume_tournament(env.clone(), tournament_id);

    let tournament: Tournament = env
        .storage()
        .persistent()
        .get(&DataKey::Tournament(tournament_id))
        .expect("tournament not found");

    assert_eq!(tournament.state, TournamentState::InProgress as u32);
}

#[test]
fn test_cancel_tournament() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 4,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    TournamentManager::cancel_tournament(
        env.clone(),
        tournament_id,
        String::from_str(&env, "Emergency cancellation"),
    );

    let tournament: Tournament = env
        .storage()
        .persistent()
        .get(&DataKey::Tournament(tournament_id))
        .expect("tournament not found");

    assert_eq!(tournament.state, TournamentState::Cancelled as u32);
}

#[test]
fn test_set_prize_allocations() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 4,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    let mut allocations: Vec<PrizeAllocation> = Vec::new(&env);
    allocations.push_back(PrizeAllocation {
        position: 1,
        percentage: 50,
        amount: 500,
    });
    allocations.push_back(PrizeAllocation {
        position: 2,
        percentage: 30,
        amount: 300,
    });
    allocations.push_back(PrizeAllocation {
        position: 3,
        percentage: 20,
        amount: 200,
    });

    TournamentManager::set_prize_allocations(env.clone(), tournament_id, allocations);

    let escrow: PrizeEscrow = env
        .storage()
        .persistent()
        .get(&DataKey::TournamentPrizeEscrow(tournament_id))
        .expect("escrow not found");

    assert_eq!(escrow.allocations.len(), 3);
}

#[test]
fn test_distribute_prizes() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let winner = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 4,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    let mut allocations: Vec<PrizeAllocation> = Vec::new(&env);
    allocations.push_back(PrizeAllocation {
        position: 1,
        percentage: 50,
        amount: 500,
    });

    TournamentManager::set_prize_allocations(env.clone(), tournament_id, allocations);

    // Mark tournament as completed
    let mut tournament: Tournament = env
        .storage()
        .persistent()
        .get(&DataKey::Tournament(tournament_id))
        .expect("tournament not found");
    tournament.state = TournamentState::Completed as u32;
    env.storage()
        .persistent()
        .set(&DataKey::Tournament(tournament_id), &tournament);

    let mut winners: Map<Address, u32> = Map::new(&env);
    winners.set(winner.clone(), 1);

    TournamentManager::distribute_prizes(env.clone(), tournament_id, winners);

    let escrow: PrizeEscrow = env
        .storage()
        .persistent()
        .get(&DataKey::TournamentPrizeEscrow(tournament_id))
        .expect("escrow not found");

    assert_eq!(escrow.distributed, 500);
}

#[test]
fn test_raise_dispute() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let reporter = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 2,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player1, 1);
    TournamentManager::register_player(env.clone(), tournament_id, player2, 2);

    TournamentManager::close_registration(env.clone(), tournament_id);

    let seed_data: Vec<u32> = Vec::new(&env);
    TournamentManager::generate_bracket(env.clone(), tournament_id, seed_data);

    TournamentManager::start_tournament(env.clone(), tournament_id);

    let match_id = BytesN::from_array(&env, &[1u8; 32]);

    TournamentManager::raise_dispute(
        env.clone(),
        tournament_id,
        match_id,
        reporter,
        String::from_str(&env, "Suspicious activity"),
    );

    let dispute: Dispute = env
        .storage()
        .persistent()
        .get(&DataKey::Dispute(tournament_id, match_id))
        .expect("dispute not found");

    assert_eq!(dispute.resolved, false);
}

#[test]
fn test_resolve_dispute() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let reporter = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 2,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer.clone(), config);

    env.ledger().set_timestamp(1500);
    TournamentManager::open_registration(env.clone(), tournament_id);

    TournamentManager::register_player(env.clone(), tournament_id, player1, 1);
    TournamentManager::register_player(env.clone(), tournament_id, player2, 2);

    TournamentManager::close_registration(env.clone(), tournament_id);

    let seed_data: Vec<u32> = Vec::new(&env);
    TournamentManager::generate_bracket(env.clone(), tournament_id, seed_data);

    TournamentManager::start_tournament(env.clone(), tournament_id);

    let match_id = BytesN::from_array(&env, &[1u8; 32]);

    TournamentManager::raise_dispute(
        env.clone(),
        tournament_id,
        match_id.clone(),
        reporter,
        String::from_str(&env, "Suspicious activity"),
    );

    TournamentManager::resolve_dispute(
        env.clone(),
        tournament_id,
        match_id,
        String::from_str(&env, "No evidence found"),
    );

    let dispute: Dispute = env
        .storage()
        .persistent()
        .get(&DataKey::Dispute(tournament_id, match_id))
        .expect("dispute not found");

    assert_eq!(dispute.resolved, true);
}

#[test]
fn test_get_tournament_analytics() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);

    TournamentManager::initialize(env.clone(), admin);

    let config = TournamentConfig {
        tournament_type: TournamentType::SingleElimination as u32,
        max_players: 8,
        min_players: 4,
        entry_fee: 100,
        prize_pool: 1000,
        registration_start: 1000,
        registration_end: 2000,
        start_time: 3000,
        description: String::from_str(&env, "Test Tournament"),
    };

    let tournament_id = TournamentManager::create_tournament(env.clone(), organizer, config);

    let analytics = TournamentManager::get_tournament_analytics(env, tournament_id);

    assert_eq!(analytics.total_matches, 0);
    assert_eq!(analytics.completed_matches, 0);
    assert_eq!(analytics.disputed_matches, 0);
}
