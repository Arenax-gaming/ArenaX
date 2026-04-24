use soroban_sdk::{contracttype, Address};

/// Storage keys for all contract data
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    AuthorizedUpdater(Address),
    PlayerProfile(Address),
    Achievement(Address, u32),             // (player, achievement_id)
    SportsmanshipReview(Address, Address), // (player, reviewer)
    PrivacySettings(Address),
    Config,
}

/// Multi-dimensional reputation profile for a player
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerProfile {
    pub player: Address,
    /// Composite reputation score (weighted sum of all dimensions)
    pub reputation_score: i128,
    /// ELO-style skill rating
    pub skill_rating: i128,
    /// Sportsmanship score (0–100)
    pub sportsmanship_score: i128,
    /// Number of sportsmanship reviews received
    pub review_count: u32,
    /// Sum of all sportsmanship ratings (for average calculation)
    pub review_total: u32,
    /// Bitmask of unlocked achievement IDs (up to 64 achievements)
    pub achievements_bitmask: u64,
    /// Total achievements unlocked
    pub achievement_count: u32,
    /// Wins, losses, draws for skill calculation
    pub wins: u32,
    pub losses: u32,
    pub draws: u32,
    /// Timestamp of last activity (for decay)
    pub last_active_ts: u64,
    /// Whether this player's detailed stats are private
    pub is_private: bool,
}

impl PlayerProfile {
    pub fn new_default(player: Address, base_score: i128, base_skill: i128, ts: u64) -> Self {
        PlayerProfile {
            player,
            reputation_score: base_score,
            skill_rating: base_skill,
            sportsmanship_score: 50,
            review_count: 0,
            review_total: 0,
            achievements_bitmask: 0,
            achievement_count: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            last_active_ts: ts,
            is_private: false,
        }
    }
}

/// Contract-wide configuration
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationConfig {
    /// Starting reputation score for new players
    pub base_score: i128,
    /// Starting skill rating (ELO-style)
    pub base_skill: i128,
    /// Decay amount per day (in points) for inactive players
    pub decay_per_day: i128,
    /// Days of inactivity before decay starts
    pub decay_grace_days: u64,
    /// Weight of skill in composite score (out of 100)
    pub skill_weight: i128,
    /// Weight of sportsmanship in composite score (out of 100)
    pub sportsmanship_weight: i128,
    /// Weight of achievements in composite score (out of 100)
    pub achievement_weight: i128,
}

/// Action types for update_reputation
/// 0 = Win, 1 = Loss, 2 = Draw, 3 = Penalty, 4 = Bonus, 5 = Decay
pub const ACTION_WIN: u32 = 0;
pub const ACTION_LOSS: u32 = 1;
pub const ACTION_DRAW: u32 = 2;
pub const ACTION_PENALTY: u32 = 3;
pub const ACTION_BONUS: u32 = 4;

/// ELO K-factor for skill rating updates
pub const ELO_K: i128 = 32;
/// Maximum sportsmanship rating value
pub const MAX_SPORT_RATING: u32 = 5;
/// Points awarded per achievement unlock
pub const ACHIEVEMENT_BONUS: i128 = 25;
/// Seconds per day
pub const SECS_PER_DAY: u64 = 86_400;
