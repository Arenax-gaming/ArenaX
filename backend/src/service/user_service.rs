use chrono::{DateTime, Utc};
use redis::{AsyncCommands, Client as RedisClient};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

const PROFILE_CACHE_VERSION: &str = "v1";
const PROFILE_CACHE_TTL_SECONDS: u64 = 60;

use crate::api_error::ApiError;
use crate::models::match_models::{EloHistory, UserElo};
use crate::models::user::{User, UserProfile};

#[derive(Debug, Clone)]
pub struct UserService {
    pool: PgPool,
    redis_client: Option<Arc<RedisClient>>,
}

impl UserService {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            redis_client: None,
        }
    }

    pub fn with_redis(mut self, redis_client: Arc<RedisClient>) -> Self {
        self.redis_client = Some(redis_client);
        self
    }

    fn profile_cache_key(user_id: Uuid) -> String {
        format!("profile:{}:{}", PROFILE_CACHE_VERSION, user_id)
    }

    pub async fn invalidate_profile_cache(&self, user_id: Uuid) {
        let Some(redis_client) = &self.redis_client else {
            return;
        };
        if let Ok(mut connection) = redis_client.get_multiplexed_async_connection().await {
            let _: Result<(), _> = connection.del(Self::profile_cache_key(user_id)).await;
        }
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
        let cache_key = Self::profile_cache_key(user_id);
        if let Some(redis_client) = &self.redis_client {
            if let Ok(mut connection) = redis_client.get_multiplexed_async_connection().await {
                match connection.get::<_, Option<String>>(&cache_key).await {
                    Ok(Some(cached)) => {
                        if let Ok(profile) = serde_json::from_str::<UserProfile>(&cached) {
                            crate::metrics::record_profile_cache_hit();
                            let _: Result<(), _> = connection
                                .expire(&cache_key, PROFILE_CACHE_TTL_SECONDS as i64)
                                .await;
                            return Ok(profile);
                        }
                    }
                    Ok(None) => {}
                    Err(error) => tracing::warn!(%user_id, %error, "Profile cache read failed"),
                }
            }
        }
        crate::metrics::record_profile_cache_miss();

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

        if let Some(redis_client) = &self.redis_client {
            if let Ok(mut connection) = redis_client.get_multiplexed_async_connection().await {
                if let Ok(serialized) = serde_json::to_string(&profile) {
                    let _: Result<(), _> = connection
                        .set_ex(&cache_key, serialized, PROFILE_CACHE_TTL_SECONDS)
                        .await;
                }
            }
        }

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

        self.invalidate_profile_cache(user_id).await;

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

    // ── GDPR / NDPR account erasure & data portability (Issue #1078) ─────────

    /// Soft-delete the authenticated user's account: sets `deleted_at`,
    /// anonymises PII (email, username, phone, avatar, bio, password) and
    /// deactivates the account so login is refused.
    ///
    /// The Stellar public key is intentionally **retained** so the on-chain
    /// transaction audit trail stays intact; the wallet/identity reference is
    /// decoupled only by removing the human-identifiable fields.
    pub async fn soft_delete_user(&self, user_id: Uuid) -> Result<(), ApiError> {
        let user = self.get_user_by_id(user_id).await?;

        if user.deleted_at.is_some() {
            return Err(ApiError::bad_request("Account has already been deleted"));
        }

        let now = Utc::now();
        // Unique but unidentifiable placeholder (keeps UNIQUE constraints).
        let short_id: String = user_id.to_string().split('-').collect();
        let pseudonym = format!("deleted_{}", &short_id[..short_id.len().min(10)]);

        sqlx::query(
            r#"
            UPDATE users SET
                deleted_at = $1,
                updated_at = $1,
                is_active = false,
                password_hash = NULL,
                email = $2,
                phone_number = $3,
                username = $3,
                display_name = NULL,
                avatar_url = NULL,
                bio = NULL,
                profile_image_url = NULL,
                device_fingerprint = NULL
            WHERE id = $4
            "#,
        )
        .bind(now)
        .bind(format!("{}@deleted.local", pseudonym))
        .bind(&pseudonym)
        .bind(user_id)
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        tracing::info!(user_id = %user_id, "User account soft-deleted (GDPR/NDPR)");

        Ok(())
    }

    /// Queue an asynchronous data-export job for the user. The archive is
    /// prepared in the background and "delivered" via an email link (async,
    /// not a synchronous download).
    pub async fn queue_data_export(&self, user_id: Uuid) -> Result<DataExportJob, ApiError> {
        // Ensure the account still exists.
        let _user = self.get_user_by_id(user_id).await?;

        let job = sqlx::query_as!(
            DataExportJob,
            r#"
            INSERT INTO data_export_jobs (id, user_id, status)
            VALUES ($1, $2, 'queued')
            RETURNING id, user_id, status, export_link, requested_at, completed_at
            "#,
            Uuid::new_v4(),
            user_id,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        let pool = self.pool.clone();
        tokio::spawn(async move {
            match build_user_export_archive(&pool, user_id).await {
                Ok(archive) => {
                    // In a full deployment this archive is uploaded to object
                    // storage and an email link is dispatched to the owner;
                    // here we record the per-job link for retrieval.
                    let link = format!("/api/users/me/export/{}", job.id);
                    let _ = sqlx::query(
                        r#"
                        UPDATE data_export_jobs
                        SET status = 'ready', export_link = $1, completed_at = NOW()
                        WHERE id = $2
                        "#,
                    )
                    .bind(link)
                    .bind(job.id)
                    .execute(&pool)
                    .await;

                    tracing::info!(job_id = %job.id, bytes = archive.as_str().len(), "Data export archive ready");
                }
                Err(e) => {
                    tracing::error!(job_id = %job.id, error = %e, "Data export archive failed");
                    let _ = sqlx::query("UPDATE data_export_jobs SET status = 'failed' WHERE id = $1")
                        .bind(job.id)
                        .execute(&pool)
                        .await;
                }
            }
        });

        Ok(job)
    }

    /// Get the current status of a data-export job.
    pub async fn get_export_job(&self, job_id: Uuid, user_id: Uuid) -> Result<DataExportJob, ApiError> {
        sqlx::query_as!(
            DataExportJob,
            r#"
            SELECT id, user_id, status, export_link, requested_at, completed_at
            FROM data_export_jobs
            WHERE id = $1 AND user_id = $2
            "#,
            job_id,
            user_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(ApiError::database_error)?
        .ok_or_else(|| ApiError::not_found("Data export job not found"))
    }
}

/// Data export job row (GDPR data portability).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct DataExportJob {
    pub id: Uuid,
    pub user_id: Uuid,
    pub status: String,
    pub export_link: Option<String>,
    pub requested_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

/// Builds the JSON archive of all personal data (profile, match history,
/// transactions) for a user's export request.
async fn build_user_export_archive(pool: &PgPool, user_id: Uuid) -> Result<String, String> {
    let profile = sqlx::query_as::<_, User>(
        r#"
        SELECT * FROM users WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let profile_json = match &profile {
        Some(u) => serde_json::json!({
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "display_name": u.display_name,
            "phone_number": u.phone_number,
            "country_code": u.country_code,
            "created_at": u.created_at,
            "stellar_public_key": u.stellar_public_key,
            "is_verified": u.is_verified,
        }),
        None => serde_json::json!(null),
    };

    let transactions = sqlx::query_as::<_, serde_json::Value>(
        r#"
        SELECT json_agg(t) AS agg FROM (
            SELECT id, transaction_type, amount, currency, status, reference,
                   description, created_at
            FROM transactions WHERE user_id = $1 ORDER BY created_at DESC
        ) t
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let match_history = sqlx::query_as::<_, serde_json::Value>(
        r#"
        SELECT json_agg(m) AS agg FROM (
            SELECT id, match_type, status, game_mode, player1_id, player2_id,
                   player1_score, player2_score, winner_id, completed_at
            FROM matches
            WHERE player1_id = $1 OR player2_id = $1
            ORDER BY completed_at DESC
        ) m
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let archive = serde_json::json!({
        "generated_at": Utc::now().to_rfc3339(),
        "user_id": user_id,
        "profile": profile_json,
        "transactions": transactions,
        "match_history": match_history,
    });

    Ok(serde_json::to_string_pretty(&archive).map_err(|e| e.to_string())?)
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
