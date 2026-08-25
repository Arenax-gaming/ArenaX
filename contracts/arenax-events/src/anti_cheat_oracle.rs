use soroban_sdk::{contractevent, Address, Env};

#[contractevent(topics = ["AntiCheatOracle", "ORACLE_ADDED"])]
pub struct OracleAdded {
    pub oracle: Address,
}

#[contractevent(topics = ["AntiCheatOracle", "ORACLE_REMOVED"])]
pub struct OracleRemoved {
    pub oracle: Address,
}

#[contractevent(topics = ["AntiCheatOracle", "ORACLE_HEALTH"])]
pub struct OracleHealthUpdated {
    pub oracle: Address,
    pub state: u32,
}

#[contractevent(topics = ["AntiCheatOracle", "FEED_REGISTERED"])]
pub struct FeedRegistered {
    pub feed_id: u32,
    pub oracle: Address,
    pub feed_type: u32,
}

#[contractevent(topics = ["AntiCheatOracle", "FEED_STATUS"])]
pub struct FeedStatusChanged {
    pub feed_id: u32,
    pub status: u32,
}

#[contractevent(topics = ["AntiCheatOracle", "FEED_READING"])]
pub struct FeedReadingSubmitted {
    pub feed_id: u32,
    pub oracle: Address,
    pub player: Address,
    pub match_id: u64,
    pub value: i64,
    pub anomaly_score: u32,
}

#[contractevent(topics = ["AntiCheatOracle", "RULE_ADDED"])]
pub struct RuleAdded {
    pub rule_id: u32,
    pub rule_type: u32,
    pub severity: u32,
}

#[contractevent(topics = ["AntiCheatOracle", "ALERT_STATUS"])]
pub struct AlertStatusChanged {
    pub alert_id: u64,
    pub status: u32,
}

#[contractevent(topics = ["AntiCheatOracle", "ALERT_RAISED"])]
pub struct AlertRaised {
    pub alert_id: u64,
    pub rule_id: u32,
    pub player: Address,
    pub match_id: u64,
    pub severity: u32,
    pub value: i64,
}

#[contractevent(topics = ["AntiCheatOracle", "PROPOSAL_CREATED"])]
pub struct ProposalCreated {
    pub proposal_id: u64,
    pub proposer: Address,
    pub proposal_type: u32,
}

#[contractevent(topics = ["AntiCheatOracle", "PROPOSAL_VOTED"])]
pub struct ProposalVoted {
    pub proposal_id: u64,
    pub voter: Address,
    pub approve: bool,
    pub votes_for: u32,
}

#[contractevent(topics = ["AntiCheatOracle", "PROPOSAL_EXECUTED"])]
pub struct ProposalExecuted {
    pub proposal_id: u64,
}

#[contractevent(topics = ["AntiCheatOracle", "CONFIG_UPDATED"])]
pub struct ConfigUpdated {}

#[contractevent(topics = ["AntiCheatOracle", "EMERGENCY_PAUSE"])]
pub struct EmergencyPauseToggled {
    pub paused: bool,
}

#[contractevent(topics = ["AntiCheatOracle", "MONITORING"])]
pub struct MonitoringSnapshot {
    pub active_feeds: u32,
    pub active_oracles: u32,
    pub open_alerts: u32,
    pub total_feed_readings: u64,
    pub total_alerts_raised: u64,
}

pub fn emit_oracle_added(env: &Env, oracle: &Address) {
    OracleAdded {
        oracle: oracle.clone(),
    }
    .publish(env);
}

pub fn emit_oracle_removed(env: &Env, oracle: &Address) {
    OracleRemoved {
        oracle: oracle.clone(),
    }
    .publish(env);
}

pub fn emit_oracle_health_updated(env: &Env, oracle: &Address, state: u32) {
    OracleHealthUpdated {
        oracle: oracle.clone(),
        state,
    }
    .publish(env);
}

pub fn emit_feed_registered(env: &Env, feed_id: u32, oracle: &Address, feed_type: u32) {
    FeedRegistered {
        feed_id,
        oracle: oracle.clone(),
        feed_type,
    }
    .publish(env);
}

pub fn emit_feed_status_changed(env: &Env, feed_id: u32, status: u32) {
    FeedStatusChanged { feed_id, status }.publish(env);
}

#[allow(clippy::too_many_arguments)]
pub fn emit_feed_reading_submitted(
    env: &Env,
    feed_id: u32,
    oracle: &Address,
    player: &Address,
    match_id: u64,
    value: i64,
    anomaly_score: u32,
) {
    FeedReadingSubmitted {
        feed_id,
        oracle: oracle.clone(),
        player: player.clone(),
        match_id,
        value,
        anomaly_score,
    }
    .publish(env);
}

pub fn emit_rule_added(env: &Env, rule_id: u32, rule_type: u32, severity: u32) {
    RuleAdded {
        rule_id,
        rule_type,
        severity,
    }
    .publish(env);
}

pub fn emit_alert_status_changed(env: &Env, alert_id: u64, status: u32) {
    AlertStatusChanged { alert_id, status }.publish(env);
}

#[allow(clippy::too_many_arguments)]
pub fn emit_alert_raised(
    env: &Env,
    alert_id: u64,
    rule_id: u32,
    player: &Address,
    match_id: u64,
    severity: u32,
    value: i64,
) {
    AlertRaised {
        alert_id,
        rule_id,
        player: player.clone(),
        match_id,
        severity,
        value,
    }
    .publish(env);
}

pub fn emit_proposal_created(env: &Env, proposal_id: u64, proposer: &Address, proposal_type: u32) {
    ProposalCreated {
        proposal_id,
        proposer: proposer.clone(),
        proposal_type,
    }
    .publish(env);
}

pub fn emit_proposal_voted(
    env: &Env,
    proposal_id: u64,
    voter: &Address,
    approve: bool,
    votes_for: u32,
) {
    ProposalVoted {
        proposal_id,
        voter: voter.clone(),
        approve,
        votes_for,
    }
    .publish(env);
}

pub fn emit_proposal_executed(env: &Env, proposal_id: u64) {
    ProposalExecuted { proposal_id }.publish(env);
}

pub fn emit_config_updated(env: &Env) {
    ConfigUpdated {}.publish(env);
}

pub fn emit_emergency_pause_toggled(env: &Env, paused: bool) {
    EmergencyPauseToggled { paused }.publish(env);
}

#[allow(clippy::too_many_arguments)]
pub fn emit_monitoring_snapshot(
    env: &Env,
    active_feeds: u32,
    active_oracles: u32,
    open_alerts: u32,
    total_feed_readings: u64,
    total_alerts_raised: u64,
) {
    MonitoringSnapshot {
        active_feeds,
        active_oracles,
        open_alerts,
        total_feed_readings,
        total_alerts_raised,
    }
    .publish(env);
}
