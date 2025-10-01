use soroban_sdk::contracttype;
use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
// #[contracttype]
pub enum Error {
    Unauthorized = 1,
    ContractPaused = 2,
    InvalidParameter = 3,
    PrizePoolNotFound = 4,
    PrizePoolAlreadyExists = 5,
    InvalidPrizePoolStatus = 6,
    InsufficientFunds = 7,
    ParticipantNotFound = 8,
    AlreadyParticipated = 9,
    InvalidEntryFee = 10,
    MaxParticipantsReached = 11,
    NoWinners = 12,
    InvalidWinnerList = 13,
    DistributionFailed = 14,
    RefundNotAllowed = 15,
    RefundFailed = 16,
    InvalidDistributionRules = 17,
    MinParticipantsNotMet = 18,
}
