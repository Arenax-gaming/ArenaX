use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PlayerReputationError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    PlayerNotFound = 4,
    AchievementAlreadyUnlocked = 5,
    InvalidRating = 6,
    SelfReview = 7,
    DuplicateReview = 8,
    InvalidActionType = 9,
    ScoreBelowMinimum = 10,
    InvalidImpact = 11,
}
