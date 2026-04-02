use soroban_sdk::{contractevent, Address, Env};

pub const NAMESPACE: &str = "ArenaXReputationIndex";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXRepIdx_v1", "REPUTATION_CHANGED"])]
pub struct ReputationChanged {
    pub player: Address,
    pub skill_delta: i128,
    pub fair_play_delta: i128,
    pub match_id: u64,
}

#[contractevent(topics = ["ArenaXRepIdx_v1", "REPUTATION_DECAYED"])]
pub struct ReputationDecayed {
    pub player: Address,
    pub skill_decayed: i128,
    pub fair_play_decayed: i128,
}

pub fn emit_reputation_changed(
    env: &Env,
    player: &Address,
    skill_delta: i128,
    fair_play_delta: i128,
    match_id: u64,
) {
    ReputationChanged {
        player: player.clone(),
        skill_delta,
        fair_play_delta,
        match_id,
    }
    .publish(env);
}

pub fn emit_reputation_decayed(
    env: &Env,
    player: &Address,
    skill_decayed: i128,
    fair_play_decayed: i128,
) {
    ReputationDecayed {
        player: player.clone(),
        skill_decayed,
        fair_play_decayed,
    }
    .publish(env);
}
