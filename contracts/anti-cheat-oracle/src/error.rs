use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AntiCheatError {
    // ── Initialization ──────────────────────────────────────────────────────
    AlreadyInitialized = 1,
    NotInitialized = 2,

    // ── Authorization ───────────────────────────────────────────────────────
    Unauthorized = 3,
    /// Caller is not a registered oracle.
    OracleNotAuthorized = 4,
    /// Admin-only operation called by non-admin.
    AdminOnly = 5,

    // ── Feed management ─────────────────────────────────────────────────────
    FeedNotFound = 6,
    FeedAlreadyExists = 7,
    FeedNotActive = 8,
    /// Submitted value is outside the feed's [min_value, max_value] range.
    FeedValueOutOfRange = 9,
    /// Oracle is submitting too frequently (below min_submit_interval).
    SubmitRateLimited = 10,
    /// Feed has been revoked and cannot accept new readings.
    FeedRevoked = 11,

    // ── Detection rules ─────────────────────────────────────────────────────
    RuleNotFound = 12,
    RuleAlreadyExists = 13,
    InvalidRuleType = 14,
    InvalidThreshold = 15,

    // ── Alerts ──────────────────────────────────────────────────────────────
    AlertNotFound = 16,
    AlertAlreadyClosed = 17,
    AlertNotOpen = 18,

    // ── Oracle config / validation ──────────────────────────────────────────
    InvalidSeverity = 19,
    /// confidence value outside 0-100.
    InvalidConfidence = 20,
    InvalidFeedType = 21,
    InvalidOracleState = 22,
    /// Consensus check: too few oracles agree on the submitted value.
    ConsensusFailed = 23,
    /// Reading is too old relative to current ledger time.
    StaleReading = 24,

    // ── Governance ──────────────────────────────────────────────────────────
    ProposalNotFound = 25,
    ProposalNotActive = 26,
    ProposalExpired = 27,
    AlreadyVoted = 28,
    QuorumNotReached = 29,
    InvalidProposalType = 30,

    // ── System ──────────────────────────────────────────────────────────────
    EmergencyPaused = 31,
    ReputationNotSet = 32,
    ArithmeticOverflow = 33,
}
