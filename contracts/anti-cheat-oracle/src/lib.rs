#![no_std]

mod error;
mod storage;

use arenax_events::anti_cheat as anticheat_events;
use arenax_events::anti_cheat_oracle as events;

use soroban_sdk::{contract, contractimpl, Address, Bytes, Env, String, Vec};
use storage::{
    AlertRecord, AnalyticsTotals, AntiCheatConfirmation, DataFeed, DataKey, DetectionRule,
    FeedReading, GovernanceProposal, MonitoringState, OracleConfig, OracleHealth, ALERT_CRITICAL,
    ALERT_INFO, ALERT_OPEN, ALERT_RESOLVED, ALERT_WARNING, FEED_STATUS_ACTIVE,
    FEED_STATUS_REVOKED, FEED_TYPE_BEHAVIOR, FEED_TYPE_EXTERNAL,
    FEED_TYPE_SCORE, FEED_TYPE_TELEMETRY, ORACLE_HEALTHY, ORACLE_OFFLINE,
    PROPOSAL_STATUS_ACTIVE, PROPOSAL_STATUS_EXECUTED, PROPOSAL_STATUS_EXPIRED,
    PROPOSAL_STATUS_PASSED, PROPOSAL_STATUS_REJECTED,
    PROPOSAL_TYPE_EMERGENCY_PAUSE, PROPOSAL_TYPE_UPDATE_QUORUM,
    RULE_ANOMALY_ML, RULE_CONSENSUS, RULE_FREQ_ABUSE, RULE_SCORE_SPIKE,
    RULE_STALENESS, RULE_VELOCITY,
};

pub use error::AntiCheatError;
pub use storage::{
    AlertRecord as OracleAlert, AnalyticsTotals as OracleAnalytics,
    DataFeed as OracleDataFeed, DetectionRule as OracleDetectionRule,
    FeedReading as OracleFeedReading, GovernanceProposal as OracleProposal,
    MonitoringState as OracleMonitoringState, OracleConfig as OracleConfiguration,
    OracleHealth as OracleHealthState,
};

// ─── Penalty table (kept for backward-compat with submit_flag) ────────────────
const PENALTY_LOW: i128 = 5;
const PENALTY_MEDIUM: i128 = 15;
const PENALTY_HIGH: i128 = 30;

// ─── Default oracle config values ─────────────────────────────────────────────
const DEFAULT_MIN_CONFIRMATIONS: u32 = 2;
const DEFAULT_MAX_STALENESS: u64 = 300; // 5 minutes
const DEFAULT_CONSENSUS_BPS: u32 = 500; // 5% deviation allowed
const DEFAULT_MIN_SUBMIT_INTERVAL: u64 = 10; // 10 seconds
const DEFAULT_MAX_READINGS: u32 = 100;
const DEFAULT_GOVERNANCE_QUORUM: u32 = 2;
const PROPOSAL_TTL: u64 = 604_800; // 7 days

// ─── Detection thresholds ─────────────────────────────────────────────────────
const ANOMALY_ML_DEFAULT_THRESHOLD: i64 = 75; // score > 75 → alert
const SCORE_SPIKE_DEFAULT_THRESHOLD: i64 = 500; // absolute value jump
const VELOCITY_DEFAULT_THRESHOLD: i64 = 200; // delta per second
const STALENESS_DEFAULT_THRESHOLD: i64 = 300; // seconds without update
const FREQ_ABUSE_DEFAULT_THRESHOLD: i64 = 5; // submissions per minute

#[contract]
pub struct AntiCheatOracle;

#[contractimpl]
impl AntiCheatOracle {
    // ══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ══════════════════════════════════════════════════════════════════════════

    /// Initialize the oracle.  Seeds default config, default detection rules,
    /// and initial analytics / monitoring state.
    pub fn initialize(
        env: Env,
        admin: Address,
        min_confirmations: u32,
        max_staleness_secs: u64,
        governance_quorum: u32,
    ) -> Result<(), AntiCheatError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(AntiCheatError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::EmergencyPaused, &false);

        let quorum = if governance_quorum == 0 {
            DEFAULT_GOVERNANCE_QUORUM
        } else {
            governance_quorum
        };
        env.storage()
            .instance()
            .set(&DataKey::GovernanceQuorum, &quorum);

        let cfg = OracleConfig {
            min_confirmations: if min_confirmations == 0 {
                DEFAULT_MIN_CONFIRMATIONS
            } else {
                min_confirmations
            },
            max_staleness_secs: if max_staleness_secs == 0 {
                DEFAULT_MAX_STALENESS
            } else {
                max_staleness_secs
            },
            consensus_threshold_bps: DEFAULT_CONSENSUS_BPS,
            min_submit_interval: DEFAULT_MIN_SUBMIT_INTERVAL,
            max_readings_per_feed: DEFAULT_MAX_READINGS,
        };
        env.storage().instance().set(&DataKey::OracleConfig, &cfg);

        // Analytics
        let analytics = AnalyticsTotals {
            total_feed_readings: 0,
            total_alerts_raised: 0,
            total_alerts_resolved: 0,
            total_false_positives: 0,
            total_confirmations: 0,
            total_rules_triggered: 0,
            detection_accuracy_bps: 10_000,
            avg_confirmation_delay: 0,
            last_updated: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsTotals, &analytics);

        // Counters
        env.storage().persistent().set(&DataKey::FeedCounter, &0u32);
        env.storage().persistent().set(&DataKey::RuleCounter, &0u32);
        env.storage()
            .persistent()
            .set(&DataKey::AlertCounter, &0u64);
        env.storage()
            .persistent()
            .set(&DataKey::ProposalCounter, &0u64);

        // Monitoring
        let monitoring = MonitoringState {
            active_feeds: 0,
            active_oracles: 0,
            open_alerts: 0,
            active_rules: 0,
            last_snapshot: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::MonitoringState, &monitoring);
        env.storage()
            .persistent()
            .set(&DataKey::LastHeartbeat, &env.ledger().timestamp());

        // Seed default detection rules
        Self::seed_default_rules(&env);

        Ok(())
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ORACLE MANAGEMENT
    // ══════════════════════════════════════════════════════════════════════════

    /// Register a new oracle address (admin only).
    pub fn add_oracle(env: Env, oracle: Address) -> Result<(), AntiCheatError> {
        Self::require_admin(&env)?;
        Self::check_not_paused(&env)?;

        env.storage()
            .instance()
            .set(&DataKey::AuthorizedOracle(oracle.clone()), &true);

        let health = OracleHealth {
            oracle: oracle.clone(),
            state: ORACLE_HEALTHY,
            total_submissions: 0,
            valid_submissions: 0,
            last_submission: 0,
            consecutive_errors: 0,
            uptime_score: 100,
        };
        env.storage()
            .instance()
            .set(&DataKey::OracleHealth(oracle.clone()), &health);

        let mut mon = Self::get_monitoring_state(&env);
        mon.active_oracles += 1;
        env.storage()
            .persistent()
            .set(&DataKey::MonitoringState, &mon);

        events::emit_oracle_added(&env, &oracle);
        Ok(())
    }

    /// Revoke an oracle (admin only).
    pub fn remove_oracle(env: Env, oracle: Address) -> Result<(), AntiCheatError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .remove(&DataKey::AuthorizedOracle(oracle.clone()));

        let mut mon = Self::get_monitoring_state(&env);
        mon.active_oracles = mon.active_oracles.saturating_sub(1);
        env.storage()
            .persistent()
            .set(&DataKey::MonitoringState, &mon);

        events::emit_oracle_removed(&env, &oracle);
        Ok(())
    }

    pub fn is_authorized_oracle(env: Env, oracle: Address) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::AuthorizedOracle(oracle))
            .unwrap_or(false)
    }

    /// Update health state for an oracle (admin or self).
    pub fn update_oracle_health(
        env: Env,
        oracle: Address,
        state: u32,
    ) -> Result<(), AntiCheatError> {
        oracle.require_auth();
        if state > ORACLE_OFFLINE {
            return Err(AntiCheatError::InvalidOracleState);
        }
        let mut health: OracleHealth = env
            .storage()
            .instance()
            .get(&DataKey::OracleHealth(oracle.clone()))
            .ok_or(AntiCheatError::OracleNotAuthorized)?;
        health.state = state;
        env.storage()
            .instance()
            .set(&DataKey::OracleHealth(oracle.clone()), &health);
        events::emit_oracle_health_updated(&env, &oracle, state);
        Ok(())
    }

    pub fn get_oracle_health(env: Env, oracle: Address) -> Option<OracleHealth> {
        env.storage().instance().get(&DataKey::OracleHealth(oracle))
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DATA FEED MANAGEMENT
    // ══════════════════════════════════════════════════════════════════════════

    /// Register a new data feed.  Any authorized oracle may own a feed.
    pub fn register_feed(
        env: Env,
        oracle: Address,
        feed_type: u32,
        description: String,
        min_value: i64,
        max_value: i64,
    ) -> Result<u32, AntiCheatError> {
        oracle.require_auth();
        Self::require_oracle(&env, &oracle)?;
        Self::check_not_paused(&env)?;

        if feed_type > FEED_TYPE_EXTERNAL {
            return Err(AntiCheatError::InvalidFeedType);
        }
        if min_value >= max_value {
            return Err(AntiCheatError::InvalidThreshold);
        }

        let feed_id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::FeedCounter)
            .unwrap_or(0)
            + 1;
        env.storage()
            .persistent()
            .set(&DataKey::FeedCounter, &feed_id);

        let now = env.ledger().timestamp();
        let feed = DataFeed {
            feed_id,
            feed_type,
            description,
            owner: oracle.clone(),
            status: FEED_STATUS_ACTIVE,
            created_at: now,
            last_updated: now,
            total_readings: 0,
            min_value,
            max_value,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Feed(feed_id), &feed);
        env.storage()
            .persistent()
            .set(&DataKey::FeedReadingSeq(feed_id), &0u32);

        let mut mon = Self::get_monitoring_state(&env);
        mon.active_feeds += 1;
        env.storage()
            .persistent()
            .set(&DataKey::MonitoringState, &mon);

        events::emit_feed_registered(&env, feed_id, &oracle, feed_type);
        Ok(feed_id)
    }

    /// Pause or resume a feed (owner or admin).
    pub fn set_feed_status(
        env: Env,
        caller: Address,
        feed_id: u32,
        status: u32,
    ) -> Result<(), AntiCheatError> {
        caller.require_auth();
        let mut feed: DataFeed = env
            .storage()
            .persistent()
            .get(&DataKey::Feed(feed_id))
            .ok_or(AntiCheatError::FeedNotFound)?;

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AntiCheatError::NotInitialized)?;
        if caller != feed.owner && caller != admin {
            return Err(AntiCheatError::Unauthorized);
        }
        if status > FEED_STATUS_REVOKED {
            return Err(AntiCheatError::InvalidFeedType);
        }

        let old_status = feed.status;
        feed.status = status;
        env.storage()
            .persistent()
            .set(&DataKey::Feed(feed_id), &feed);

        // Keep active_feeds count consistent
        if old_status == FEED_STATUS_ACTIVE && status != FEED_STATUS_ACTIVE {
            let mut mon = Self::get_monitoring_state(&env);
            mon.active_feeds = mon.active_feeds.saturating_sub(1);
            env.storage()
                .persistent()
                .set(&DataKey::MonitoringState, &mon);
        } else if old_status != FEED_STATUS_ACTIVE && status == FEED_STATUS_ACTIVE {
            let mut mon = Self::get_monitoring_state(&env);
            mon.active_feeds += 1;
            env.storage()
                .persistent()
                .set(&DataKey::MonitoringState, &mon);
        }

        events::emit_feed_status_changed(&env, feed_id, status);
        Ok(())
    }

    pub fn get_feed(env: Env, feed_id: u32) -> Option<DataFeed> {
        env.storage().persistent().get(&DataKey::Feed(feed_id))
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ORACLE FEED SUBMISSION (real-time data ingestion)
    // ══════════════════════════════════════════════════════════════════════════

    /// Submit a reading to a data feed.
    ///
    /// This is the primary ingestion endpoint.  After storing the reading the
    /// engine immediately runs all enabled detection rules against it and raises
    /// alerts for any violations.
    pub fn submit_reading(
        env: Env,
        oracle: Address,
        feed_id: u32,
        value: i64,
        confidence: u32,
        player: Address,
        match_id: u64,
    ) -> Result<u32, AntiCheatError> {
        oracle.require_auth();
        Self::require_oracle(&env, &oracle)?;
        Self::check_not_paused(&env)?;

        if confidence > 100 {
            return Err(AntiCheatError::InvalidConfidence);
        }

        let mut feed: DataFeed = env
            .storage()
            .persistent()
            .get(&DataKey::Feed(feed_id))
            .ok_or(AntiCheatError::FeedNotFound)?;

        if feed.status == FEED_STATUS_REVOKED {
            return Err(AntiCheatError::FeedRevoked);
        }
        if feed.status != FEED_STATUS_ACTIVE {
            return Err(AntiCheatError::FeedNotActive);
        }

        // Range check
        if value < feed.min_value || value > feed.max_value {
            return Err(AntiCheatError::FeedValueOutOfRange);
        }

        let cfg: OracleConfig = env
            .storage()
            .instance()
            .get(&DataKey::OracleConfig)
            .ok_or(AntiCheatError::NotInitialized)?;

        // Rate-limit check
        let mut health: OracleHealth = env
            .storage()
            .instance()
            .get(&DataKey::OracleHealth(oracle.clone()))
            .ok_or(AntiCheatError::OracleNotAuthorized)?;

        let now = env.ledger().timestamp();
        if health.last_submission > 0
            && now.saturating_sub(health.last_submission) < cfg.min_submit_interval
        {
            return Err(AntiCheatError::SubmitRateLimited);
        }

        // Compute anomaly score from recent readings
        let anomaly_score = Self::compute_anomaly_score(&env, feed_id, value, &feed);

        // Assign sequence number (ring-buffer modulo)
        let seq: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::FeedReadingSeq(feed_id))
            .unwrap_or(0);
        let next_seq = (seq % cfg.max_readings_per_feed) + 1;
        env.storage()
            .persistent()
            .set(&DataKey::FeedReadingSeq(feed_id), &next_seq);

        let reading = FeedReading {
            feed_id,
            seq: next_seq,
            oracle: oracle.clone(),
            value,
            confidence,
            player: player.clone(),
            match_id,
            timestamp: now,
            anomaly_score,
        };
        env.storage()
            .persistent()
            .set(&DataKey::FeedReading(feed_id, next_seq), &reading);

        // Update feed metadata
        feed.last_updated = now;
        feed.total_readings += 1;
        env.storage()
            .persistent()
            .set(&DataKey::Feed(feed_id), &feed);

        // Update oracle health
        health.total_submissions += 1;
        health.valid_submissions += 1;
        health.last_submission = now;
        health.consecutive_errors = 0;
        health.uptime_score =
            ((health.valid_submissions * 100) / health.total_submissions.max(1)) as u32;
        env.storage()
            .instance()
            .set(&DataKey::OracleHealth(oracle.clone()), &health);

        // Per-oracle submission count
        let prev_count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::OracleSubmitCount(oracle.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::OracleSubmitCount(oracle.clone()),
            &(prev_count + 1),
        );

        // Update heartbeat
        env.storage()
            .persistent()
            .set(&DataKey::LastHeartbeat, &now);

        // Analytics
        let mut analytics = Self::get_analytics_totals(&env);
        analytics.total_feed_readings += 1;
        analytics.last_updated = now;
        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsTotals, &analytics);

        // Emit
        events::emit_feed_reading_submitted(
            &env,
            feed_id,
            &oracle,
            &player,
            match_id,
            value,
            anomaly_score,
        );

        // Run real-time detection engine
        Self::run_detection_engine(&env, &reading, &feed);

        Ok(next_seq)
    }

    /// Get a specific reading by (feed_id, seq).
    pub fn get_reading(env: Env, feed_id: u32, seq: u32) -> Option<FeedReading> {
        env.storage()
            .persistent()
            .get(&DataKey::FeedReading(feed_id, seq))
    }

    /// Get the latest reading for a feed (at current sequence pointer).
    pub fn get_latest_reading(env: Env, feed_id: u32) -> Option<FeedReading> {
        let seq: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::FeedReadingSeq(feed_id))
            .unwrap_or(0);
        if seq == 0 {
            return None;
        }
        env.storage()
            .persistent()
            .get(&DataKey::FeedReading(feed_id, seq))
    }

    // ══════════════════════════════════════════════════════════════════════════
    // BACKWARD-COMPATIBLE FLAG SUBMISSION (v1 API)
    // ══════════════════════════════════════════════════════════════════════════

    /// Legacy entry-point kept for callers that still use the v1 interface.
    /// Internally it validates, stores a confirmation, and calls the reputation
    /// contract (same behaviour as before).
    pub fn submit_flag(
        env: Env,
        oracle: Address,
        player: Address,
        match_id: u64,
        severity: u32,
    ) -> Result<(), AntiCheatError> {
        oracle.require_auth();
        Self::require_oracle(&env, &oracle)?;
        Self::check_not_paused(&env)?;

        if severity == 0 || severity > 3 {
            return Err(AntiCheatError::InvalidSeverity);
        }

        let penalty: i128 = match severity {
            1 => PENALTY_LOW,
            2 => PENALTY_MEDIUM,
            3 => PENALTY_HIGH,
            _ => return Err(AntiCheatError::InvalidSeverity),
        };

        let timestamp = env.ledger().timestamp();
        let confirmation = AntiCheatConfirmation {
            player: player.clone(),
            match_id,
            severity,
            penalty_applied: penalty,
            timestamp,
            oracle: oracle.clone(),
            feed_id: 0,
            alert_id: 0,
        };
        env.storage().persistent().set(
            &DataKey::Confirmation(player.clone(), match_id),
            &confirmation,
        );

        // Call reputation contract if configured
        Self::apply_reputation_penalty(&env, &player, match_id, penalty);

        // Analytics
        let mut analytics = Self::get_analytics_totals(&env);
        analytics.total_confirmations += 1;
        analytics.last_updated = timestamp;
        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsTotals, &analytics);

        anticheat_events::emit_anticheat_flag(
            &env, &player, match_id, severity, penalty, &oracle, timestamp,
        );
        Ok(())
    }

    pub fn get_confirmation(
        env: Env,
        player: Address,
        match_id: u64,
    ) -> Option<AntiCheatConfirmation> {
        env.storage()
            .persistent()
            .get(&DataKey::Confirmation(player, match_id))
    }

    /// Alias kept for callers that used the old `add_authorized_oracle` name.
    pub fn add_authorized_oracle(env: Env, oracle: Address) -> Result<(), AntiCheatError> {
        Self::add_oracle(env, oracle)
    }

    /// Alias kept for callers that used the old `remove_authorized_oracle` name.
    pub fn remove_authorized_oracle(env: Env, oracle: Address) -> Result<(), AntiCheatError> {
        Self::remove_oracle(env, oracle)
    }

    /// Set the Reputation Index contract (admin only).
    pub fn set_reputation_contract(env: Env, reputation: Address) -> Result<(), AntiCheatError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::ReputationContract, &reputation);
        Ok(())
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DETECTION RULES
    // ══════════════════════════════════════════════════════════════════════════

    /// Add a new detection rule (admin only).
    pub fn add_rule(
        env: Env,
        rule_type: u32,
        feed_type: u32,
        description: String,
        threshold: i64,
        severity: u32,
    ) -> Result<u32, AntiCheatError> {
        Self::require_admin(&env)?;

        if rule_type > RULE_FREQ_ABUSE {
            return Err(AntiCheatError::InvalidRuleType);
        }
        if feed_type > FEED_TYPE_EXTERNAL {
            return Err(AntiCheatError::InvalidFeedType);
        }
        if severity > ALERT_CRITICAL {
            return Err(AntiCheatError::InvalidSeverity);
        }

        let rule_id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::RuleCounter)
            .unwrap_or(0)
            + 1;
        env.storage()
            .persistent()
            .set(&DataKey::RuleCounter, &rule_id);

        let rule = DetectionRule {
            rule_id,
            rule_type,
            feed_type,
            description,
            threshold,
            severity,
            enabled: true,
            created_at: env.ledger().timestamp(),
            trigger_count: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Rule(rule_id), &rule);

        let mut mon = Self::get_monitoring_state(&env);
        mon.active_rules += 1;
        env.storage()
            .persistent()
            .set(&DataKey::MonitoringState, &mon);

        events::emit_rule_added(&env, rule_id, rule_type, severity);
        Ok(rule_id)
    }

    /// Enable or disable a detection rule (admin only).
    pub fn set_rule_enabled(env: Env, rule_id: u32, enabled: bool) -> Result<(), AntiCheatError> {
        Self::require_admin(&env)?;
        let mut rule: DetectionRule = env
            .storage()
            .persistent()
            .get(&DataKey::Rule(rule_id))
            .ok_or(AntiCheatError::RuleNotFound)?;

        let was_enabled = rule.enabled;
        rule.enabled = enabled;
        env.storage()
            .persistent()
            .set(&DataKey::Rule(rule_id), &rule);

        let mut mon = Self::get_monitoring_state(&env);
        if was_enabled && !enabled {
            mon.active_rules = mon.active_rules.saturating_sub(1);
        } else if !was_enabled && enabled {
            mon.active_rules += 1;
        }
        env.storage()
            .persistent()
            .set(&DataKey::MonitoringState, &mon);
        Ok(())
    }

    pub fn get_rule(env: Env, rule_id: u32) -> Option<DetectionRule> {
        env.storage().persistent().get(&DataKey::Rule(rule_id))
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ALERT MANAGEMENT
    // ══════════════════════════════════════════════════════════════════════════

    /// Acknowledge an open alert (admin only).
    pub fn acknowledge_alert(env: Env, alert_id: u64) -> Result<(), AntiCheatError> {
        Self::require_admin(&env)?;
        let mut alert: AlertRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Alert(alert_id))
            .ok_or(AntiCheatError::AlertNotFound)?;

        if alert.status != ALERT_OPEN {
            return Err(AntiCheatError::AlertNotOpen);
        }
        alert.status = storage::ALERT_ACKNOWLEDGED;
        env.storage()
            .persistent()
            .set(&DataKey::Alert(alert_id), &alert);
        events::emit_alert_status_changed(&env, alert_id, storage::ALERT_ACKNOWLEDGED);
        Ok(())
    }

    /// Resolve an alert and optionally mark as false positive (admin only).
    pub fn resolve_alert(
        env: Env,
        alert_id: u64,
        false_positive: bool,
    ) -> Result<(), AntiCheatError> {
        Self::require_admin(&env)?;
        let mut alert: AlertRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Alert(alert_id))
            .ok_or(AntiCheatError::AlertNotFound)?;

        if alert.status == ALERT_RESOLVED || alert.status == storage::ALERT_FALSE_POSITIVE {
            return Err(AntiCheatError::AlertAlreadyClosed);
        }

        let now = env.ledger().timestamp();
        alert.status = if false_positive {
            storage::ALERT_FALSE_POSITIVE
        } else {
            ALERT_RESOLVED
        };
        alert.resolved_at = now;
        env.storage()
            .persistent()
            .set(&DataKey::Alert(alert_id), &alert);

        // Decrement open alert count for player
        let player_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::PlayerAlertCount(alert.player.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::PlayerAlertCount(alert.player.clone()),
            &player_count.saturating_sub(1),
        );

        // Update monitoring
        let mut mon = Self::get_monitoring_state(&env);
        mon.open_alerts = mon.open_alerts.saturating_sub(1);
        env.storage()
            .persistent()
            .set(&DataKey::MonitoringState, &mon);

        // Analytics
        let mut analytics = Self::get_analytics_totals(&env);
        analytics.total_alerts_resolved += 1;
        if false_positive {
            analytics.total_false_positives += 1;
            // Recalculate accuracy
            let total = analytics.total_alerts_raised.max(1);
            let fp = analytics.total_false_positives;
            analytics.detection_accuracy_bps = (((total - fp) * 10_000) / total) as u32;
        }
        analytics.last_updated = now;
        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsTotals, &analytics);

        events::emit_alert_status_changed(&env, alert_id, alert.status);

        // If not false-positive: finalise confirmation record
        if !false_positive {
            let confirmation = AntiCheatConfirmation {
                player: alert.player.clone(),
                match_id: alert.match_id,
                severity: alert.severity,
                penalty_applied: Self::severity_to_penalty(alert.severity),
                timestamp: now,
                oracle: alert.oracle.clone(),
                feed_id: alert.feed_id,
                alert_id,
            };
            env.storage().persistent().set(
                &DataKey::Confirmation(alert.player.clone(), alert.match_id),
                &confirmation,
            );
            Self::apply_reputation_penalty(
                &env,
                &alert.player,
                alert.match_id,
                confirmation.penalty_applied,
            );
        }

        Ok(())
    }

    pub fn get_alert(env: Env, alert_id: u64) -> Option<AlertRecord> {
        env.storage().persistent().get(&DataKey::Alert(alert_id))
    }

    pub fn get_player_open_alert_count(env: Env, player: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PlayerAlertCount(player))
            .unwrap_or(0)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GOVERNANCE
    // ══════════════════════════════════════════════════════════════════════════

    /// Create a governance proposal.  Any authorized oracle may propose.
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        proposal_type: u32,
        description: String,
        payload: Bytes,
    ) -> Result<u64, AntiCheatError> {
        proposer.require_auth();
        Self::require_oracle(&env, &proposer)?;
        Self::check_not_paused(&env)?;

        if proposal_type > PROPOSAL_TYPE_EMERGENCY_PAUSE {
            return Err(AntiCheatError::InvalidProposalType);
        }

        let proposal_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalCounter)
            .unwrap_or(0)
            + 1;
        env.storage()
            .persistent()
            .set(&DataKey::ProposalCounter, &proposal_id);

        let now = env.ledger().timestamp();
        let proposal = GovernanceProposal {
            proposal_id,
            proposal_type,
            proposer: proposer.clone(),
            description,
            payload,
            status: PROPOSAL_STATUS_ACTIVE,
            votes_for: 0,
            votes_against: 0,
            created_at: now,
            expires_at: now + PROPOSAL_TTL,
            executed_at: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        events::emit_proposal_created(&env, proposal_id, &proposer, proposal_type);
        Ok(proposal_id)
    }

    /// Vote on a governance proposal.  Each oracle may vote once.
    pub fn vote_proposal(
        env: Env,
        voter: Address,
        proposal_id: u64,
        approve: bool,
    ) -> Result<(), AntiCheatError> {
        voter.require_auth();
        Self::require_oracle(&env, &voter)?;

        let vote_key = DataKey::ProposalVote(proposal_id, voter.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(AntiCheatError::AlreadyVoted);
        }

        let mut proposal: GovernanceProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(AntiCheatError::ProposalNotFound)?;

        if proposal.status != PROPOSAL_STATUS_ACTIVE {
            return Err(AntiCheatError::ProposalNotActive);
        }
        let now = env.ledger().timestamp();
        if now > proposal.expires_at {
            proposal.status = PROPOSAL_STATUS_EXPIRED;
            env.storage()
                .persistent()
                .set(&DataKey::Proposal(proposal_id), &proposal);
            return Err(AntiCheatError::ProposalExpired);
        }

        env.storage().persistent().set(&vote_key, &approve);
        if approve {
            proposal.votes_for += 1;
        } else {
            proposal.votes_against += 1;
        }

        let quorum: u32 = env
            .storage()
            .instance()
            .get(&DataKey::GovernanceQuorum)
            .unwrap_or(DEFAULT_GOVERNANCE_QUORUM);

        if proposal.votes_for >= quorum {
            proposal.status = PROPOSAL_STATUS_PASSED;
        } else if proposal.votes_against >= quorum {
            proposal.status = PROPOSAL_STATUS_REJECTED;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        events::emit_proposal_voted(&env, proposal_id, &voter, approve, proposal.votes_for);
        Ok(())
    }

    /// Execute a passed proposal (admin only).
    pub fn execute_proposal(env: Env, proposal_id: u64) -> Result<(), AntiCheatError> {
        Self::require_admin(&env)?;

        let mut proposal: GovernanceProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(AntiCheatError::ProposalNotFound)?;

        if proposal.status != PROPOSAL_STATUS_PASSED {
            return Err(AntiCheatError::QuorumNotReached);
        }

        // Execute the proposal action
        match proposal.proposal_type {
            PROPOSAL_TYPE_EMERGENCY_PAUSE => {
                env.storage()
                    .instance()
                    .set(&DataKey::EmergencyPaused, &true);
            }
            // payload encodes the new quorum as little-endian u32 (4 bytes)
            PROPOSAL_TYPE_UPDATE_QUORUM if proposal.payload.len() >= 4 => {
                let b0 = proposal.payload.get(0).unwrap_or(0) as u32;
                let b1 = proposal.payload.get(1).unwrap_or(0) as u32;
                let b2 = proposal.payload.get(2).unwrap_or(0) as u32;
                let b3 = proposal.payload.get(3).unwrap_or(0) as u32;
                let new_quorum = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
                if new_quorum > 0 {
                    env.storage()
                        .instance()
                        .set(&DataKey::GovernanceQuorum, &new_quorum);
                }
            }
            // ADD/REMOVE_ORACLE and UPDATE_RULE require admin to follow up with
            // the specific management call; the proposal just records intent.
            _ => {}
        }

        let now = env.ledger().timestamp();
        proposal.status = PROPOSAL_STATUS_EXECUTED;
        proposal.executed_at = now;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        events::emit_proposal_executed(&env, proposal_id);
        Ok(())
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<GovernanceProposal> {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ══════════════════════════════════════════════════════════════════════════

    /// Update oracle config (admin only).
    pub fn update_config(env: Env, new_cfg: OracleConfig) -> Result<(), AntiCheatError> {
        Self::require_admin(&env)?;
        if new_cfg.min_submit_interval == 0 {
            return Err(AntiCheatError::InvalidThreshold);
        }
        env.storage()
            .instance()
            .set(&DataKey::OracleConfig, &new_cfg);
        events::emit_config_updated(&env);
        Ok(())
    }

    pub fn get_config(env: Env) -> Option<OracleConfig> {
        env.storage().instance().get(&DataKey::OracleConfig)
    }

    /// Toggle emergency pause (admin only).
    pub fn set_emergency_pause(env: Env, paused: bool) -> Result<(), AntiCheatError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::EmergencyPaused, &paused);
        events::emit_emergency_pause_toggled(&env, paused);
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::EmergencyPaused)
            .unwrap_or(false)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ANALYTICS
    // ══════════════════════════════════════════════════════════════════════════

    pub fn get_analytics(env: Env) -> AnalyticsTotals {
        Self::get_analytics_totals(&env)
    }

    pub fn get_oracle_submission_count(env: Env, oracle: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::OracleSubmitCount(oracle))
            .unwrap_or(0)
    }

    pub fn get_feed_reading_count(env: Env, feed_id: u32) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::FeedReadingCount(feed_id))
            .unwrap_or(0)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MONITORING
    // ══════════════════════════════════════════════════════════════════════════

    pub fn get_monitoring_snapshot(env: Env) -> MonitoringState {
        Self::get_monitoring_state(&env)
    }

    pub fn get_last_heartbeat(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::LastHeartbeat)
            .unwrap_or(0)
    }

    /// Emit a monitoring snapshot event and refresh the stored state.
    pub fn emit_monitoring_snapshot(env: Env) -> Result<(), AntiCheatError> {
        let mut mon = Self::get_monitoring_state(&env);
        mon.last_snapshot = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::MonitoringState, &mon);

        let analytics = Self::get_analytics_totals(&env);
        events::emit_monitoring_snapshot(
            &env,
            mon.active_feeds,
            mon.active_oracles,
            mon.open_alerts,
            analytics.total_feed_readings,
            analytics.total_alerts_raised,
        );
        Ok(())
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRIVATE HELPERS
    // ══════════════════════════════════════════════════════════════════════════

    fn require_admin(env: &Env) -> Result<(), AntiCheatError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AntiCheatError::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }

    fn require_oracle(env: &Env, oracle: &Address) -> Result<(), AntiCheatError> {
        let authorized: bool = env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::AuthorizedOracle(oracle.clone()))
            .unwrap_or(false);
        if !authorized {
            return Err(AntiCheatError::OracleNotAuthorized);
        }
        Ok(())
    }

    fn check_not_paused(env: &Env) -> Result<(), AntiCheatError> {
        let paused: bool = env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::EmergencyPaused)
            .unwrap_or(false);
        if paused {
            return Err(AntiCheatError::EmergencyPaused);
        }
        Ok(())
    }

    fn get_analytics_totals(env: &Env) -> AnalyticsTotals {
        env.storage()
            .persistent()
            .get(&DataKey::AnalyticsTotals)
            .unwrap_or(AnalyticsTotals {
                total_feed_readings: 0,
                total_alerts_raised: 0,
                total_alerts_resolved: 0,
                total_false_positives: 0,
                total_confirmations: 0,
                total_rules_triggered: 0,
                detection_accuracy_bps: 10_000,
                avg_confirmation_delay: 0,
                last_updated: 0,
            })
    }

    fn get_monitoring_state(env: &Env) -> MonitoringState {
        env.storage()
            .persistent()
            .get(&DataKey::MonitoringState)
            .unwrap_or(MonitoringState {
                active_feeds: 0,
                active_oracles: 0,
                open_alerts: 0,
                active_rules: 0,
                last_snapshot: 0,
            })
    }

    fn severity_to_penalty(severity: u32) -> i128 {
        match severity {
            ALERT_INFO => PENALTY_LOW,
            ALERT_WARNING => PENALTY_MEDIUM,
            ALERT_CRITICAL => PENALTY_HIGH,
            _ => PENALTY_LOW,
        }
    }

    /// Compute an anomaly score (0-100) for a new reading by comparing it
    /// to the previous reading on the same feed.
    fn compute_anomaly_score(env: &Env, feed_id: u32, value: i64, _feed: &DataFeed) -> u32 {
        let seq: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::FeedReadingSeq(feed_id))
            .unwrap_or(0);
        if seq == 0 {
            return 0;
        }
        let prev: Option<FeedReading> = env
            .storage()
            .persistent()
            .get(&DataKey::FeedReading(feed_id, seq));
        match prev {
            None => 0,
            Some(p) => {
                let delta = (value - p.value).unsigned_abs() as u32;
                // Score = delta / 10, capped at 100
                (delta / 10).min(100)
            }
        }
    }

    /// Run all enabled detection rules against a freshly submitted reading.
    fn run_detection_engine(env: &Env, reading: &FeedReading, feed: &DataFeed) {
        let rule_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::RuleCounter)
            .unwrap_or(0);

        for rule_id in 1..=rule_count {
            let rule: DetectionRule = match env.storage().persistent().get(&DataKey::Rule(rule_id))
            {
                Some(r) => r,
                None => continue,
            };
            if !rule.enabled {
                continue;
            }
            // Only apply rules that match this feed's type
            if rule.feed_type != feed.feed_type {
                continue;
            }

            let triggered = match rule.rule_type {
                RULE_SCORE_SPIKE => reading.value.abs() > rule.threshold,
                RULE_VELOCITY => reading.anomaly_score as i64 > rule.threshold,
                RULE_ANOMALY_ML => reading.anomaly_score as i64 > rule.threshold,
                RULE_STALENESS => {
                    let age = env.ledger().timestamp().saturating_sub(feed.last_updated);
                    age as i64 > rule.threshold
                }
                RULE_FREQ_ABUSE => {
                    // Check submissions-per-minute from this oracle
                    let count: u64 = env
                        .storage()
                        .persistent()
                        .get(&DataKey::OracleSubmitCount(reading.oracle.clone()))
                        .unwrap_or(0);
                    count as i64 > rule.threshold * 60
                }
                RULE_CONSENSUS => {
                    reading.confidence < 50 && reading.anomaly_score as i64 > rule.threshold
                }
                _ => false,
            };

            if triggered {
                Self::raise_alert(env, &rule, reading);
            }
        }
    }

    /// Create and store an alert record.
    fn raise_alert(env: &Env, rule: &DetectionRule, reading: &FeedReading) {
        let alert_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::AlertCounter)
            .unwrap_or(0)
            + 1;
        env.storage()
            .persistent()
            .set(&DataKey::AlertCounter, &alert_id);

        let alert = AlertRecord {
            alert_id,
            rule_id: rule.rule_id,
            feed_id: reading.feed_id,
            player: reading.player.clone(),
            match_id: reading.match_id,
            severity: rule.severity,
            status: ALERT_OPEN,
            triggered_at: env.ledger().timestamp(),
            resolved_at: 0,
            oracle: reading.oracle.clone(),
            value: reading.value,
            threshold: rule.threshold,
            details: rule.description.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Alert(alert_id), &alert);

        // Per-player open alert counter
        let player_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::PlayerAlertCount(reading.player.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::PlayerAlertCount(reading.player.clone()),
            &(player_count + 1),
        );

        // Monitoring
        let mut mon: MonitoringState = env
            .storage()
            .persistent()
            .get(&DataKey::MonitoringState)
            .unwrap_or(MonitoringState {
                active_feeds: 0,
                active_oracles: 0,
                open_alerts: 0,
                active_rules: 0,
                last_snapshot: 0,
            });
        mon.open_alerts += 1;
        env.storage()
            .persistent()
            .set(&DataKey::MonitoringState, &mon);

        // Analytics
        let mut analytics: AnalyticsTotals = env
            .storage()
            .persistent()
            .get(&DataKey::AnalyticsTotals)
            .unwrap_or(AnalyticsTotals {
                total_feed_readings: 0,
                total_alerts_raised: 0,
                total_alerts_resolved: 0,
                total_false_positives: 0,
                total_confirmations: 0,
                total_rules_triggered: 0,
                detection_accuracy_bps: 10_000,
                avg_confirmation_delay: 0,
                last_updated: 0,
            });
        analytics.total_alerts_raised += 1;
        analytics.total_rules_triggered += 1;
        analytics.last_updated = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsTotals, &analytics);

        // Update rule trigger count
        let mut updated_rule = rule.clone();
        updated_rule.trigger_count += 1;
        env.storage()
            .persistent()
            .set(&DataKey::Rule(rule.rule_id), &updated_rule);

        events::emit_alert_raised(
            env,
            alert_id,
            rule.rule_id,
            &reading.player,
            reading.match_id,
            rule.severity,
            reading.value,
        );
    }

    /// Call the reputation contract to apply a penalty (best-effort — no panic on missing).
    fn apply_reputation_penalty(env: &Env, player: &Address, match_id: u64, penalty: i128) {
        use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
        use soroban_sdk::{IntoVal, Symbol};

        if let Some(reputation_addr) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::ReputationContract)
        {
            let mut args = Vec::new(env);
            args.push_back(env.current_contract_address().into_val(env));
            args.push_back(player.clone().into_val(env));
            args.push_back(match_id.into_val(env));
            args.push_back(penalty.into_val(env));
            let context = ContractContext {
                contract: reputation_addr.clone(),
                fn_name: Symbol::new(env, "apply_anticheat_penalty"),
                args,
            };
            let sub_invocations: Vec<InvokerContractAuthEntry> = Vec::new(env);
            let mut auth_entries = Vec::new(env);
            auth_entries.push_back(InvokerContractAuthEntry::Contract(SubContractInvocation {
                context,
                sub_invocations,
            }));
            env.authorize_as_current_contract(auth_entries);
            let call_args = (
                env.current_contract_address(),
                player.clone(),
                match_id,
                penalty,
            )
                .into_val(env);
            let _: () = env.invoke_contract(
                &reputation_addr,
                &Symbol::new(env, "apply_anticheat_penalty"),
                call_args,
            );
        }
    }

    /// Seed five default detection rules on first initialization.
    fn seed_default_rules(env: &Env) {
        let rules: [(u32, u32, &str, i64, u32); 5] = [
            (
                RULE_SCORE_SPIKE,
                FEED_TYPE_SCORE,
                "Score spike detected",
                SCORE_SPIKE_DEFAULT_THRESHOLD,
                ALERT_WARNING,
            ),
            (
                RULE_VELOCITY,
                FEED_TYPE_TELEMETRY,
                "Velocity anomaly detected",
                VELOCITY_DEFAULT_THRESHOLD,
                ALERT_WARNING,
            ),
            (
                RULE_ANOMALY_ML,
                FEED_TYPE_BEHAVIOR,
                "ML anomaly score exceeded",
                ANOMALY_ML_DEFAULT_THRESHOLD,
                ALERT_CRITICAL,
            ),
            (
                RULE_STALENESS,
                FEED_TYPE_SCORE,
                "Feed staleness threshold",
                STALENESS_DEFAULT_THRESHOLD,
                ALERT_INFO,
            ),
            (
                RULE_FREQ_ABUSE,
                FEED_TYPE_EXTERNAL,
                "Oracle frequency abuse",
                FREQ_ABUSE_DEFAULT_THRESHOLD,
                ALERT_WARNING,
            ),
        ];

        let mut rule_id: u32 = 0;
        for (rule_type, feed_type, desc, threshold, severity) in rules.iter() {
            rule_id += 1;
            let rule = DetectionRule {
                rule_id,
                rule_type: *rule_type,
                feed_type: *feed_type,
                description: String::from_str(env, desc),
                threshold: *threshold,
                severity: *severity,
                enabled: true,
                created_at: env.ledger().timestamp(),
                trigger_count: 0,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Rule(rule_id), &rule);
        }
        env.storage()
            .persistent()
            .set(&DataKey::RuleCounter, &rule_id);

        let mon = MonitoringState {
            active_feeds: 0,
            active_oracles: 0,
            open_alerts: 0,
            active_rules: rule_id,
            last_snapshot: env.ledger().timestamp(),
        };
        // Note: written again in initialize after this, so we only patch active_rules
        let existing: Option<MonitoringState> =
            env.storage().persistent().get(&DataKey::MonitoringState);
        if let Some(mut m) = existing {
            m.active_rules = rule_id;
            env.storage()
                .persistent()
                .set(&DataKey::MonitoringState, &m);
        } else {
            env.storage()
                .persistent()
                .set(&DataKey::MonitoringState, &mon);
        }
        let _ = mon.active_rules; // suppress unused warning
    }
}

#[cfg(test)]
mod test;
