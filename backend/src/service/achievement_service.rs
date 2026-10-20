use crate::api_error::ApiError;
use crate::models::{
    Achievement, PlayerAchievement, AchievementProgress, PlayerAchievementsResponse,
    AchievementStats, AchievementUnlockedEvent,
};
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;
use futures::FutureExt;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

/// Published by the match service when a match is resolved (Issue #1405).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchResultEvent {
    pub match_id: Uuid,
    pub tournament_id: Option<Uuid>,
    pub game_mode: String,
    pub player_ids: Vec<Uuid>,
    pub winner_id: Option<Uuid>,
    pub completed_at: DateTime<Utc>,
}

/// Evaluates achievements for a resolved match.
pub trait MatchResultHandler: Send + Sync + 'static {
    fn handle<'a>(
        &'a self,
        event: &'a MatchResultEvent,
    ) -> BoxFuture<'a, Result<Vec<AchievementUnlockedEvent>, ApiError>>;
}

/// In-process async bus decoupling match resolution from achievement
/// evaluation. Publishing never blocks; evaluation runs on a background task.
#[derive(Clone)]
pub struct AchievementEventBus {
    sender: mpsc::UnboundedSender<MatchResultEvent>,
    unlocked: broadcast::Sender<AchievementUnlockedEvent>,
}

impl AchievementEventBus {
    /// Start the subscriber loop with `handler` and return the bus handle.
    pub fn spawn(handler: Arc<dyn MatchResultHandler>) -> Self {
        let (sender, mut receiver) = mpsc::unbounded_channel::<MatchResultEvent>();
        let (unlocked, _) = broadcast::channel(256);
        let unlocked_tx = unlocked.clone();

        tokio::spawn(async move {
            while let Some(event) = receiver.recv().await {
                let handler = handler.clone();
                let unlocked_tx = unlocked_tx.clone();
                // Each event runs on its own task so one slow or failing
                // evaluation never holds up the next.
                tokio::spawn(async move {
                    process_match_result(handler.as_ref(), &event, &unlocked_tx).await;
                });
            }
            tracing::info!("achievement event bus closed");
        });

        Self { sender, unlocked }
    }

    /// Queue an event for asynchronous evaluation. Returns immediately.
    pub fn publish(&self, event: MatchResultEvent) {
        let match_id = event.match_id;
        if self.sender.send(event).is_err() {
            tracing::error!(%match_id, "achievement event bus is closed; event dropped");
        }
    }

    /// Stream of achievements unlocked by processed events.
    pub fn subscribe_unlocked(&self) -> broadcast::Receiver<AchievementUnlockedEvent> {
        self.unlocked.subscribe()
    }
}

async fn process_match_result(
    handler: &dyn MatchResultHandler,
    event: &MatchResultEvent,
    unlocked_tx: &broadcast::Sender<AchievementUnlockedEvent>,
) {
    match AssertUnwindSafe(handler.handle(event)).catch_unwind().await {
        Ok(Ok(unlocks)) => {
            for unlock in unlocks {
                tracing::info!(
                    match_id = %event.match_id,
                    user_id = %unlock.user_id,
                    achievement = %unlock.achievement_name,
                    "achievement unlocked"
                );
                let _ = unlocked_tx.send(unlock);
            }
        }
        Ok(Err(error)) => {
            tracing::error!(match_id = %event.match_id, ?error, "achievement evaluation failed");
        }
        Err(panic) => {
            let reason = panic
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic".to_string());
            tracing::error!(match_id = %event.match_id, %reason, "achievement evaluation panicked");
        }
    }
}

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

impl MatchResultHandler for AchievementService {
    fn handle<'a>(
        &'a self,
        event: &'a MatchResultEvent,
    ) -> BoxFuture<'a, Result<Vec<AchievementUnlockedEvent>, ApiError>> {
        async move {
            let mut unlocked = Vec::new();
            let data = serde_json::to_value(event).unwrap_or_default();

            if let Some(winner) = event.winner_id {
                unlocked.extend(self.check_achievements(winner, "match_won", data.clone()).await?);
            }
            if event.tournament_id.is_some() {
                for player in &event.player_ids {
                    unlocked.extend(
                        self.check_achievements(*player, "tournament_participated", data.clone())
                            .await?,
                    );
                }
            }
            Ok(unlocked)
        }
        .boxed()
    }
}

#[cfg(test)]
mod event_bus_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    /// Unlocks a "First Win" achievement for the winner, panicking on matches
    /// flagged with the `game_mode` "panic".
    struct FirstWinHandler {
        calls: AtomicUsize,
    }

    impl MatchResultHandler for FirstWinHandler {
        fn handle<'a>(
            &'a self,
            event: &'a MatchResultEvent,
        ) -> BoxFuture<'a, Result<Vec<AchievementUnlockedEvent>, ApiError>> {
            async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(20)).await;
                if event.game_mode == "panic" {
                    panic!("evaluation exploded");
                }
                Ok(event
                    .winner_id
                    .map(|user_id| AchievementUnlockedEvent {
                        user_id,
                        achievement_id: Uuid::nil(),
                        achievement_name: "First Win".to_string(),
                        points: 10,
                        timestamp: Utc::now(),
                    })
                    .into_iter()
                    .collect())
            }
            .boxed()
        }
    }

    fn event(game_mode: &str, winner: Uuid) -> MatchResultEvent {
        MatchResultEvent {
            match_id: Uuid::new_v4(),
            tournament_id: None,
            game_mode: game_mode.to_string(),
            player_ids: vec![winner, Uuid::new_v4()],
            winner_id: Some(winner),
            completed_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn publishing_match_result_unlocks_achievement_asynchronously() {
        let handler = Arc::new(FirstWinHandler { calls: AtomicUsize::new(0) });
        let bus = AchievementEventBus::spawn(handler.clone());
        let mut unlocked = bus.subscribe_unlocked();
        let winner = Uuid::new_v4();

        bus.publish(event("ranked", winner));
        // publish returned before the handler (which sleeps) could finish.
        assert!(unlocked.try_recv().is_err());

        let unlock = tokio::time::timeout(Duration::from_secs(2), unlocked.recv())
            .await
            .expect("achievement should unlock")
            .unwrap();
        assert_eq!(unlock.user_id, winner);
        assert_eq!(unlock.achievement_name, "First Win");
    }

    #[tokio::test]
    async fn panicking_evaluation_does_not_disrupt_other_events() {
        let handler = Arc::new(FirstWinHandler { calls: AtomicUsize::new(0) });
        let bus = AchievementEventBus::spawn(handler.clone());
        let mut unlocked = bus.subscribe_unlocked();
        let winner = Uuid::new_v4();

        bus.publish(event("panic", Uuid::new_v4()));
        bus.publish(event("ranked", winner));

        let unlock = tokio::time::timeout(Duration::from_secs(2), unlocked.recv())
            .await
            .expect("second event should still be processed")
            .unwrap();
        assert_eq!(unlock.user_id, winner);
        assert_eq!(handler.calls.load(Ordering::SeqCst), 2);
    }
}
