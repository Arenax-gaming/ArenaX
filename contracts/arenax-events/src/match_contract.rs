use soroban_sdk::{contractevent, Address, BytesN, Env};

pub const NAMESPACE: &str = "ArenaXMatch";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXMatch_v1", "CREATED"])]
pub struct MatchCreated {
    pub match_id: BytesN<32>,
    pub player_a: Address,
    pub player_b: Address,
}

#[contractevent(topics = ["ArenaXMatch_v1", "STARTED"])]
pub struct MatchStarted {
    pub match_id: BytesN<32>,
    pub started_at: u64,
}

#[contractevent(topics = ["ArenaXMatch_v1", "COMPLETED"])]
pub struct MatchCompleted {
    pub match_id: BytesN<32>,
    pub winner: Address,
}

#[contractevent(topics = ["ArenaXMatch_v1", "DISPUTED"])]
pub struct MatchDisputed {
    pub match_id: BytesN<32>,
}

#[contractevent(topics = ["ArenaXMatch_v1", "CANCELLED"])]
pub struct MatchCancelled {
    pub match_id: BytesN<32>,
}

#[contractevent(topics = ["ArenaXMatch_v1", "RESOLVED"])]
pub struct MatchResolved {
    pub match_id: BytesN<32>,
    pub winner: Address,
}

pub fn emit_match_created(
    env: &Env,
    match_id: &BytesN<32>,
    player_a: &Address,
    player_b: &Address,
) {
    MatchCreated {
        match_id: match_id.clone(),
        player_a: player_a.clone(),
        player_b: player_b.clone(),
    }
    .publish(env);
}

pub fn emit_match_started(env: &Env, match_id: &BytesN<32>, started_at: u64) {
    MatchStarted {
        match_id: match_id.clone(),
        started_at,
    }
    .publish(env);
}

pub fn emit_match_completed(env: &Env, match_id: &BytesN<32>, winner: &Address) {
    MatchCompleted {
        match_id: match_id.clone(),
        winner: winner.clone(),
    }
    .publish(env);
}

pub fn emit_match_disputed(env: &Env, match_id: &BytesN<32>) {
    MatchDisputed {
        match_id: match_id.clone(),
    }
    .publish(env);
}

pub fn emit_match_cancelled(env: &Env, match_id: &BytesN<32>) {
    MatchCancelled {
        match_id: match_id.clone(),
    }
    .publish(env);
}

pub fn emit_match_resolved(env: &Env, match_id: &BytesN<32>, winner: &Address) {
    MatchResolved {
        match_id: match_id.clone(),
        winner: winner.clone(),
    }
    .publish(env);
}
