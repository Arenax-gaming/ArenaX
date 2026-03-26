use soroban_sdk::{contractevent, Address};

/// Event type for anti-cheat; includes AntiCheatFlag for confirmations.
#[contractevent(topics = ["ArenaXAntiCheat", "FLAG"])]
pub struct AntiCheatFlag {
    pub player: Address,
    pub match_id: u64,
    pub severity: u32,
    pub penalty_applied: i128,
    pub oracle: Address,
    pub timestamp: u64,
}

pub fn emit_anticheat_flag(
    env: &soroban_sdk::Env,
    player: &Address,
    match_id: u64,
    severity: u32,
    penalty_applied: i128,
    oracle: &Address,
    timestamp: u64,
) {
    AntiCheatFlag {
        player: player.clone(),
        match_id,
        severity,
        penalty_applied,
        oracle: oracle.clone(),
        timestamp,
    }
    .publish(env);
}
