use soroban_sdk::{contractevent, Address, Env, String};

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

pub fn emit_anticheat_flag(
    env: &Env,
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

// Anti-cheat contract events
#[contractevent(topics = ["ArenaXAC_v1", "SUSPICIOUS"])]
pub struct SuspiciousActivityReported {
    pub reporter: Address,
    pub player: Address,
    pub match_id: u64,
    pub pattern: u32,
    pub severity: u32,
    pub report_id: u64,
}

#[contractevent(topics = ["ArenaXAC_v1", "SANCTION"])]
pub struct SanctionApplied {
    pub player: Address,
    pub sanction_id: u64,
    pub sanction_type: u32,
    pub reason: String,
    pub duration: u64,
}

#[contractevent(topics = ["ArenaXAC_v1", "APPEAL"])]
pub struct SanctionAppealed {
    pub player: Address,
    pub sanction_id: u64,
    pub appeal_id: u64,
    pub reason: String,
}

#[contractevent(topics = ["ArenaXAC_v1", "REVIEW"])]
pub struct AppealReviewed {
    pub appeal_id: u64,
    pub approved: bool,
}

#[contractevent(topics = ["ArenaXAC_v1", "TRUST"])]
pub struct TrustScoreUpdated {
    pub player: Address,
    pub score: u32,
}

pub fn emit_suspicious_activity_reported(
    env: &Env,
    reporter: &Address,
    player: &Address,
    match_id: u64,
    pattern: u32,
    severity: u32,
    report_id: u64,
) {
    SuspiciousActivityReported {
        reporter: reporter.clone(),
        player: player.clone(),
        match_id,
        pattern,
        severity,
        report_id,
    }
    .publish(env);
}

pub fn emit_sanction_applied(
    env: &Env,
    player: &Address,
    sanction_id: u64,
    sanction_type: u32,
    reason: &String,
    duration: u64,
) {
    SanctionApplied {
        player: player.clone(),
        sanction_id,
        sanction_type,
        reason: reason.clone(),
        duration,
    }
    .publish(env);
}

pub fn emit_sanction_appealed(
    env: &Env,
    player: &Address,
    sanction_id: u64,
    appeal_id: u64,
    reason: &String,
) {
    SanctionAppealed {
        player: player.clone(),
        sanction_id,
        appeal_id,
        reason: reason.clone(),
    }
    .publish(env);
}

pub fn emit_appeal_reviewed(env: &Env, appeal_id: u64, approved: bool) {
    AppealReviewed {
        appeal_id,
        approved,
    }
    .publish(env);
}

pub fn emit_trust_score_updated(env: &Env, player: &Address, score: u32) {
    TrustScoreUpdated {
        player: player.clone(),
        score,
    }
    .publish(env);
}
