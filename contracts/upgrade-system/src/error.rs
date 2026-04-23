use soroban_sdk::contracterror;

/// Error codes for the upgrade system
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum UpgradeError {
    // Initialization errors
    AlreadyInitialized = 1,
    NotInitialized = 2,

    // Authorization errors
    Unauthorized = 10,
    NotGovernance = 11,
    InsufficientApprovals = 12,
    AlreadyApproved = 13,

    // Proposal errors
    ProposalNotFound = 20,
    ProposalAlreadyExists = 21,
    ProposalNotValidated = 22,
    ProposalNotScheduled = 23,
    ProposalAlreadyExecuted = 24,
    ProposalCancelled = 25,
    ProposalFailed = 26,

    // Validation errors
    ValidationFailed = 30,
    BreakingChangesDetected = 31,
    SecurityIssuesFound = 32,
    IncompatibleUpgrade = 33,
    SimulationFailed = 34,
    SimulationRequired = 35,

    // Timelock errors
    TimelockNotExpired = 40,
    TimelockTooShort = 41,
    TimelockTooLong = 42,

    // Contract errors
    ContractNotFound = 50,
    ContractPaused = 51,
    InvalidWasmHash = 52,
    NoRollbackAvailable = 53,

    // Emergency errors
    SystemPaused = 60,
    EmergencyPauseActive = 61,
    NotEmergencyMultisig = 62,

    // General errors
    InvalidInput = 70,
    InvalidStatus = 71,
    OperationFailed = 72,
}
