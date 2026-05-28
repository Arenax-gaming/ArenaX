use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Achievement {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub category: String,
    pub rarity: String, // common, uncommon, rare, epic, legendary
    pub difficulty: i32, // 1-5
    pub points: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerAchievement {
    pub id: Uuid,
    pub achievement_id: Uuid,
    pub user_id: Uuid,
    pub progress: i32,
    pub max_progress: i32,
    pub is_unlocked: bool,
    pub unlocked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementProgress {
    pub achievement_id: Uuid,
    pub achievement_name: String,
    pub progress: i32,
    pub max_progress: i32,
    pub percentage: f64,
    pub is_unlocked: bool,
    pub unlocked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerAchievementsResponse {
    pub user_id: Uuid,
    pub username: String,
    pub total_achievements: i32,
    pub unlocked_achievements: i32,
    pub total_points: i32,
    pub achievements: Vec<AchievementProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementStats {
    pub achievement_id: Uuid,
    pub name: String,
    pub total_unlocked: i64,
    pub unlock_percentage: f64,
    pub average_time_to_unlock: Option<i32>, // in hours
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgressRequest {
    pub progress: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareAchievementRequest {
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareAchievementResponse {
    pub share_url: String,
    pub share_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementUnlockedEvent {
    pub user_id: Uuid,
    pub achievement_id: Uuid,
    pub achievement_name: String,
    pub points: i32,
    pub timestamp: DateTime<Utc>,
}
