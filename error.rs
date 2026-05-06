use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    GameNotFound = 4,
    InvalidStatus = 5,
    InvalidPlayers = 6,
    ActionValidationFailed = 7,
    ContractPaused = 8,
}