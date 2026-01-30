use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use redis::{aio::ConnectionManager, AsyncCommands};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// JWT-related errors
#[derive(Debug, Error)]
pub enum JwtError {
    #[error("Token generation failed: {0}")]
    TokenGeneration(String),

    #[error("Token validation failed: {0}")]
    TokenValidation(String),

    #[error("Token expired")]
    TokenExpired,

    #[error("Invalid token")]
    InvalidToken,

    #[error("Token blacklisted")]
    TokenBlacklisted,

    #[error("Session not found")]
    SessionNotFound,

    #[error("Redis error: {0}")]
    RedisError(String),

    #[error("Key rotation error: {0}")]
    KeyRotation(String),
}

impl From<redis::RedisError> for JwtError {
    fn from(err: redis::RedisError) -> Self {
        JwtError::RedisError(err.to_string())
    }
}

impl From<jsonwebtoken::errors::Error> for JwtError {
    fn from(err: jsonwebtoken::errors::Error) -> Self {
        match err.kind() {
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => JwtError::TokenExpired,
            _ => JwtError::TokenValidation(err.to_string()),
        }
    }
}

/// JWT Claims structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,        // Subject (user ID)
    pub exp: i64,           // Expiration time
    pub iat: i64,           // Issued at
    pub jti: String,        // JWT ID (unique token identifier)
    pub token_type: TokenType,
    pub device_id: Option<String>,
    pub session_id: String,
    pub roles: Vec<String>,
}

/// Token type enumeration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TokenType {
    Access,
    Refresh,
}

/// Token pair (access + refresh)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub token_type: String,
}

/// JWT configuration
#[derive(Debug, Clone)]
pub struct JwtConfig {
    pub secret_key: String,
    pub access_token_expiry: Duration,
    pub refresh_token_expiry: Duration,
    pub algorithm: Algorithm,
    pub issuer: Option<String>,
    pub audience: Option<String>,
}

impl Default for JwtConfig {
    fn default() -> Self {
        Self {
            secret_key: std::env::var("JWT_SECRET")
                .unwrap_or_else(|_| "default_secret_change_in_production".to_string()),
            access_token_expiry: Duration::minutes(15),
            refresh_token_expiry: Duration::days(7),
            algorithm: Algorithm::HS256,
            issuer: Some("ArenaX".to_string()),
            audience: Some("ArenaX API".to_string()),
        }
    }
}

/// Session data stored in Redis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub user_id: Uuid,
    pub session_id: String,
    pub device_id: Option<String>,
    pub created_at: i64,
    pub last_activity: i64,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}

/// Token analytics data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenAnalytics {
    pub total_generated: u64,
    pub total_validated: u64,
    pub total_refreshed: u64,
    pub total_blacklisted: u64,
    pub active_sessions: u64,
}

/// Key rotation state
#[derive(Debug, Clone)]
pub struct KeyRotation {
    pub current_key: String,
    pub previous_key: Option<String>,
    pub next_rotation: i64,
    pub rotation_interval: Duration,
}

impl KeyRotation {
    pub fn new(initial_key: String) -> Self {
        Self {
            current_key: initial_key,
            previous_key: None,
            next_rotation: (Utc::now() + Duration::days(30)).timestamp(),
            rotation_interval: Duration::days(30),
        }
    }

    pub fn should_rotate(&self) -> bool {
        Utc::now().timestamp() >= self.next_rotation
    }

    pub fn rotate(&mut self, new_key: String) {
        self.previous_key = Some(self.current_key.clone());
        self.current_key = new_key;
        self.next_rotation = (Utc::now() + self.rotation_interval).timestamp();
    }
}

/// Main JWT Service
pub struct JwtService {
    config: JwtConfig,
    redis: ConnectionManager,
    key_rotation: Arc<tokio::sync::RwLock<KeyRotation>>,
}

impl JwtService {
    /// Create a new JWT service
    pub fn new(config: JwtConfig, redis: ConnectionManager) -> Self {
        let key_rotation = KeyRotation::new(config.secret_key.clone());

        Self {
            config,
            redis,
            key_rotation: Arc::new(tokio::sync::RwLock::new(key_rotation)),
        }
    }

    /// Generate access token
    pub async fn generate_access_token(
        &self,
        user_id: Uuid,
        roles: Vec<String>,
        device_id: Option<String>,
    ) -> Result<String, JwtError> {
        let session_id = Uuid::new_v4().to_string();

        let claims = Claims {
            sub: user_id.to_string(),
            exp: (Utc::now() + self.config.access_token_expiry).timestamp(),
            iat: Utc::now().timestamp(),
            jti: Uuid::new_v4().to_string(),
            token_type: TokenType::Access,
            device_id: device_id.clone(),
            session_id: session_id.clone(),
            roles: roles.clone(),
        };

        let key_rotation = self.key_rotation.read().await;
        let encoding_key = EncodingKey::from_secret(key_rotation.current_key.as_bytes());

        let token = encode(&Header::new(self.config.algorithm), &claims, &encoding_key)
            .map_err(|e| JwtError::TokenGeneration(e.to_string()))?;

        // Store session in Redis
        self.store_session(&session_id, user_id, device_id).await?;

        info!(user_id = %user_id, session_id = %session_id, "Access token generated");

        Ok(token)
    }

    /// Generate refresh token
    pub async fn generate_refresh_token(
        &self,
        user_id: Uuid,
        roles: Vec<String>,
        device_id: Option<String>,
    ) -> Result<String, JwtError> {
        let session_id = Uuid::new_v4().to_string();

        let claims = Claims {
            sub: user_id.to_string(),
            exp: (Utc::now() + self.config.refresh_token_expiry).timestamp(),
            iat: Utc::now().timestamp(),
            jti: Uuid::new_v4().to_string(),
            token_type: TokenType::Refresh,
            device_id: device_id.clone(),
            session_id: session_id.clone(),
            roles,
        };

        let key_rotation = self.key_rotation.read().await;
        let encoding_key = EncodingKey::from_secret(key_rotation.current_key.as_bytes());

        let token = encode(&Header::new(self.config.algorithm), &claims, &encoding_key)
            .map_err(|e| JwtError::TokenGeneration(e.to_string()))?;

        info!(user_id = %user_id, session_id = %session_id, "Refresh token generated");

        Ok(token)
    }

    /// Generate both access and refresh tokens
    pub async fn generate_token_pair(
        &self,
        user_id: Uuid,
        roles: Vec<String>,
        device_id: Option<String>,
    ) -> Result<TokenPair, JwtError> {
        let access_token = self.generate_access_token(user_id, roles.clone(), device_id.clone()).await?;
        let refresh_token = self.generate_refresh_token(user_id, roles, device_id).await?;

        Ok(TokenPair {
            access_token,
            refresh_token,
            expires_in: self.config.access_token_expiry.num_seconds(),
            token_type: "Bearer".to_string(),
        })
    }

    /// Validate token and return claims
    pub async fn validate_token(&self, token: &str) -> Result<Claims, JwtError> {
        // Check if token is blacklisted
        if self.is_token_blacklisted(token).await? {
            return Err(JwtError::TokenBlacklisted);
        }

        let key_rotation = self.key_rotation.read().await;

        // Try with current key
        let claims = match self.decode_token(token, &key_rotation.current_key) {
            Ok(claims) => claims,
            Err(e) => {
                // If current key fails and we have a previous key, try it
                if let Some(ref prev_key) = key_rotation.previous_key {
                    debug!("Trying previous key for token validation");
                    self.decode_token(token, prev_key)?
                } else {
                    return Err(e);
                }
            }
        };

        // Verify session exists
        if !self.session_exists(&claims.session_id).await? {
            return Err(JwtError::SessionNotFound);
        }

        // Update session activity
        self.update_session_activity(&claims.session_id).await?;

        // Increment analytics
        self.increment_analytics("validated").await?;

        Ok(claims)
    }

    /// Decode token with specific key
    fn decode_token(&self, token: &str, secret_key: &str) -> Result<Claims, JwtError> {
        let mut validation = Validation::new(self.config.algorithm);

        if let Some(ref issuer) = self.config.issuer {
            validation.set_issuer(&[issuer]);
        }

        if let Some(ref audience) = self.config.audience {
            validation.set_audience(&[audience]);
        }

        let decoding_key = DecodingKey::from_secret(secret_key.as_bytes());
        let token_data = decode::<Claims>(token, &decoding_key, &validation)?;

        Ok(token_data.claims)
    }

    /// Refresh access token using refresh token
    pub async fn refresh_token(&self, refresh_token: &str) -> Result<TokenPair, JwtError> {
        let claims = self.validate_token(refresh_token).await?;

        // Verify it's a refresh token
        if claims.token_type != TokenType::Refresh {
            return Err(JwtError::InvalidToken);
        }

        let user_id = Uuid::parse_str(&claims.sub)
            .map_err(|e| JwtError::TokenValidation(e.to_string()))?;

        // Generate new token pair
        let token_pair = self
            .generate_token_pair(user_id, claims.roles, claims.device_id)
            .await?;

        // Increment analytics
        self.increment_analytics("refreshed").await?;

        info!(user_id = %user_id, "Token refreshed successfully");

        Ok(token_pair)
    }

    /// Blacklist a token
    pub async fn blacklist_token(&self, token: &str, reason: &str) -> Result<(), JwtError> {
        // Decode token to get expiration
        let key_rotation = self.key_rotation.read().await;
        let claims = self.decode_token(token, &key_rotation.current_key)?;

        let exp_duration = claims.exp - Utc::now().timestamp();
        if exp_duration <= 0 {
            // Token already expired, no need to blacklist
            return Ok(());
        }

        let blacklist_key = format!("blacklist:{}", claims.jti);

        let mut conn = self.redis.clone();
        conn.set_ex(&blacklist_key, reason, exp_duration as u64).await?;

        // Increment analytics
        self.increment_analytics("blacklisted").await?;

        warn!(jti = %claims.jti, reason = %reason, "Token blacklisted");

        Ok(())
    }

    /// Check if token is blacklisted
    pub async fn is_token_blacklisted(&self, token: &str) -> Result<bool, JwtError> {
        // Try to extract JTI from token without full validation
        let key_rotation = self.key_rotation.read().await;

        match self.decode_token(token, &key_rotation.current_key) {
            Ok(claims) => {
                let blacklist_key = format!("blacklist:{}", claims.jti);
                let mut conn = self.redis.clone();
                let exists: bool = conn.exists(&blacklist_key).await?;
                Ok(exists)
            }
            Err(_) => Ok(false), // If we can't decode, let validation handle it
        }
    }

    /// Store session data in Redis
    async fn store_session(
        &self,
        session_id: &str,
        user_id: Uuid,
        device_id: Option<String>,
    ) -> Result<(), JwtError> {
        let session_data = SessionData {
            user_id,
            session_id: session_id.to_string(),
            device_id,
            created_at: Utc::now().timestamp(),
            last_activity: Utc::now().timestamp(),
            ip_address: None,
            user_agent: None,
        };

        let session_key = format!("session:{}", session_id);
        let session_json = serde_json::to_string(&session_data)
            .map_err(|e| JwtError::RedisError(e.to_string()))?;

        let mut conn = self.redis.clone();
        conn.set_ex(
            &session_key,
            session_json,
            self.config.refresh_token_expiry.num_seconds() as u64,
        )
        .await?;

        // Add to user's active sessions
        let user_sessions_key = format!("user_sessions:{}", user_id);
        conn.sadd(&user_sessions_key, session_id).await?;
        conn.expire(&user_sessions_key, self.config.refresh_token_expiry.num_seconds() as i64)
            .await?;

        Ok(())
    }

    /// Check if session exists
    async fn session_exists(&self, session_id: &str) -> Result<bool, JwtError> {
        let session_key = format!("session:{}", session_id);
        let mut conn = self.redis.clone();
        let exists: bool = conn.exists(&session_key).await?;
        Ok(exists)
    }

    /// Update session activity timestamp
    async fn update_session_activity(&self, session_id: &str) -> Result<(), JwtError> {
        let session_key = format!("session:{}", session_id);
        let mut conn = self.redis.clone();

        // Get current session data
        let session_json: Option<String> = conn.get(&session_key).await?;

        if let Some(json) = session_json {
            let mut session: SessionData = serde_json::from_str(&json)
                .map_err(|e| JwtError::RedisError(e.to_string()))?;

            session.last_activity = Utc::now().timestamp();

            let updated_json = serde_json::to_string(&session)
                .map_err(|e| JwtError::RedisError(e.to_string()))?;

            conn.set_ex(
                &session_key,
                updated_json,
                self.config.refresh_token_expiry.num_seconds() as u64,
            )
            .await?;
        }

        Ok(())
    }

    /// Get all active sessions for a user
    pub async fn get_user_sessions(&self, user_id: Uuid) -> Result<Vec<SessionData>, JwtError> {
        let user_sessions_key = format!("user_sessions:{}", user_id);
        let mut conn = self.redis.clone();

        let session_ids: Vec<String> = conn.smembers(&user_sessions_key).await?;

        let mut sessions = Vec::new();
        for session_id in session_ids {
            let session_key = format!("session:{}", session_id);
            if let Some(session_json) = conn.get::<_, Option<String>>(&session_key).await? {
                if let Ok(session) = serde_json::from_str::<SessionData>(&session_json) {
                    sessions.push(session);
                }
            }
        }

        Ok(sessions)
    }

    /// Revoke all sessions for a user
    pub async fn revoke_user_sessions(&self, user_id: Uuid) -> Result<u32, JwtError> {
        let user_sessions_key = format!("user_sessions:{}", user_id);
        let mut conn = self.redis.clone();

        let session_ids: Vec<String> = conn.smembers(&user_sessions_key).await?;
        let count = session_ids.len() as u32;

        for session_id in session_ids {
            let session_key = format!("session:{}", session_id);
            conn.del(&session_key).await?;
        }

        conn.del(&user_sessions_key).await?;

        info!(user_id = %user_id, count = count, "User sessions revoked");

        Ok(count)
    }

    /// Revoke a specific session
    pub async fn revoke_session(&self, session_id: &str) -> Result<(), JwtError> {
        let session_key = format!("session:{}", session_id);
        let mut conn = self.redis.clone();
        conn.del(&session_key).await?;

        info!(session_id = %session_id, "Session revoked");

        Ok(())
    }

    /// Increment analytics counter
    async fn increment_analytics(&self, metric: &str) -> Result<(), JwtError> {
        let analytics_key = format!("analytics:jwt:{}", metric);
        let mut conn = self.redis.clone();
        conn.incr(&analytics_key, 1).await?;
        Ok(())
    }

    /// Get token analytics
    pub async fn get_analytics(&self) -> Result<TokenAnalytics, JwtError> {
        let mut conn = self.redis.clone();

        let total_generated: u64 = conn.get("analytics:jwt:generated").await.unwrap_or(0);
        let total_validated: u64 = conn.get("analytics:jwt:validated").await.unwrap_or(0);
        let total_refreshed: u64 = conn.get("analytics:jwt:refreshed").await.unwrap_or(0);
        let total_blacklisted: u64 = conn.get("analytics:jwt:blacklisted").await.unwrap_or(0);

        // Count active sessions
        let keys: Vec<String> = conn.keys("session:*").await.unwrap_or_default();
        let active_sessions = keys.len() as u64;

        Ok(TokenAnalytics {
            total_generated,
            total_validated,
            total_refreshed,
            total_blacklisted,
            active_sessions,
        })
    }

    /// Cleanup expired sessions (garbage collection)
    pub async fn cleanup_expired_sessions(&self) -> Result<u32, JwtError> {
        let mut conn = self.redis.clone();
        let keys: Vec<String> = conn.keys("session:*").await.unwrap_or_default();

        let mut cleaned = 0;
        for key in keys {
            let ttl: i64 = conn.ttl(&key).await.unwrap_or(-2);
            if ttl == -2 {
                // Key doesn't exist or expired
                conn.del(&key).await?;
                cleaned += 1;
            }
        }

        if cleaned > 0 {
            info!(count = cleaned, "Expired sessions cleaned up");
        }

        Ok(cleaned)
    }

    /// Rotate encryption keys
    pub async fn rotate_keys(&self, new_key: String) -> Result<(), JwtError> {
        let mut key_rotation = self.key_rotation.write().await;
        key_rotation.rotate(new_key);

        info!(
            next_rotation = key_rotation.next_rotation,
            "Keys rotated successfully"
        );

        Ok(())
    }

    /// Check if keys should be rotated
    pub async fn check_key_rotation(&self) -> bool {
        let key_rotation = self.key_rotation.read().await;
        key_rotation.should_rotate()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_config() -> JwtConfig {
        JwtConfig {
            secret_key: "test_secret_key_for_testing".to_string(),
            access_token_expiry: Duration::minutes(15),
            refresh_token_expiry: Duration::days(7),
            algorithm: Algorithm::HS256,
            issuer: Some("ArenaX-Test".to_string()),
            audience: Some("ArenaX-Test-API".to_string()),
        }
    }

    #[test]
    fn test_token_type_serialization() {
        let access = TokenType::Access;
        let refresh = TokenType::Refresh;

        assert_eq!(serde_json::to_string(&access).unwrap(), "\"access\"");
        assert_eq!(serde_json::to_string(&refresh).unwrap(), "\"refresh\"");
    }

    #[test]
    fn test_key_rotation_should_rotate() {
        let mut rotation = KeyRotation::new("test_key".to_string());

        // Should not rotate immediately
        assert!(!rotation.should_rotate());

        // Set next rotation to past
        rotation.next_rotation = Utc::now().timestamp() - 1000;
        assert!(rotation.should_rotate());
    }

    #[test]
    fn test_key_rotation_rotate() {
        let mut rotation = KeyRotation::new("old_key".to_string());
        rotation.rotate("new_key".to_string());

        assert_eq!(rotation.current_key, "new_key");
        assert_eq!(rotation.previous_key, Some("old_key".to_string()));
    }

    #[test]
    fn test_jwt_config_default() {
        let config = JwtConfig::default();
        assert_eq!(config.algorithm, Algorithm::HS256);
        assert_eq!(config.access_token_expiry.num_minutes(), 15);
        assert_eq!(config.refresh_token_expiry.num_days(), 7);
    }

    #[test]
    fn test_claims_serialization() {
        let claims = Claims {
            sub: Uuid::new_v4().to_string(),
            exp: Utc::now().timestamp(),
            iat: Utc::now().timestamp(),
            jti: Uuid::new_v4().to_string(),
            token_type: TokenType::Access,
            device_id: Some("device-123".to_string()),
            session_id: Uuid::new_v4().to_string(),
            roles: vec!["user".to_string()],
        };

        let json = serde_json::to_string(&claims).unwrap();
        let deserialized: Claims = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.sub, claims.sub);
        assert_eq!(deserialized.token_type, claims.token_type);
    }
}
