use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RngError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    RequestNotFound = 4,
    RequestAlreadyFulfilled = 5,
    InvalidCommitment = 6,
    InvalidProof = 7,
    CommitmentWindowExpired = 8,
    InvalidState = 9,
    SeedGenerationFailed = 10,
}