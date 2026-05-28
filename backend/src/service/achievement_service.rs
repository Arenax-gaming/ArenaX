use crate::api_error::ApiError;
use crate::models::{
    Achievement, PlayerAchievement, AchievementProgress, PlayerAchievementsResponse,
    AchievementStats, AchievementUnlockedEvent,
};
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

pub struct AchievementService {
    db_pool: PgPool,
}

impl AchievementService {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool }
    }

    /// Get all achievements
    pub async fn get_all_achievements(&self) -> Result<Vec<Achievement>, ApiError> {
        let achievements = sqlx::query_as::<_, (Uuid, String, String, Option<String>, String, String, i32, i32, chrono::DateTime<chrono::Utc>)>(
            r#"
            SELECT id, name, description, icon_url, category, rarity, difficulty, points, created_at
            FROM achievements
            ORDER BY difficulty ASC, points DESC
            "#
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(achievements
            .into_iter()
            .map(|(id, name, description, icon_url, category, rarity, difficulty, points, created_at)| {
                Achievement {
                    id,
                    name,
                    description,
                    icon_url,
                    category,
                    rarity,
                    difficulty,
                    points,
                    created_at,
                }
            })
            .collect())
    }

    /// Get player's achievements
    pub async fn get_player_achievements(
        &self,
        player_id: Uuid,
    ) -> Result<PlayerAchievementsResponse, ApiError> {
        let username = sqlx::query_scalar::<_, String>(
            "SELECT username FROM users WHERE id = $1"
        )
        .bind(player_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?
        .ok_or_else(|| ApiError::NotFound)?;

        let achievements = sqlx::query_as::<_, (Uuid, String, i32, i32, bool, Option<chrono::DateTime<chrono::Utc>>)>(
            r#"
            SELECT a.id, a.name, pa.progress, a.points, pa.is_unlocked, pa.unlocked_at
            FROM achievements a
            LEFT JOIN player_achievements pa ON a.id = pa.achievement_id AND pa.user_id = $1
            ORDER BY a.difficulty ASC, a.points DESC
            "#
        )
        .bind(player_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let mut total_achievements = 0;
        let mut unlocked_achievements = 0;
        let mut total_points = 0;

        let achievement_progress: Vec<AchievementProgress> = achievements
            .into_iter()
            .map(|(id, name, progress, max_progress, is_unlocked, unlocked_at)| {
                total_achievements += 1;
                if is_unlocked {
                    unlocked_achievements += 1;
                    total_points += max_progress;
                }

                let percentage = if max_progress > 0 {
                    (progress as f64 / max_progress as f64) * 100.0
                } else {
                    0.0
                };

                AchievementProgress {
                    achievement_id: id,
                    achievement_name: name,
                    progress,
                    max_progress,
                    percentage,
                    is_unlocked,
                    unlocked_at,
                }
            })
            .collect();

        Ok(PlayerAchievementsResponse {
            user_id: player_id,
            username,
            total_achievements,
            unlocked_achievements,
            total_points,
            achievements: achievement_progress,
        })
    }

    /// Update achievement progress
    pub async fn update_progress(
        &self,
        player_id: Uuid,
        achievement_id: Uuid,
        progress: i32,
    ) -> Result<Option<AchievementUnlockedEvent>, ApiError> {
        // Get achievement details
        let achievement = sqlx::query_as::<_, (String, i32, i32)>(
            "SELECT name, points, points as max_progress FROM achievements WHERE id = $1"
        )
        .bind(achievement_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?
        .ok_or_else(|| ApiError::NotFound)?;

        let (name, points, max_progress) = achievement;

        // Get current progress
        let current_progress = sqlx::query_scalar::<_, Option<i32>>(
            "SELECT progress FROM player_achievements WHERE user_id = $1 AND achievement_id = $2"
        )
        .bind(player_id)
        .bind(achievement_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?
        .flatten()
        .unwrap_or(0);

        let new_progress = (current_progress + progress).min(max_progress);
        let was_unlocked = current_progress >= max_progress;
        let is_now_unlocked = new_progress >= max_progress;

        // Upsert player achievement
        sqlx::query(
            r#"
            INSERT INTO player_achievements (user_id, achievement_id, progress, max_progress, is_unlocked, unlocked_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (user_id, achievement_id) DO UPDATE SET
                progress = $3,
                is_unlocked = $5,
                unlocked_at = CASE WHEN $5 = true AND player_achievements.is_unlocked = false THEN NOW() ELSE player_achievements.unlocked_at END
            "#
        )
        .bind(player_id)
        .bind(achievement_id)
        .bind(new_progress)
        .bind(max_progress)
        .bind(is_now_unlocked)
        .bind(if is_now_unlocked { Some(Utc::now()) } else { None })
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        // Return unlock event if newly unlocked
        if is_now_unlocked && !was_unlocked {
            Ok(Some(AchievementUnlockedEvent {
                user_id: player_id,
                achievement_id,
                achievement_name: name,
                points,
                timestamp: Utc::now(),
            }))
        } else {
            Ok(None)
        }
    }

    /// Check and unlock achievements based on game event
    pub async fn check_achievements(
        &self,
        player_id: Uuid,
        event_type: &str,
        event_data: serde_json::Value,
    ) -> Result<Vec<AchievementUnlockedEvent>, ApiError> {
        let mut unlocked_events = Vec::new();

        // Get relevant achievements for this event type
        let achievements = sqlx::query_as::<_, (Uuid, String, i32)>(
            r#"
            SELECT id, name, points FROM achievements 
            WHERE category = $1 AND is_active = true
            "#
        )
        .bind(event_type)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        for (achievement_id, name, points) in achievements {
            // Determine progress increment based on event
            let progress_increment = match event_type {
                "match_won" => 1,
                "match_streak" => event_data.get("streak").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                "tournament_won" => 5,
                "tournament_participated" => 1,
                _ => 0,
            };

            if progress_increment > 0 {
                if let Ok(Some(event)) = self.update_progress(player_id, achievement_id, progress_increment).await {
                    unlocked_events.push(event);
                }
            }
        }

        Ok(unlocked_events)
    }

    /// Get achievement statistics
    pub async fn get_achievement_stats(
        &self,
        achievement_id: Uuid,
    ) -> Result<AchievementStats, ApiError> {
        let achievement = sqlx::query_as::<_, (String,)>(
            "SELECT name FROM achievements WHERE id = $1"
        )
        .bind(achievement_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?
        .ok_or_else(|| ApiError::NotFound)?;

        let (name,) = achievement;

        let total_unlocked = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM player_achievements WHERE achievement_id = $1 AND is_unlocked = true"
        )
        .bind(achievement_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let total_players = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(DISTINCT user_id) FROM users WHERE is_active = true"
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let unlock_percentage = if total_players > 0 {
            (total_unlocked as f64 / total_players as f64) * 100.0
        } else {
            0.0
        };

        Ok(AchievementStats {
            achievement_id,
            name,
            total_unlocked,
            unlock_percentage,
            average_time_to_unlock: None,
        })
    }

    /// Generate shareable achievement content
    pub async fn generate_share_content(
        &self,
        player_id: Uuid,
        achievement_id: Uuid,
    ) -> Result<(String, String), ApiError> {
        let (username, achievement_name) = sqlx::query_as::<_, (String, String)>(
            r#"
            SELECT u.username, a.name
            FROM users u, achievements a
            WHERE u.id = $1 AND a.id = $2
            "#
        )
        .bind(player_id)
        .bind(achievement_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?
        .ok_or_else(|| ApiError::NotFound)?;

        let share_url = format!(
            "https://arenax.io/achievements/{}/{}",
            player_id, achievement_id
        );
        let share_text = format!(
            "🏆 I just unlocked the '{}' achievement on ArenaX! Join me and compete! {}",
            achievement_name, share_url
        );

        Ok((share_url, share_text))
    }
}
