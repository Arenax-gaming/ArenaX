// Reward distribution system
use soroban_sdk::{Env, Address, Vec, String};
use crate::storage::*;
use crate::error::VirtualEconomyError;

pub struct RewardManager;

impl RewardManager {
    /// Calculate tournament rewards based on placement and prize pool
    pub fn calculate_tournament_rewards(
        total_prize_pool: i128,
        player_count: u32,
        placement: u32,
    ) -> i128 {
        // Standard tournament payout structure
        match placement {
            1 => total_prize_pool * 50 / 100,  // 50% for 1st place
            2 => total_prize_pool * 30 / 100,  // 30% for 2nd place
            3 => total_prize_pool * 15 / 100,  // 15% for 3rd place
            4 => total_prize_pool * 5 / 100,   // 5% for 4th place
            _ => 0, // No rewards for other placements in basic structure
        }
    }
    
    /// Calculate skill-based rewards for match participation
    pub fn calculate_skill_rewards(
        base_reward: i128,
        skill_rating: i128,
        performance_multiplier: u32, // 1-200 (100 = normal, 200 = exceptional)
    ) -> i128 {
        let skill_bonus = if skill_rating > 2000 {
            base_reward * 50 / 100  // 50% bonus for high skill
        } else if skill_rating > 1500 {
            base_reward * 25 / 100  // 25% bonus for medium skill
        } else {
            0
        };
        
        let performance_bonus = (base_reward * performance_multiplier as i128) / 100;
        
        base_reward + skill_bonus + performance_bonus - base_reward // Adjust for double counting
    }
    
    /// Calculate daily login rewards with streak bonuses
    pub fn calculate_daily_rewards(
        base_daily_reward: i128,
        login_streak: u32,
    ) -> i128 {
        let streak_multiplier = match login_streak {
            0..=6 => 100,      // 1x for first week
            7..=13 => 125,     // 1.25x for second week
            14..=29 => 150,    // 1.5x for weeks 3-4
            30.. => 200,       // 2x for month+ streaks
        };
        
        (base_daily_reward * streak_multiplier) / 100
    }
    
    /// Calculate achievement rewards based on rarity and difficulty
    pub fn calculate_achievement_rewards(
        achievement_type: AchievementType,
        difficulty: u32, // 1-5 scale
    ) -> RewardType {
        match achievement_type {
            AchievementType::FirstWin => RewardType::Currency(100),
            AchievementType::WinStreak => {
                let amount = 50 * difficulty as i128;
                RewardType::Currency(amount)
            },
            AchievementType::TournamentWin => {
                if difficulty >= 4 {
                    // High difficulty tournaments give NFT rewards
                    RewardType::NFT(NFTMetadata {
                        name: String::from_str(&env, "Tournament Champion"),
                        description: String::from_str(&env, "Awarded for winning a high-level tournament"),
                        image_url: String::from_str(&env, "https://assets.arenax.gg/champion.png"),
                        attributes: Vec::new(&env),
                        rarity: difficulty,
                        category: String::from_str(&env, "Achievement"),
                    })
                } else {
                    RewardType::Currency(500 * difficulty as i128)
                }
            },
            AchievementType::Milestone => RewardType::Currency(200 * difficulty as i128),
        }
    }
    
    /// Distribute seasonal rewards to active players
    pub fn calculate_seasonal_rewards(
        player_activity_score: i128,
        season_length_days: u32,
        total_seasonal_pool: i128,
        active_players: u32,
    ) -> i128 {
        // Base allocation per player
        let base_allocation = total_seasonal_pool / active_players as i128;
        
        // Activity multiplier (0.5x to 2x based on activity)
        let activity_multiplier = if player_activity_score > 1000 {
            200 // 2x for very active players
        } else if player_activity_score > 500 {
            150 // 1.5x for moderately active
        } else if player_activity_score > 100 {
            100 // 1x for minimally active
        } else {
            50  // 0.5x for inactive players
        };
        
        (base_allocation * activity_multiplier) / 100
    }
    
    /// Create reward distribution for multiple recipients
    pub fn create_batch_rewards(
        recipients: Vec<Address>,
        reward_amounts: Vec<i128>,
    ) -> Vec<RewardDistribution> {
        let mut distributions = Vec::new(&Env::default());
        
        let mut i = 0u32;
        while i < recipients.len() && i < reward_amounts.len() {
            let recipient = recipients.get(i).unwrap();
            let amount = reward_amounts.get(i).unwrap();
            
            distributions.push_back(RewardDistribution {
                recipient,
                reward_type: RewardType::Currency(amount),
            });
            
            i += 1;
        }
        
        distributions
    }
}

#[derive(Clone, Debug)]
pub enum AchievementType {
    FirstWin,
    WinStreak,
    TournamentWin,
    Milestone,
}