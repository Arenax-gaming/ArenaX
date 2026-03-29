use soroban_sdk::{contractevent, Address, Env};

pub const NAMESPACE: &str = "ArenaXAntiCheat";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXAC_v1", "FLAG"])]
pub struct AntiCheatFlag {
    pub player: Address,
    pub match_id: u64,
    pub severity: u32,
    pub penalty_applied: i128,
    pub oracle: Address,
    pub timestamp: u64,
}

pub fn emit_anticheat_flag(env: &Env, player: &Address, match_id: u64, severity: u32, penalty_applied: i128, oracle: &Address, timestamp: u64) {
    AntiCheatFlag { player: player.clone(), match_id, severity, penalty_applied, oracle: oracle.clone(), timestamp }.publish(env);
}
