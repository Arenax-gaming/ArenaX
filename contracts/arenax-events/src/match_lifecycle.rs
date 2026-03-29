use soroban_sdk::{contractevent, Address, BytesN, Env, Vec};

pub const NAMESPACE: &str = "ArenaXMatchLifecycle";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXMLf_v1", "CREATED"])]
pub struct MatchCreated {
    pub match_id: BytesN<32>,
    pub players: Vec<Address>,
    pub stake_asset: Address,
    pub stake_amount: i128,
    pub created_at: u64,
}

#[contractevent(topics = ["ArenaXMLf_v1", "RESULT"])]
pub struct ResultSubmitted {
    pub match_id: BytesN<32>,
    pub reporter: Address,
    pub score: i64,
    pub report_number: u32,
}

#[contractevent(topics = ["ArenaXMLf_v1", "FINALIZED"])]
pub struct MatchFinalized {
    pub match_id: BytesN<32>,
    pub winner: Address,
    pub finalized_at: u64,
}

pub fn emit_match_created(
    env: &Env,
    match_id: &BytesN<32>,
    players: &Vec<Address>,
    stake_asset: &Address,
    stake_amount: i128,
    created_at: u64,
) {
    MatchCreated {
        match_id: match_id.clone(),
        players: players.clone(),
        stake_asset: stake_asset.clone(),
        stake_amount,
        created_at,
    }
    .publish(env);
}

pub fn emit_result_submitted(
    env: &Env,
    match_id: &BytesN<32>,
    reporter: &Address,
    score: i64,
    report_number: u32,
) {
    ResultSubmitted {
        match_id: match_id.clone(),
        reporter: reporter.clone(),
        score,
        report_number,
    }
    .publish(env);
}

pub fn emit_match_finalized(env: &Env, match_id: &BytesN<32>, winner: &Address, finalized_at: u64) {
    MatchFinalized {
        match_id: match_id.clone(),
        winner: winner.clone(),
        finalized_at,
    }
    .publish(env);
}
