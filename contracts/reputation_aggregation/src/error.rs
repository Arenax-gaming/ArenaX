use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReputationError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    PlayerNotFound = 4,
    InvalidMatchOutcome = 5,
    DuplicateMatchSubmission = 6,
    ArithmeticOverflow = 7,
    InvalidPlayerAddress = 8,
}