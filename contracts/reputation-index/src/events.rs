use soroban_sdk::{contractevent, Address};

#[contractevent]
pub struct ReputationChanged {
    pub player: Address,
    pub skill_delta: i128,
    pub fair_play_delta: i128,
    pub match_id: u64,
}

#[contractevent]
pub struct ReputationDecayed {
    pub player: Address,
    pub skill_decayed: i128,
    pub fair_play_decayed: i128,
}
