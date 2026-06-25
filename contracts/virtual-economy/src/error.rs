use soroban_sdk::{contracterror, contracttype};

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
}
