use soroban_sdk::{contracttype, Address};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    AuthorizedResolver(Address),
    PlayerReputation(Address),
    Config,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerReputation {
    pub player: Address,
    pub wins: u32,
    pub losses: u32,
    pub draws: u32,
    pub matches_played: u32,
    pub score: i128,
    pub last_updated: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationConfig {
    pub win_weight: i128,
    pub loss_weight: i128,
    pub draw_weight: i128,
    pub base_score: i128,
    pub decay_factor: i128, // For future decay implementation
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum MatchOutcome {
    Win = 0,
    Loss = 1,
    Draw = 2,
}
