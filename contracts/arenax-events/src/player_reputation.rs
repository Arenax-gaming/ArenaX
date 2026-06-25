use soroban_sdk::{contractevent, Address, Env};

pub const NAMESPACE: &str = "ArenaXPlayerRep";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXPlayerRep_v1", "REPUTATION_UPDATED"])]
pub struct ReputationUpdated {
    pub player: Address,
    pub action_type: u32,
    pub impact: i128,
    pub new_score: i128,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXPlayerRep_v1", "ACHIEVEMENT_UNLOCKED"])]
pub struct AchievementUnlocked {
    pub player: Address,
    pub achievement_id: u32,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXPlayerRep_v1", "SPORTSMANSHIP_RECORDED"])]
pub struct SportsmanshipRecorded {
    pub player: Address,
    pub reviewer: Address,
    pub rating: u32,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXPlayerRep_v1", "SKILL_UPDATED"])]
pub struct SkillUpdated {
    pub player: Address,
    pub old_rating: i128,
    pub new_rating: i128,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXPlayerRep_v1", "REPUTATION_DECAYED"])]
pub struct ReputationDecayed {
    pub player: Address,
    pub amount_decayed: i128,
    pub timestamp: u64,
}

pub fn emit_reputation_updated(
    env: &Env,
    player: &Address,
    action_type: u32,
    impact: i128,
    new_score: i128,
    timestamp: u64,
) {
    ReputationUpdated {
        player: player.clone(),
        action_type,
        impact,
        new_score,
        timestamp,
    }
    .publish(env);
}

pub fn emit_achievement_unlocked(env: &Env, player: &Address, achievement_id: u32, timestamp: u64) {
    AchievementUnlocked {
        player: player.clone(),
        achievement_id,
        timestamp,
    }
    .publish(env);
}

pub fn emit_sportsmanship_recorded(
    env: &Env,
    player: &Address,
    reviewer: &Address,
    rating: u32,
    timestamp: u64,
) {
    SportsmanshipRecorded {
        player: player.clone(),
        reviewer: reviewer.clone(),
        rating,
        timestamp,
    }
    .publish(env);
}

pub fn emit_skill_updated(
    env: &Env,
    player: &Address,
    old_rating: i128,
    new_rating: i128,
    timestamp: u64,
) {
    SkillUpdated {
        player: player.clone(),
        old_rating,
        new_rating,
        timestamp,
    }
    .publish(env);
}

pub fn emit_reputation_decayed(env: &Env, player: &Address, amount_decayed: i128, timestamp: u64) {
    ReputationDecayed {
        player: player.clone(),
        amount_decayed,
        timestamp,
    }
    .publish(env);
}

#[contractevent(topics = ["ArenaXPlayerRep_v1", "REPUTATION_DISPUTED"])]
pub struct ReputationDisputed {
    pub player: Address,
    pub dispute_id: soroban_sdk::BytesN<32>,
    pub timestamp: u64,
}

pub fn emit_reputation_disputed(
    env: &Env,
    player: &Address,
    dispute_id: &soroban_sdk::BytesN<32>,
    timestamp: u64,
) {
    ReputationDisputed {
        player: player.clone(),
        dispute_id: dispute_id.clone(),
        timestamp,
    }
    .publish(env);
}

#[contractevent(topics = ["ArenaXPlayerRep_v1", "REPUTATION_RECOVERED"])]
pub struct ReputationRecovered {
    pub player: Address,
    pub amount_recovered: i128,
    pub timestamp: u64,
}

pub fn emit_reputation_recovered(
    env: &Env,
    player: &Address,
    amount_recovered: i128,
    timestamp: u64,
) {
    ReputationRecovered {
        player: player.clone(),
        amount_recovered,
        timestamp,
    }
    .publish(env);
}

#[contractevent(topics = ["ArenaXPlayerRep_v1", "CATEGORY_SCORE_UPDATED"])]
pub struct CategoryScoreUpdated {
    pub player: Address,
    pub category: u32,
    pub old_score: i128,
    pub new_score: i128,
    pub timestamp: u64,
}

pub fn emit_category_score_updated(
    env: &Env,
    player: &Address,
    category: u32,
    old_score: i128,
    new_score: i128,
    timestamp: u64,
) {
    CategoryScoreUpdated {
        player: player.clone(),
        category,
        old_score,
        new_score,
        timestamp,
    }
    .publish(env);
}

#[contractevent(topics = ["ArenaXPlayerRep_v1", "STREAK_BONUS_AWARDED"])]
pub struct StreakBonusAwarded {
    pub player: Address,
    pub streak_days: u32,
    pub bonus_amount: i128,
    pub timestamp: u64,
}

pub fn emit_streak_bonus_awarded(
    env: &Env,
    player: &Address,
    streak_days: u32,
    bonus_amount: i128,
    timestamp: u64,
) {
    StreakBonusAwarded {
        player: player.clone(),
        streak_days,
        bonus_amount,
        timestamp,
    }
    .publish(env);
}

#[contractevent(topics = ["ArenaXPlayerRep_v1", "DECAY_CONFIG_UPDATED"])]
pub struct DecayConfigUpdated {
    pub new_decay_per_day: i128,
    pub timestamp: u64,
}

pub fn emit_decay_config_updated(
    env: &Env,
    new_decay_per_day: i128,
    timestamp: u64,
) {
    DecayConfigUpdated {
        new_decay_per_day,
        timestamp,
    }
    .publish(env);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_emit_all_events() {
        let env = Env::default();
        let player = Address::generate(&env);
        let reviewer = Address::generate(&env);
        let ts = 1700000000u64;

        emit_reputation_updated(&env, &player, 1, 50, 1050, ts);
        emit_achievement_unlocked(&env, &player, 1, ts);
        emit_sportsmanship_recorded(&env, &player, &reviewer, 5, ts);
        emit_skill_updated(&env, &player, 1000, 1025, ts);
        emit_reputation_decayed(&env, &player, 10, ts);
    }
}
