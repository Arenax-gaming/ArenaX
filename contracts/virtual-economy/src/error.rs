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

    // Royalty & Licensing errors
    RoyaltyTooHigh = 50,
    CreatorNotFound = 51,
    LicenseViolation = 52,
    InvalidLicenseType = 53,

    // Dynamic pricing errors
    AuctionNotFound = 60,
    AuctionNotActive = 61,
    AuctionNotStarted = 62,
    AuctionEnded = 63,
    InvalidAuctionParams = 64,

    DropNotFound = 70,
    DropInactive = 71,
    DropSupplyExceeded = 72,
    InvalidCurveParams = 73,

    // Price oracle errors
    /// An oracle address has not been registered on the contract.
    OracleNotConfigured = 80,
    /// The oracle configuration values failed validation.
    InvalidOracleConfig = 81,
    /// Both the primary and fallback oracles returned stale data.
    OraclePriceStale = 82,
    /// The incoming price deviates from the last accepted price by more than
    /// `max_variance_bps` and no valid fallback is available.
    OraclePriceVarianceTooHigh = 83,
    /// An update was attempted before `update_interval` seconds have elapsed.
    OracleUpdateTooFrequent = 84,
    /// The asset-pair identifier provided to the oracle is invalid.
    InvalidAssetPair = 85,
    /// The price submitted to the oracle is not positive.
    OracleInvalidPrice = 86,

    // NFT staking errors
    /// NFT staking has not been configured yet.
    NftStakingNotConfigured = 110,
    /// The NFT is already staked.
    NftAlreadyStaked = 111,
    /// The NFT is not currently staked.
    NftNotStaked = 112,
    /// The minimum lock period has not been met yet.
    NftLockPeriodNotMet = 113,
    /// NFT staking is currently paused.
    NftStakingPaused = 114,

    // ---- Liquidity pool / AMM (Issue #882) ----
    /// No liquidity pool has been created yet.
    PoolNotFound = 120,
    /// A liquidity pool already exists; there is only ever one.
    PoolAlreadyExists = 121,
    /// The pool holds too little liquidity to satisfy this operation.
    InsufficientLiquidity = 122,
    /// The result fell outside the caller's slippage tolerance.
    SlippageExceeded = 123,
    /// The constant-product invariant would have been violated. This should be
    /// unreachable; it is checked rather than assumed because a path that
    /// shrinks `k` drains the pool.
    InvariantViolation = 124,
}
