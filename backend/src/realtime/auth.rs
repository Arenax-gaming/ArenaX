use crate::auth::jwt_service::Claims;
use crate::db::DbPool;
use uuid::Uuid;
use thiserror::Error;
use tracing::{warn, debug};

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("Unauthorized: {0}")]
    Unauthorized(String),
    #[error("Invalid channel format: {0}")]
    InvalidChannel(String),
    #[error("Database error: {0}")]
    Database(String),
}

/// Centralized authorization guard for real-time channels.
pub struct RealtimeAuth {
    db_pool: DbPool,
}

impl RealtimeAuth {
    pub fn new(db_pool: DbPool) -> Self {
        Self { db_pool }
    }

    /// Authorize a subscription to a channel.
    pub async fn authorize_subscription(
        &self,
        claims: &Claims,
        channel: &str,
    ) -> Result<(), AuthError> {
        let user_id = Uuid::parse_str(&claims.sub)
            .map_err(|_| AuthError::Unauthorized("Invalid user ID in claims".to_string()))?;

        if channel.starts_with("user:") {
            self.authorize_user_channel(user_id, channel)
        } else if channel.starts_with("match:") {
            self.authorize_match_channel(user_id, channel).await
        } else {
            Err(AuthError::InvalidChannel(format!("Unknown channel prefix: {}", channel)))
        }
    }

    fn authorize_user_channel(&self, user_id: Uuid, channel: &str) -> Result<(), AuthError> {
        let target_id_str = channel.strip_prefix("user:").unwrap();
        let target_id = Uuid::parse_str(target_id_str)
            .map_err(|_| AuthError::InvalidChannel("Invalid user ID in channel name".to_string()))?;

        if user_id == target_id {
            Ok(())
        } else {
            warn!(user_id = %user_id, target_id = %target_id, "Unauthorized attempt to subscribe to foreign user channel");
            Err(AuthError::Unauthorized("Cannot subscribe to another user's private channel".to_string()))
        }
    }

    async fn authorize_match_channel(&self, user_id: Uuid, channel: &str) -> Result<(), AuthError> {
        let match_id_str = channel.strip_prefix("match:").unwrap();
        let match_id = Uuid::parse_str(match_id_str)
            .map_err(|_| AuthError::InvalidChannel("Invalid match ID in channel name".to_string()))?;

        // Check if user is a participant in the match
        let is_participant = sqlx::query!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM matches 
                WHERE id = $1 AND (player1_id = $2 OR player2_id = $2)
            ) as "exists!"
            "#,
            match_id,
            user_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| AuthError::Database(e.to_string()))?
        .exists;

        if is_participant {
            debug!(user_id = %user_id, match_id = %match_id, "Authorized subscription to match channel");
            Ok(())
        } else {
            // Also check match_authority table just in case it's a newer match type
            let is_participant_auth = sqlx::query!(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM match_authority 
                    WHERE id = $1 AND (player_a = $2 OR player_b = $2)
                ) as "exists!"
                "#,
                match_id,
                user_id.to_string()
            )
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| AuthError::Database(e.to_string()))?
            .exists;

            if is_participant_auth {
                debug!(user_id = %user_id, match_id = %match_id, "Authorized subscription to match channel via match_authority");
                Ok(())
            } else {
                warn!(user_id = %user_id, match_id = %match_id, "Unauthorized attempt to subscribe to match channel");
                Err(AuthError::Unauthorized("Not a participant in this match".to_string()))
            }
        }
    }

    /// Authorize publishing to a channel (if clients are allowed to publish).
    pub async fn authorize_publish(
        &self,
        claims: &Claims,
        channel: &str,
    ) -> Result<(), AuthError> {
        // Currently, we don't allow clients to publish to any channel.
        // If we did, we'd add similar logic here.
        warn!(user_id = %claims.sub, channel = %channel, "Rejecting client-side publish attempt (not allowed)");
        Err(AuthError::Unauthorized("Publishing to channels is restricted to internal services".to_string()))
    }
}
