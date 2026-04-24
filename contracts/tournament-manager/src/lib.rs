#![no_std]
use arenax_events::tournament as events;
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Map, String, Vec};

// Data Structures

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    TournamentCounter,
    Tournament(BytesN<32>),
    TournamentPlayers(BytesN<32>),
    TournamentBracket(BytesN<32>),
    TournamentMatches(BytesN<32>),
    TournamentMatch(BytesN<32>, BytesN<32>),
    TournamentPrizeEscrow(BytesN<32>),
    TournamentAnalytics(BytesN<32>),
    Dispute(BytesN<32>, BytesN<32>),
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TournamentState {
    Created = 0,
    RegistrationOpen = 1,
    RegistrationClosed = 2,
    BracketGenerated = 3,
    InProgress = 4,
    Paused = 5,
    Completed = 6,
    Cancelled = 7,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TournamentType {
    SingleElimination = 0,
    DoubleElimination = 1,
    SwissSystem = 2,
    RoundRobin = 3,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MatchStatus {
    Scheduled = 0,
    InProgress = 1,
    Completed = 2,
    Disputed = 3,
    Cancelled = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TournamentConfig {
    pub tournament_type: u32,
    pub max_players: u32,
    pub min_players: u32,
    pub entry_fee: i128,
    pub prize_pool: i128,
    pub registration_start: u64,
    pub registration_end: u64,
    pub start_time: u64,
    pub description: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Tournament {
    pub tournament_id: BytesN<32>,
    pub organizer: Address,
    pub config: TournamentConfig,
    pub state: u32,
    pub current_phase: u32,
    pub current_round: u32,
    pub total_players: u32,
    pub created_at: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerRegistration {
    pub player: Address,
    pub registered_at: u64,
    pub seed_value: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Match {
    pub match_id: BytesN<32>,
    pub player_a: Address,
    pub player_b: Address,
    pub round: u32,
    pub status: u32,
    pub winner: Option<Address>,
    pub score_a: u32,
    pub score_b: u32,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bracket {
    pub bracket_type: u32,
    pub total_rounds: u32,
    pub matches: Vec<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrizeAllocation {
    pub position: u32,
    pub percentage: u32,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrizeEscrow {
    pub total_pool: i128,
    pub distributed: i128,
    pub allocations: Vec<PrizeAllocation>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TournamentAnalytics {
    pub total_matches: u32,
    pub completed_matches: u32,
    pub disputed_matches: u32,
    pub average_match_duration: u64,
    pub total_prize_distributed: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    pub match_id: BytesN<32>,
    pub reporter: Address,
    pub reason: String,
    pub raised_at: u64,
    pub resolved: bool,
    pub resolution: Option<String>,
}

#[contract]
pub struct TournamentManager;

#[contractimpl]
impl TournamentManager {
    // Initialization

    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::TournamentCounter, &0u64);
    }

    // Tournament Creation

    pub fn create_tournament(env: Env, organizer: Address, config: TournamentConfig) -> BytesN<32> {
        organizer.require_auth();

        // Validate config
        if config.max_players < config.min_players {
            panic!("max_players must be >= min_players");
        }
        if config.min_players < 2 {
            panic!("min_players must be at least 2");
        }
        if config.entry_fee < 0 {
            panic!("entry_fee cannot be negative");
        }
        if config.prize_pool < 0 {
            panic!("prize_pool cannot be negative");
        }
        if config.registration_end <= config.registration_start {
            panic!("registration_end must be after registration_start");
        }
        if config.start_time <= config.registration_end {
            panic!("start_time must be after registration_end");
        }

        // Validate tournament type
        if config.tournament_type > 3 {
            panic!("invalid tournament type");
        }

        // Generate tournament ID using counter
        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TournamentCounter)
            .expect("counter not found");
        let new_counter = counter + 1;
        env.storage()
            .instance()
            .set(&DataKey::TournamentCounter, &new_counter);

        // Use counter as seed for tournament ID (pad to 32 bytes)
        let mut id_bytes = [0u8; 32];
        id_bytes[0..8].copy_from_slice(&new_counter.to_be_bytes());
        let tournament_id = BytesN::from_array(&env, &id_bytes);

        // Create tournament
        let tournament = Tournament {
            tournament_id: tournament_id.clone(),
            organizer: organizer.clone(),
            config: config.clone(),
            state: TournamentState::Created as u32,
            current_phase: 0,
            current_round: 0,
            total_players: 0,
            created_at: env.ledger().timestamp(),
            updated_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Tournament(tournament_id.clone()), &tournament);

        // Initialize empty player list
        let players: Vec<PlayerRegistration> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::TournamentPlayers(tournament_id.clone()), &players);

        // Initialize prize escrow
        let escrow = PrizeEscrow {
            total_pool: config.prize_pool,
            distributed: 0,
            allocations: Vec::new(&env),
        };
        env.storage().persistent().set(
            &DataKey::TournamentPrizeEscrow(tournament_id.clone()),
            &escrow,
        );

        // Initialize analytics
        let analytics = TournamentAnalytics {
            total_matches: 0,
            completed_matches: 0,
            disputed_matches: 0,
            average_match_duration: 0,
            total_prize_distributed: 0,
        };
        env.storage().persistent().set(
            &DataKey::TournamentAnalytics(tournament_id.clone()),
            &analytics,
        );

        events::emit_tournament_created(
            &env,
            &tournament_id,
            &organizer,
            config.tournament_type,
            config.max_players,
            config.prize_pool,
        );

        tournament_id
    }

    // Player Registration

    pub fn open_registration(env: Env, tournament_id: BytesN<32>) {
        let mut tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        if tournament.state != TournamentState::Created as u32 {
            panic!("tournament must be in Created state");
        }

        let current_time = env.ledger().timestamp();
        if current_time < tournament.config.registration_start {
            panic!("registration not yet open");
        }

        tournament.state = TournamentState::RegistrationOpen as u32;
        tournament.updated_at = current_time;

        env.storage()
            .persistent()
            .set(&DataKey::Tournament(tournament_id.clone()), &tournament);
    }

    pub fn register_player(env: Env, tournament_id: BytesN<32>, player: Address, seed_value: u32) {
        player.require_auth();

        let mut tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        if tournament.state != TournamentState::RegistrationOpen as u32 {
            panic!("registration is not open");
        }

        let current_time = env.ledger().timestamp();
        if current_time > tournament.config.registration_end {
            panic!("registration has ended");
        }

        if tournament.total_players >= tournament.config.max_players {
            panic!("tournament is full");
        }

        // Check if player already registered
        let mut players: Vec<PlayerRegistration> = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentPlayers(tournament_id.clone()))
            .expect("players not found");

        for p in players.iter() {
            if p.player == player {
                panic!("player already registered");
            }
        }

        // Register player
        let registration = PlayerRegistration {
            player: player.clone(),
            registered_at: current_time,
            seed_value,
        };
        players.push_back(registration);

        tournament.total_players += 1;
        tournament.updated_at = current_time;

        env.storage()
            .persistent()
            .set(&DataKey::Tournament(tournament_id.clone()), &tournament);
        env.storage()
            .persistent()
            .set(&DataKey::TournamentPlayers(tournament_id.clone()), &players);

        events::emit_player_registered(&env, &tournament_id, &player);
    }

    pub fn close_registration(env: Env, tournament_id: BytesN<32>) {
        let mut tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        if tournament.state != TournamentState::RegistrationOpen as u32 {
            panic!("registration is not open");
        }

        if tournament.total_players < tournament.config.min_players {
            panic!("not enough players to start tournament");
        }

        tournament.state = TournamentState::RegistrationClosed as u32;
        tournament.updated_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Tournament(tournament_id.clone()), &tournament);
    }

    // Bracket Generation

    pub fn generate_bracket(env: Env, tournament_id: BytesN<32>, seed_data: Vec<u32>) {
        let mut tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        if tournament.state != TournamentState::RegistrationClosed as u32 {
            panic!("registration must be closed");
        }

        let players: Vec<PlayerRegistration> = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentPlayers(tournament_id.clone()))
            .expect("players not found");

        let bracket_type = tournament.config.tournament_type;
        let (bracket, matches) = match bracket_type {
            0 => Self::generate_single_elimination(&env, &players, &seed_data),
            1 => Self::generate_double_elimination(&env, &players, &seed_data),
            2 => Self::generate_swiss_system(&env, &players, &seed_data),
            3 => Self::generate_round_robin(&env, &players),
            _ => panic!("invalid tournament type"),
        };

        // Store bracket
        env.storage()
            .persistent()
            .set(&DataKey::TournamentBracket(tournament_id.clone()), &bracket);

        // Store matches
        let match_ids: Vec<BytesN<32>> = Vec::new(&env);
        env.storage().persistent().set(
            &DataKey::TournamentMatches(tournament_id.clone()),
            &match_ids,
        );

        for match_data in matches.iter() {
            // Generate match ID from tournament_id, round, and player addresses
            let mut match_bytes = [0u8; 32];
            match_bytes[0..8].copy_from_slice(&match_data.round.to_be_bytes());
            // Add some bytes from tournament_id to make it unique
            let tid_bytes = tournament_id.to_array();
            match_bytes[8..16].copy_from_slice(&tid_bytes[0..8]);
            let match_id = BytesN::from_array(&env, &match_bytes);
            env.storage().persistent().set(
                &DataKey::TournamentMatch(tournament_id.clone(), match_id.clone()),
                &match_data,
            );
        }

        tournament.state = TournamentState::BracketGenerated as u32;
        tournament.current_phase = 1;
        tournament.current_round = 1;
        tournament.updated_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Tournament(tournament_id.clone()), &tournament);

        events::emit_bracket_generated(&env, &tournament_id, bracket_type, bracket.matches.len());
    }

    fn generate_single_elimination(
        env: &Env,
        players: &Vec<PlayerRegistration>,
        _seed_data: &Vec<u32>,
    ) -> (Bracket, Vec<Match>) {
        let mut matches: Vec<Match> = Vec::new(env);
        let match_ids: Vec<BytesN<32>> = Vec::new(env);

        let player_count = players.len();
        let total_rounds = if player_count.is_power_of_two() {
            (player_count as f32).log2() as u32
        } else {
            ((player_count as f32).log2().ceil()) as u32
        };

        // Simple pairing for first round
        let mut i = 0;
        while i < player_count {
            if i + 1 < player_count {
                let match_data = Match {
                    match_id: BytesN::<32>::from_array(env, &[0u8; 32]), // Placeholder
                    player_a: players.get(i).unwrap().player.clone(),
                    player_b: players.get(i + 1).unwrap().player.clone(),
                    round: 1,
                    status: MatchStatus::Scheduled as u32,
                    winner: None,
                    score_a: 0,
                    score_b: 0,
                    started_at: None,
                    completed_at: None,
                };
                matches.push_back(match_data);
            }
            i += 2;
        }

        let bracket = Bracket {
            bracket_type: TournamentType::SingleElimination as u32,
            total_rounds,
            matches: match_ids,
        };

        (bracket, matches)
    }

    fn generate_double_elimination(
        env: &Env,
        players: &Vec<PlayerRegistration>,
        _seed_data: &Vec<u32>,
    ) -> (Bracket, Vec<Match>) {
        let mut matches: Vec<Match> = Vec::new(env);
        let match_ids: Vec<BytesN<32>> = Vec::new(env);

        let player_count = players.len();
        let total_rounds = ((player_count as f32).log2() * 2.0).ceil() as u32;

        // Generate winners bracket matches
        let mut i = 0;
        while i < player_count {
            if i + 1 < player_count {
                let match_data = Match {
                    match_id: BytesN::<32>::from_array(env, &[0u8; 32]),
                    player_a: players.get(i).unwrap().player.clone(),
                    player_b: players.get(i + 1).unwrap().player.clone(),
                    round: 1,
                    status: MatchStatus::Scheduled as u32,
                    winner: None,
                    score_a: 0,
                    score_b: 0,
                    started_at: None,
                    completed_at: None,
                };
                matches.push_back(match_data);
            }
            i += 2;
        }

        let bracket = Bracket {
            bracket_type: TournamentType::DoubleElimination as u32,
            total_rounds,
            matches: match_ids,
        };

        (bracket, matches)
    }

    fn generate_swiss_system(
        env: &Env,
        players: &Vec<PlayerRegistration>,
        _seed_data: &Vec<u32>,
    ) -> (Bracket, Vec<Match>) {
        let mut matches: Vec<Match> = Vec::new(env);
        let match_ids: Vec<BytesN<32>> = Vec::new(env);

        let player_count = players.len();
        let total_rounds = if player_count <= 8 {
            3
        } else if player_count <= 16 {
            4
        } else if player_count <= 32 {
            5
        } else {
            6
        };

        // Round 1: Pair by seed
        let mut i = 0;
        while i < player_count {
            if i + 1 < player_count {
                let match_data = Match {
                    match_id: BytesN::<32>::from_array(env, &[0u8; 32]),
                    player_a: players.get(i).unwrap().player.clone(),
                    player_b: players.get(i + 1).unwrap().player.clone(),
                    round: 1,
                    status: MatchStatus::Scheduled as u32,
                    winner: None,
                    score_a: 0,
                    score_b: 0,
                    started_at: None,
                    completed_at: None,
                };
                matches.push_back(match_data);
            }
            i += 2;
        }

        let bracket = Bracket {
            bracket_type: TournamentType::SwissSystem as u32,
            total_rounds,
            matches: match_ids,
        };

        (bracket, matches)
    }

    fn generate_round_robin(env: &Env, players: &Vec<PlayerRegistration>) -> (Bracket, Vec<Match>) {
        let mut matches: Vec<Match> = Vec::new(env);
        let match_ids: Vec<BytesN<32>> = Vec::new(env);

        let player_count = players.len();
        let total_rounds = if player_count.is_multiple_of(2) {
            player_count - 1
        } else {
            player_count
        };

        // Generate all pairings
        for i in 0..player_count {
            for j in (i + 1)..player_count {
                let match_data = Match {
                    match_id: BytesN::<32>::from_array(env, &[0u8; 32]),
                    player_a: players.get(i).unwrap().player.clone(),
                    player_b: players.get(j).unwrap().player.clone(),
                    round: 1, // Simplified for round-robin
                    status: MatchStatus::Scheduled as u32,
                    winner: None,
                    score_a: 0,
                    score_b: 0,
                    started_at: None,
                    completed_at: None,
                };
                matches.push_back(match_data);
            }
        }

        let bracket = Bracket {
            bracket_type: TournamentType::RoundRobin as u32,
            total_rounds,
            matches: match_ids,
        };

        (bracket, matches)
    }

    // Match Results

    pub fn update_match_result(
        env: Env,
        tournament_id: BytesN<32>,
        match_id: BytesN<32>,
        winner: Address,
        score_a: u32,
        score_b: u32,
    ) {
        let tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        if tournament.state != TournamentState::InProgress as u32
            && tournament.state != TournamentState::BracketGenerated as u32
        {
            panic!("tournament must be in progress or bracket generated");
        }

        let mut match_data: Match = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentMatch(
                tournament_id.clone(),
                match_id.clone(),
            ))
            .expect("match not found");

        if match_data.status != MatchStatus::Scheduled as u32
            && match_data.status != MatchStatus::InProgress as u32
        {
            panic!("match cannot be updated");
        }

        if winner != match_data.player_a && winner != match_data.player_b {
            panic!("winner must be one of the players");
        }

        match_data.winner = Some(winner.clone());
        match_data.score_a = score_a;
        match_data.score_b = score_b;
        match_data.status = MatchStatus::Completed as u32;
        match_data.completed_at = Some(env.ledger().timestamp());

        env.storage().persistent().set(
            &DataKey::TournamentMatch(tournament_id.clone(), match_id.clone()),
            &match_data,
        );

        // Update analytics
        let mut analytics: TournamentAnalytics = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentAnalytics(tournament_id.clone()))
            .expect("analytics not found");
        analytics.completed_matches += 1;
        if let (Some(started), Some(completed)) = (match_data.started_at, match_data.completed_at) {
            let duration = completed - started;
            analytics.average_match_duration = (analytics.average_match_duration + duration)
                / (analytics.completed_matches as u64);
        }
        env.storage().persistent().set(
            &DataKey::TournamentAnalytics(tournament_id.clone()),
            &analytics,
        );

        events::emit_match_result_updated(&env, &tournament_id, &match_id, &winner);
    }

    // Tournament Progression

    pub fn start_tournament(env: Env, tournament_id: BytesN<32>) {
        let mut tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        if tournament.state != TournamentState::BracketGenerated as u32 {
            panic!("bracket must be generated first");
        }

        tournament.state = TournamentState::InProgress as u32;
        tournament.updated_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Tournament(tournament_id.clone()), &tournament);
    }

    pub fn advance_tournament(env: Env, tournament_id: BytesN<32>) {
        let mut tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        if tournament.state != TournamentState::InProgress as u32 {
            panic!("tournament must be in progress");
        }

        // Check if current round is complete
        let bracket: Bracket = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentBracket(tournament_id.clone()))
            .expect("bracket not found");

        if tournament.current_round < bracket.total_rounds {
            tournament.current_round += 1;
        } else {
            tournament.state = TournamentState::Completed as u32;
        }

        tournament.updated_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Tournament(tournament_id.clone()), &tournament);

        events::emit_tournament_advanced(
            &env,
            &tournament_id,
            tournament.current_phase,
            tournament.current_round,
        );
    }

    // Prize Distribution

    pub fn set_prize_allocations(
        env: Env,
        tournament_id: BytesN<32>,
        allocations: Vec<PrizeAllocation>,
    ) {
        let tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        tournament.organizer.require_auth();

        let mut escrow: PrizeEscrow = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentPrizeEscrow(tournament_id.clone()))
            .expect("escrow not found");

        escrow.allocations = allocations;

        env.storage().persistent().set(
            &DataKey::TournamentPrizeEscrow(tournament_id.clone()),
            &escrow,
        );
    }

    pub fn distribute_prizes(env: Env, tournament_id: BytesN<32>, winners: Map<Address, u32>) {
        let tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        tournament.organizer.require_auth();

        if tournament.state != TournamentState::Completed as u32 {
            panic!("tournament must be completed");
        }

        let mut escrow: PrizeEscrow = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentPrizeEscrow(tournament_id.clone()))
            .expect("escrow not found");

        let mut total_distributed: i128 = 0;
        let mut recipient_count: u32 = 0;

        for (_winner, position) in winners.iter() {
            for allocation in escrow.allocations.iter() {
                if allocation.position == position {
                    let amount = allocation.amount;
                    total_distributed += amount;
                    recipient_count += 1;
                    break;
                }
            }
        }

        escrow.distributed = total_distributed;

        env.storage().persistent().set(
            &DataKey::TournamentPrizeEscrow(tournament_id.clone()),
            &escrow,
        );

        // Update analytics
        let mut analytics: TournamentAnalytics = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentAnalytics(tournament_id.clone()))
            .expect("analytics not found");
        analytics.total_prize_distributed = total_distributed;
        env.storage().persistent().set(
            &DataKey::TournamentAnalytics(tournament_id.clone()),
            &analytics,
        );

        events::emit_prizes_distributed(&env, &tournament_id, total_distributed, recipient_count);
    }

    // Governance Controls

    pub fn pause_tournament(env: Env, tournament_id: BytesN<32>) {
        let tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        tournament.organizer.require_auth();

        if tournament.state != TournamentState::InProgress as u32 {
            panic!("tournament must be in progress");
        }

        let mut tournament_mut = tournament;
        tournament_mut.state = TournamentState::Paused as u32;
        tournament_mut.updated_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Tournament(tournament_id.clone()), &tournament_mut);

        events::emit_tournament_paused(&env, &tournament_id);
    }

    pub fn resume_tournament(env: Env, tournament_id: BytesN<32>) {
        let tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        tournament.organizer.require_auth();

        if tournament.state != TournamentState::Paused as u32 {
            panic!("tournament must be paused");
        }

        let mut tournament_mut = tournament;
        tournament_mut.state = TournamentState::InProgress as u32;
        tournament_mut.updated_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Tournament(tournament_id.clone()), &tournament_mut);

        events::emit_tournament_resumed(&env, &tournament_id);
    }

    // Emergency Controls

    pub fn cancel_tournament(env: Env, tournament_id: BytesN<32>, reason: String) {
        let tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        tournament.organizer.require_auth();

        let mut tournament_mut = tournament;
        tournament_mut.state = TournamentState::Cancelled as u32;
        tournament_mut.updated_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Tournament(tournament_id.clone()), &tournament_mut);

        events::emit_tournament_cancelled(&env, &tournament_id, &reason);
    }

    // Dispute Resolution

    pub fn raise_dispute(
        env: Env,
        tournament_id: BytesN<32>,
        match_id: BytesN<32>,
        reporter: Address,
        reason: String,
    ) {
        reporter.require_auth();

        let tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        if tournament.state != TournamentState::InProgress as u32 {
            panic!("tournament must be in progress");
        }

        let dispute = Dispute {
            match_id: match_id.clone(),
            reporter: reporter.clone(),
            reason,
            raised_at: env.ledger().timestamp(),
            resolved: false,
            resolution: None,
        };

        env.storage().persistent().set(
            &DataKey::Dispute(tournament_id.clone(), match_id.clone()),
            &dispute,
        );

        // Update analytics
        let mut analytics: TournamentAnalytics = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentAnalytics(tournament_id.clone()))
            .expect("analytics not found");
        analytics.disputed_matches += 1;
        env.storage().persistent().set(
            &DataKey::TournamentAnalytics(tournament_id.clone()),
            &analytics,
        );

        events::emit_dispute_raised(&env, &tournament_id, &match_id, &reporter);
    }

    pub fn resolve_dispute(
        env: Env,
        tournament_id: BytesN<32>,
        match_id: BytesN<32>,
        resolution: String,
    ) {
        let tournament: Tournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id.clone()))
            .expect("tournament not found");

        tournament.organizer.require_auth();

        let mut dispute: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(tournament_id.clone(), match_id.clone()))
            .expect("dispute not found");

        dispute.resolved = true;
        dispute.resolution = Some(resolution.clone());

        env.storage().persistent().set(
            &DataKey::Dispute(tournament_id.clone(), match_id.clone()),
            &dispute,
        );

        events::emit_dispute_resolved(&env, &tournament_id, &match_id, &resolution);
    }

    // Query Functions

    pub fn get_tournament(env: Env, tournament_id: BytesN<32>) -> Tournament {
        env.storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id))
            .expect("tournament not found")
    }

    pub fn get_tournament_players(env: Env, tournament_id: BytesN<32>) -> Vec<PlayerRegistration> {
        env.storage()
            .persistent()
            .get(&DataKey::TournamentPlayers(tournament_id))
            .expect("players not found")
    }

    pub fn get_tournament_bracket(env: Env, tournament_id: BytesN<32>) -> Bracket {
        env.storage()
            .persistent()
            .get(&DataKey::TournamentBracket(tournament_id))
            .expect("bracket not found")
    }

    pub fn get_match(env: Env, tournament_id: BytesN<32>, match_id: BytesN<32>) -> Match {
        env.storage()
            .persistent()
            .get(&DataKey::TournamentMatch(tournament_id, match_id))
            .expect("match not found")
    }

    pub fn get_prize_escrow(env: Env, tournament_id: BytesN<32>) -> PrizeEscrow {
        env.storage()
            .persistent()
            .get(&DataKey::TournamentPrizeEscrow(tournament_id))
            .expect("escrow not found")
    }

    pub fn get_tournament_analytics(env: Env, tournament_id: BytesN<32>) -> TournamentAnalytics {
        env.storage()
            .persistent()
            .get(&DataKey::TournamentAnalytics(tournament_id))
            .expect("analytics not found")
    }

    pub fn get_dispute(env: Env, tournament_id: BytesN<32>, match_id: BytesN<32>) -> Dispute {
        env.storage()
            .persistent()
            .get(&DataKey::Dispute(tournament_id, match_id))
            .expect("dispute not found")
    }
}

mod test;
