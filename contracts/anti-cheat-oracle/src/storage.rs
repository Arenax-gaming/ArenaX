use soroban_sdk::{contracttype, Address, String, Vec};

// ─── Feed / Oracle configuration ─────────────────────────────────────────────

/// Feed types the oracle supports.
pub const FEED_TYPE_SCORE: u32 = 0;       // Raw match score data
pub const FEED_TYPE_TELEMETRY: u32 = 1;   // In-game telemetry stream
pub const FEED_TYPE_BEHAVIOR: u32 = 2;    // Player behavior metrics
pub const FEED_TYPE_NETWORK: u32 = 3;     // Network / latency metrics
pub const FEED_TYPE_EXTERNAL: u32 = 4;    // Third-party oracle feed

/// Status of an individual data feed.
pub const FEED_STATUS_ACTIVE: u32 = 0;
pub const FEED_STATUS_PAUSED: u32 = 1;
pub const FEED_STATUS_REVOKED: u32 = 2;

/// Oracle node health states.
pub const ORACLE_HEALTHY: u32 = 0;
pub const ORACLE_DEGRADED: u32 = 1;
pub const ORACLE_OFFLINE: u32 = 2;

// ─── Detection rule / alert constants ────────────────────────────────────────

/// Detection rule types (what pattern each rule targets).
pub const RULE_SCORE_SPIKE: u32 = 0;      // Score value outside normal range
pub const RULE_VELOCITY: u32 = 1;         // Change rate too high / too low
pub const RULE_CONSENSUS: u32 = 2;        // Oracles disagree beyond threshold
pub const RULE_STALENESS: u32 = 3;        // Feed has not updated recently
pub const RULE_ANOMALY_ML: u32 = 4;       // ML anomaly score exceeds threshold
pub const RULE_FREQ_ABUSE: u32 = 5;       // Oracle posting far too frequently

/// Alert severity levels.
pub const ALERT_INFO: u32 = 0;
pub const ALERT_WARNING: u32 = 1;
pub const ALERT_CRITICAL: u32 = 2;

/// Alert resolution states.
pub const ALERT_OPEN: u32 = 0;
pub const ALERT_ACKNOWLEDGED: u32 = 1;
pub const ALERT_RESOLVED: u32 = 2;
pub const ALERT_FALSE_POSITIVE: u32 = 3;

// ─── Governance constants ─────────────────────────────────────────────────────

pub const PROPOSAL_STATUS_ACTIVE: u32 = 0;
pub const PROPOSAL_STATUS_PASSED: u32 = 1;
pub const PROPOSAL_STATUS_REJECTED: u32 = 2;
pub const PROPOSAL_STATUS_EXECUTED: u32 = 3;
pub const PROPOSAL_STATUS_EXPIRED: u32 = 4;

pub const PROPOSAL_TYPE_ADD_ORACLE: u32 = 0;
pub const PROPOSAL_TYPE_REMOVE_ORACLE: u32 = 1;
pub const PROPOSAL_TYPE_UPDATE_RULE: u32 = 2;
pub const PROPOSAL_TYPE_UPDATE_QUORUM: u32 = 3;
pub const PROPOSAL_TYPE_EMERGENCY_PAUSE: u32 = 4;

// ─── Storage key enum ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    // Instance (config, infrequently changed)
    Admin,
    ReputationContract,
    OracleConfig,
    GovernanceQuorum,          // u32 — votes needed to pass a proposal
    EmergencyPaused,           // bool

    // Per-oracle (instance)
    AuthorizedOracle(Address), // bool
    OracleHealth(Address),     // OracleHealth

    // Per-feed (persistent)
    Feed(u32),                 // u32 feed_id → DataFeed
    FeedCounter,               // u32 — next feed ID
    FeedReading(u32, u32),     // (feed_id, seq) → FeedReading
    FeedReadingSeq(u32),       // u32 — next sequence for a feed

    // Detection rules (persistent)
    Rule(u32),                 // u32 rule_id → DetectionRule
    RuleCounter,               // u32

    // Alerts (persistent)
    Alert(u64),                // u64 alert_id → AlertRecord
    AlertCounter,              // u64
    PlayerAlertCount(Address), // u32 — total open alerts for a player

    // Confirmations (persistent) — backward-compatible
    Confirmation(Address, u64), // (player, match_id) → AntiCheatConfirmation

    // Analytics (persistent)
    AnalyticsTotals,           // AnalyticsTotals
    OracleSubmitCount(Address),// u64 — submissions per oracle
    FeedReadingCount(u32),     // u64 — total readings for a feed

    // Governance proposals (persistent)
    Proposal(u64),             // u64 proposal_id → GovernanceProposal
    ProposalCounter,           // u64
    ProposalVote(u64, Address),// (proposal_id, voter) → bool

    // Monitoring (persistent)
    MonitoringState,           // MonitoringState
    LastHeartbeat,             // u64 timestamp
}

// ─── Structs ─────────────────────────────────────────────────────────────────

/// Global oracle configuration stored in instance storage.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleConfig {
    /// Minimum number of oracle confirmations before a detection is finalised.
    pub min_confirmations: u32,
    /// Maximum age (seconds) of a feed reading before it is considered stale.
    pub max_staleness_secs: u64,
    /// Maximum deviation (basis points, 1/100 of 1%) between oracle readings
    /// before a consensus-failure alert is raised.
    pub consensus_threshold_bps: u32,
    /// Minimum interval (seconds) between consecutive submissions from one oracle.
    pub min_submit_interval: u64,
    /// Maximum readings kept per feed (ring-buffer size).
    pub max_readings_per_feed: u32,
}

/// A registered data feed.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataFeed {
    pub feed_id: u32,
    pub feed_type: u32,        // FEED_TYPE_*
    pub description: String,
    pub owner: Address,        // Oracle address that owns / manages this feed
    pub status: u32,           // FEED_STATUS_*
    pub created_at: u64,
    pub last_updated: u64,
    pub total_readings: u64,
    /// Acceptable value range. Both are signed to allow negative deltas.
    pub min_value: i64,
    pub max_value: i64,
}

/// A single reading submitted to a data feed.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeedReading {
    pub feed_id: u32,
    pub seq: u32,              // Monotonically increasing per feed
    pub oracle: Address,       // Submitting oracle
    pub value: i64,            // The data point
    pub confidence: u32,       // Oracle-reported confidence 0-100
    pub player: Address,       // Player the reading relates to
    pub match_id: u64,
    pub timestamp: u64,
    pub anomaly_score: u32,    // 0-100 computed on submission
}

/// A real-time cheat detection rule.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DetectionRule {
    pub rule_id: u32,
    pub rule_type: u32,        // RULE_*
    pub feed_type: u32,        // Which FEED_TYPE this rule monitors
    pub description: String,
    pub threshold: i64,        // Rule-specific threshold value
    pub severity: u32,         // ALERT_INFO / WARNING / CRITICAL
    pub enabled: bool,
    pub created_at: u64,
    pub trigger_count: u64,    // Total times this rule has fired
}

/// An alert raised by the detection engine.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AlertRecord {
    pub alert_id: u64,
    pub rule_id: u32,
    pub feed_id: u32,
    pub player: Address,
    pub match_id: u64,
    pub severity: u32,         // ALERT_*
    pub status: u32,           // ALERT_OPEN / ACKNOWLEDGED / RESOLVED / FALSE_POSITIVE
    pub triggered_at: u64,
    pub resolved_at: u64,      // 0 if still open
    pub oracle: Address,       // Oracle whose reading triggered this
    pub value: i64,            // The offending value
    pub threshold: i64,        // The rule threshold that was breached
    pub details: String,
}

/// Aggregate analytics counters.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AnalyticsTotals {
    pub total_feed_readings: u64,
    pub total_alerts_raised: u64,
    pub total_alerts_resolved: u64,
    pub total_false_positives: u64,
    pub total_confirmations: u64,
    pub total_rules_triggered: u64,
    pub detection_accuracy_bps: u32, // basis points (10000 = 100%)
    pub avg_confirmation_delay: u64, // seconds
    pub last_updated: u64,
}

/// A governance proposal for oracle parameter changes.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovernanceProposal {
    pub proposal_id: u64,
    pub proposal_type: u32,    // PROPOSAL_TYPE_*
    pub proposer: Address,
    pub description: String,
    /// ABI-encoded payload specific to the proposal type.
    pub payload: soroban_sdk::Bytes,
    pub status: u32,           // PROPOSAL_STATUS_*
    pub votes_for: u32,
    pub votes_against: u32,
    pub created_at: u64,
    pub expires_at: u64,
    pub executed_at: u64,      // 0 until executed
}

/// Per-oracle health record (instance storage).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleHealth {
    pub oracle: Address,
    pub state: u32,            // ORACLE_HEALTHY / DEGRADED / OFFLINE
    pub total_submissions: u64,
    pub valid_submissions: u64,
    pub last_submission: u64,
    pub consecutive_errors: u32,
    pub uptime_score: u32,     // 0-100
}

/// Monitoring state snapshot.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MonitoringState {
    pub active_feeds: u32,
    pub active_oracles: u32,
    pub open_alerts: u32,
    pub active_rules: u32,
    pub last_snapshot: u64,
}

/// Backward-compatible confirmation record (kept from v1).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AntiCheatConfirmation {
    pub player: Address,
    pub match_id: u64,
    pub severity: u32,
    pub penalty_applied: i128,
    pub timestamp: u64,
    pub oracle: Address,
    /// New in v2: feed ID that produced the reading, 0 = legacy.
    pub feed_id: u32,
    /// New in v2: alert ID that triggered this confirmation, 0 = legacy.
    pub alert_id: u64,
}
