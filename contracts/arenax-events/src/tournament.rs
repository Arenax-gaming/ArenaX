use soroban_sdk::{contractevent, Address, BytesN, Env};

pub const NAMESPACE: &str = "ArenaXTournament";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXTourn_v1", "FINALIZED"])]
pub struct TournamentFinalized {
    pub tournament_id: BytesN<32>,
    pub finalized_at: u64,
}

#[contractevent(topics = ["ArenaXTournMgr_v1", "CREATED"])]
pub struct TournamentCreated {
    pub tournament_id: BytesN<32>,
    pub organizer: Address,
    pub tournament_type: u32,
    pub max_players: u32,
    pub prize_pool: i128,
}

#[contractevent(topics = ["ArenaXTournMgr_v1", "PLAYER_REGISTERED"])]
pub struct PlayerRegistered {
    pub tournament_id: BytesN<32>,
    pub player: Address,
    pub registration_time: u64,
}

#[contractevent(topics = ["ArenaXTournMgr_v1", "BRACKET_GENERATED"])]
pub struct BracketGenerated {
    pub tournament_id: BytesN<32>,
    pub bracket_type: u32,
    pub total_matches: u32,
}

#[contractevent(topics = ["ArenaXTournMgr_v1", "MATCH_RESULT_UPDATED"])]
pub struct MatchResultUpdated {
    pub tournament_id: BytesN<32>,
    pub match_id: BytesN<32>,
    pub winner: Address,
    pub updated_at: u64,
}

#[contractevent(topics = ["ArenaXTournMgr_v1", "TOURNAMENT_ADVANCED"])]
pub struct TournamentAdvanced {
    pub tournament_id: BytesN<32>,
    pub current_phase: u32,
    pub current_round: u32,
}

#[contractevent(topics = ["ArenaXTournMgr_v1", "PRIZES_DISTRIBUTED"])]
pub struct PrizesDistributed {
    pub tournament_id: BytesN<32>,
    pub total_amount: i128,
    pub recipient_count: u32,
}

#[contractevent(topics = ["ArenaXTournMgr_v1", "TOURNAMENT_CANCELLED"])]
pub struct TournamentCancelled {
    pub tournament_id: BytesN<32>,
    pub reason: soroban_sdk::String,
    pub cancelled_at: u64,
}

#[contractevent(topics = ["ArenaXTournMgr_v1", "TOURNAMENT_PAUSED"])]
pub struct TournamentPaused {
    pub tournament_id: BytesN<32>,
    pub paused_at: u64,
}

#[contractevent(topics = ["ArenaXTournMgr_v1", "TOURNAMENT_RESUMED"])]
pub struct TournamentResumed {
    pub tournament_id: BytesN<32>,
    pub resumed_at: u64,
}

#[contractevent(topics = ["ArenaXTournMgr_v1", "DISPUTE_RAISED"])]
pub struct DisputeRaised {
    pub tournament_id: BytesN<32>,
    pub match_id: BytesN<32>,
    pub reporter: Address,
    pub raised_at: u64,
}

#[contractevent(topics = ["ArenaXTournMgr_v1", "DISPUTE_RESOLVED"])]
pub struct DisputeResolved {
    pub tournament_id: BytesN<32>,
    pub match_id: BytesN<32>,
    pub resolution: soroban_sdk::String,
    pub resolved_at: u64,
}

pub fn emit_tournament_finalized(env: &Env, tournament_id: &BytesN<32>, finalized_at: u64) {
    TournamentFinalized {
        tournament_id: tournament_id.clone(),
        finalized_at,
    }
    .publish(env);
}

pub fn emit_tournament_created(
    env: &Env,
    tournament_id: &BytesN<32>,
    organizer: &Address,
    tournament_type: u32,
    max_players: u32,
    prize_pool: i128,
) {
    TournamentCreated {
        tournament_id: tournament_id.clone(),
        organizer: organizer.clone(),
        tournament_type,
        max_players,
        prize_pool,
    }
    .publish(env);
}

pub fn emit_player_registered(env: &Env, tournament_id: &BytesN<32>, player: &Address) {
    PlayerRegistered {
        tournament_id: tournament_id.clone(),
        player: player.clone(),
        registration_time: env.ledger().timestamp(),
    }
    .publish(env);
}

pub fn emit_bracket_generated(
    env: &Env,
    tournament_id: &BytesN<32>,
    bracket_type: u32,
    total_matches: u32,
) {
    BracketGenerated {
        tournament_id: tournament_id.clone(),
        bracket_type,
        total_matches,
    }
    .publish(env);
}

pub fn emit_match_result_updated(
    env: &Env,
    tournament_id: &BytesN<32>,
    match_id: &BytesN<32>,
    winner: &Address,
) {
    MatchResultUpdated {
        tournament_id: tournament_id.clone(),
        match_id: match_id.clone(),
        winner: winner.clone(),
        updated_at: env.ledger().timestamp(),
    }
    .publish(env);
}

pub fn emit_tournament_advanced(
    env: &Env,
    tournament_id: &BytesN<32>,
    current_phase: u32,
    current_round: u32,
) {
    TournamentAdvanced {
        tournament_id: tournament_id.clone(),
        current_phase,
        current_round,
    }
    .publish(env);
}

pub fn emit_prizes_distributed(
    env: &Env,
    tournament_id: &BytesN<32>,
    total_amount: i128,
    recipient_count: u32,
) {
    PrizesDistributed {
        tournament_id: tournament_id.clone(),
        total_amount,
        recipient_count,
    }
    .publish(env);
}

pub fn emit_tournament_cancelled(
    env: &Env,
    tournament_id: &BytesN<32>,
    reason: &soroban_sdk::String,
) {
    TournamentCancelled {
        tournament_id: tournament_id.clone(),
        reason: reason.clone(),
        cancelled_at: env.ledger().timestamp(),
    }
    .publish(env);
}

pub fn emit_tournament_paused(env: &Env, tournament_id: &BytesN<32>) {
    TournamentPaused {
        tournament_id: tournament_id.clone(),
        paused_at: env.ledger().timestamp(),
    }
    .publish(env);
}

pub fn emit_tournament_resumed(env: &Env, tournament_id: &BytesN<32>) {
    TournamentResumed {
        tournament_id: tournament_id.clone(),
        resumed_at: env.ledger().timestamp(),
    }
    .publish(env);
}

pub fn emit_dispute_raised(
    env: &Env,
    tournament_id: &BytesN<32>,
    match_id: &BytesN<32>,
    reporter: &Address,
) {
    DisputeRaised {
        tournament_id: tournament_id.clone(),
        match_id: match_id.clone(),
        reporter: reporter.clone(),
        raised_at: env.ledger().timestamp(),
    }
    .publish(env);
}

pub fn emit_dispute_resolved(
    env: &Env,
    tournament_id: &BytesN<32>,
    match_id: &BytesN<32>,
    resolution: &soroban_sdk::String,
) {
    DisputeResolved {
        tournament_id: tournament_id.clone(),
        match_id: match_id.clone(),
        resolution: resolution.clone(),
        resolved_at: env.ledger().timestamp(),
    }
    .publish(env);
}
