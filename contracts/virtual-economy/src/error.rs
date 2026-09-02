use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VirtualEconomyError {
    // General errors
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    EmergencyPaused = 4,
    /// An arithmetic operation would overflow.
    Overflow = 5,
    /// The provided address is invalid (e.g. the contract's own address).
    InvalidAddress = 6,

    // Currency errors
    InvalidAmount = 10,
    InsufficientBalance = 11,
    SupplyLimitExceeded = 12,

    // NFT errors
    TokenNotFound = 20,
    TokenAlreadyExists = 21,
    NotOwner = 22,

    // Marketplace errors
    InvalidPrice = 30,
    OrderNotFound = 31,
    OrderNotActive = 32,
    OrderExpired = 33,

    // Validation errors
    InvalidMetadata = 40,
    InvalidConfig = 41,

    // Royalty & Licensing errors (merged with InvalidConfig to stay within 50-case XDR limit)
    RoyaltyTooHigh = 50,

    // Dynamic pricing errors
    AuctionNotFound = 60,
    AuctionNotActive = 61,
    AuctionEnded = 62,
    InvalidAuctionParams = 63,

    DropNotFound = 70,
    DropInactive = 71,
    DropSupplyExceeded = 72,
    InvalidCurveParams = 73,

    // Price oracle errors
    OracleNotConfigured = 80,
    InvalidOracleConfig = 81,
    OraclePriceStale = 82,
    OraclePriceVarianceTooHigh = 83,
    OracleUpdateTooFrequent = 84,
    InvalidAssetPair = 85,
    OracleInvalidPrice = 86,

    // NFT staking errors
    NftStakingNotConfigured = 90,
    NftAlreadyStaked = 91,
    NftNotStaked = 92,
    NftLockPeriodNotMet = 93,
    NftStakingPaused = 94,

    // Liquidity pool / AMM
    PoolNotFound = 100,
    PoolAlreadyExists = 101,
    InsufficientLiquidity = 102,
    SlippageExceeded = 103,
    InvariantViolation = 104,

    // Referral errors
    ReferralNotConfigured = 110,
    ReferralNotFound = 111,
    ReferralAlreadyRegistered = 112,
    InvalidReferral = 113,
    ReferralCooldown = 114,
    NothingToClaim = 115,
}
