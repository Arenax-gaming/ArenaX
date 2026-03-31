use soroban_sdk::{contractevent, BytesN, Env};

pub const NAMESPACE: &str = "ArenaXTournament";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXTourn_v1", "FINALIZED"])]
pub struct TournamentFinalized {
    pub tournament_id: BytesN<32>,
    pub finalized_at: u64,
}

pub fn emit_tournament_finalized(env: &Env, tournament_id: &BytesN<32>, finalized_at: u64) {
    TournamentFinalized {
        tournament_id: tournament_id.clone(),
        finalized_at,
    }
    .publish(env);
}
