use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    InsufficientBalance = 1,
    InsufficientAllowance = 2,
    InvalidAmount = 3,
    Overflow = 4,
    NotAuthorized = 5,
    AlreadyInitialized = 6,
    InvalidExpirationLedger = 7,
    AdminNotSet = 8,
    InvalidDecimals = 9,
    NotInitialized = 10,
    AllowanceExpired = 11,
}
