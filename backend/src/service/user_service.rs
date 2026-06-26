use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::models::match_models::{EloHistory, UserElo};
use crate::models::user::{User, UserProfile};

#[derive(Debug, Clone)]
pub struct UserService {
    pool: PgPool,
}

impl UserService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get a user by ID
    pub async fn get_user_by_id(&self, user_id: Uuid) -> Result<User, ApiError> {
        let user = sqlx::query_as::<_, User>(
            r#"
            SELECT * FROM users WHERE id = $1
            "#,
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            if e.to_string().contains("not found") {
                ApiError::not_found("User not found")
            } else {
                ApiError::internal_error(format!("Database error: {}", e))
            }
        })?;

        Ok(user)
    }

    /// Get a user profile by ID (public view)
    pub async fn get_user_profile(&self, user_id: Uuid) -> Result<UserProfile, ApiError> {
        let user = self.get_user_by_id(user_id).await?;

        let profile = UserProfile {
            id: user.id,
            username: user.username,
            email: None, // Don't expose email in public profile
            display_name: user.display_name,
            avatar_url: user.avatar_url,
            is_verified: user.is_verified,
            created_at: user.created_at,
            skill_score: user.reputation_score,
            fair_play_score: user.reputation_score,
            is_bad_actor: user.is_banned,
        };

        Ok(profile)
    }

    /// Get current user's full profile (authenticated view)
    pub async fn get_current_user_profile(&self, user_id: Uuid) -> Result<User, ApiError> {
        self.get_user_by_id(user_id).await
    }

    /// Update user profile
    pub async fn update_user_profile(
        &self,
        user_id: Uuid,
        username: Option<String>,
        avatar_url: Option<String>,
        display_name: Option<String>,
        bio: Option<String>,
    ) -> Result<User, ApiError> {
        // Check if user exists
        let _existing_user = self.get_user_by_id(user_id).await?;

        // Build dynamic update query
        let mut query = String::from("UPDATE users SET updated_at = $1");
        let mut param_count = 1;
        let mut params: Vec<String> = vec![Utc::now().to_string()];

        if let Some(username) = &username {
            param_count += 1;
            query.push_str(&format!(", username = ${}", param_count));
            params.push(username.clone());
        }

        if let Some(avatar_url) = &avatar_url {
            param_count += 1;
            query.push_str(&format!(", avatar_url = ${}", param_count));
            params.push(avatar_url.clone());
        }

        if let Some(display_name) = &display_name {
            param_count += 1;
            query.push_str(&format!(", display_name = ${}", param_count));
            params.push(display_name.clone());
        }

        if let Some(bio) = &bio {
            param_count += 1;
            query.push_str(&format!(", bio = ${}", param_count));
            params.push(bio.clone());
        }

        param_count += 1;
        query.push_str(&format!(" WHERE id = ${} RETURNING *", param_count));
        params.push(user_id.to_string());

        let mut query_builder = sqlx::query_as::<_, User>(&query);
        for (i, param) in params.iter().enumerate() {
            query_builder = query_builder.bind(param);
        }

        let updated_user = query_builder.fetch_one(&self.pool).await.map_err(|e| {
            ApiError::internal_error(format!("Failed to update user: {}", e))
        })?;

        Ok(updated_user)
    }

    /// Get user stats including win/loss record and Elo history
    pub async fn get_user_stats(&self, user_id: Uuid) -> Result<UserStats, ApiError> {
        // Get user ELO data
        let elo_data = sqlx::query_as::<_, UserElo>(
            r#"
            SELECT * FROM user_elo WHERE user_id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        // Get ELO history
        let elo_history = sqlx::query_as::<_, EloHistory>(
            r#"
            SELECT * FROM elo_history 
            WHERE user_id = $1 
            ORDER BY created_at DESC 
            LIMIT 50
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        let stats = if let Some(elo) = elo_data {
            UserStats {
                user_id,
                current_rating: elo.current_rating,
                peak_rating: elo.peak_rating,
                games_played: elo.games_played,
                wins: elo.wins,
                losses: elo.losses,
                draws: elo.draws,
                win_rate: if elo.games_played > 0 {
                    (elo.wins as f64 / elo.games_played as f64) * 100.0
                } else {
                    0.0
                },
                win_streak: elo.win_streak,
                loss_streak: elo.loss_streak,
                elo_history,
            }
        } else {
            // Return default stats if no ELO data exists
            UserStats {
                user_id,
                current_rating: 1000, // Default starting rating
                peak_rating: 1000,
                games_played: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                win_rate: 0.0,
                win_streak: 0,
                loss_streak: 0,
                elo_history: vec![],
            }
        };

        Ok(stats)
    }
}

#[derive(Debug, serde::Serialize)]
pub struct UserStats {
    pub user_id: Uuid,
    pub current_rating: i32,
    pub peak_rating: i32,
    pub games_played: i32,
    pub wins: i32,
    pub losses: i32,
    pub draws: i32,
    pub win_rate: f64,
    pub win_streak: i32,
    pub loss_streak: i32,
    pub elo_history: Vec<EloHistory>,
}
