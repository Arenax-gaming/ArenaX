#![allow(dead_code)]
use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use redis::{AsyncCommands, Client as RedisClient};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{error, info, warn};
use uuid::Uuid;

// JWT Configuration
#[derive(Clone, Debug)]
pub struct JwtConfig {
    pub access_token_expiry: Duration,
    pub refresh_token_expiry: Duration,
    pub algorithm: Algorithm,
    pub issuer: String,
    pub audience: String,
    pub max_refresh_count: u32,
}

impl Default for JwtConfig {
    fn default() -> Self {
        Self {
            access_token_expiry: Duration::hours(1),
            refresh_token_expiry: Duration::days(7),
            algorithm: Algorithm::HS256,
            issuer: "arenax".to_string(),
            audience: "arenax-users".to_string(),
            max_refresh_count: 5,
        }
    }
}

// JWT Error types
#[derive(Error, Debug)]
pub enum JwtError {
    #[error("Invalid token: {0}")]
    InvalidToken(String),

    #[error("Token expired")]
    TokenExpired,

    #[error("Token not found")]
    TokenNotFound,

    #[error("Token blacklisted")]
    TokenBlacklisted,

    #[error("Invalid claims: {0}")]
    InvalidClaims(String),

    #[error("Refresh token expired")]
    RefreshTokenExpired,

    #[error("Max refresh count exceeded")]
    MaxRefreshExceeded,

    #[error("Redis error: {0}")]
    RedisError(#[from] redis::RedisError),

    #[error("JWT encoding error: {0}")]
    EncodingError(#[from] jsonwebtoken::errors::Error),

    #[error("Key rotation error: {0}")]
    KeyRotationError(String),

    #[error("Session not found")]
    SessionNotFound,
}

// JWT Claims structure
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,               // Subject (user ID)
    pub exp: i64,                  // Expiration time
    pub iat: i64,                  // Issued at
    pub iss: String,               // Issuer
    pub aud: String,               // Audience
    pub jti: String,               // JWT ID
    pub token_type: TokenType,     // Token type
    pub session_id: String,        // Session identifier
    pub device_id: Option<String>, // Device identifier
    pub refresh_count: u32,        // Number of times refreshed
    pub permissions: Vec<String>,  // User permissions
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum TokenType {
    Access,
    Refresh,
}

// Token pair for authentication
#[derive(Debug, Serialize, Deserialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub token_type: String,
}

// Session information
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionInfo {
    pub session_id: String,
    pub user_id: String,
    pub device_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_accessed: DateTime<Utc>,
    pub refresh_count: u32,
    pub is_active: bool,
}

// Key rotation management
#[derive(Debug, Clone)]
pub struct KeyRotation {
    current_key: String,
    previous_key: Option<String>,
    rotation_schedule: Duration,
    last_rotation: DateTime<Utc>,
}

impl KeyRotation {
    pub fn new(initial_key: String) -> Self {
        Self {
            current_key: initial_key,
            previous_key: None,
            rotation_schedule: Duration::days(30),
            last_rotation: Utc::now(),
        }
    }

    pub fn should_rotate(&self) -> bool {
        Utc::now() - self.last_rotation > self.rotation_schedule
    }

    pub fn rotate(&mut self, new_key: String) {
        self.previous_key = Some(self.current_key.clone());
        self.current_key = new_key;
        self.last_rotation = Utc::now();
    }

    pub fn get_current_key(&self) -> &str {
        &self.current_key
    }

    pub fn get_previous_key(&self) -> Option<&str> {
        self.previous_key.as_deref()
    }
}

// Token analytics
#[derive(Debug, Serialize, Deserialize)]
pub struct TokenAnalytics {
    pub total_tokens_issued: u64,
    pub active_sessions: u64,
    pub blacklisted_tokens: u64,
    pub refresh_attempts: u64,
    pub failed_validations: u64,
    pub last_updated: DateTime<Utc>,
}

// Main JWT Service
pub struct JwtService {
    secret_key: String,
    redis_client: RedisClient,
    config: JwtConfig,
    key_rotation: KeyRotation,
    analytics: TokenAnalytics,
}

impl JwtService {
    /// Create a new JWT service instance
    pub fn new(secret_key: String, redis_url: &str, config: Option<JwtConfig>) -> Result<Self> {
        let redis_client = RedisClient::open(redis_url)?;
        let config = config.unwrap_or_default();
        let key_rotation = KeyRotation::new(secret_key.clone());
        let analytics = TokenAnalytics {
            total_tokens_issued: 0,
            active_sessions: 0,
            blacklisted_tokens: 0,
            refresh_attempts: 0,
            failed_validations: 0,
            last_updated: Utc::now(),
        };

        Ok(Self {
            secret_key,
            redis_client,
            config,
            key_rotation,
            analytics,
        })
    }

    /// Generate access token
    pub fn generate_access_token(&mut self, claims: &Claims) -> Result<String, JwtError> {
        let mut access_claims = claims.clone();
        access_claims.token_type = TokenType::Access;
        access_claims.exp = (Utc::now() + self.config.access_token_expiry).timestamp();
        access_claims.iat = Utc::now().timestamp();
        access_claims.iss = self.config.issuer.clone();
        access_claims.aud = self.config.audience.clone();
        access_claims.jti = Uuid::new_v4().to_string();

        let encoding_key = EncodingKey::from_secret(self.key_rotation.get_current_key().as_bytes());
        let header = Header::new(self.config.algorithm);

        let token = encode(&header, &access_claims, &encoding_key)?;

        // Update analytics
        self.analytics.total_tokens_issued += 1;
        self.analytics.last_updated = Utc::now();

        info!("Generated access token for user: {}", claims.sub);
        Ok(token)
    }

    /// Generate refresh token
    pub fn generate_refresh_token(&mut self, claims: &Claims) -> Result<String, JwtError> {
        let mut refresh_claims = claims.clone();
        refresh_claims.token_type = TokenType::Refresh;
        refresh_claims.exp = (Utc::now() + self.config.refresh_token_expiry).timestamp();
        refresh_claims.iat = Utc::now().timestamp();
        refresh_claims.iss = self.config.issuer.clone();
        refresh_claims.aud = self.config.audience.clone();
        refresh_claims.jti = Uuid::new_v4().to_string();

        let encoding_key = EncodingKey::from_secret(self.key_rotation.get_current_key().as_bytes());
        let header = Header::new(self.config.algorithm);

        let token = encode(&header, &refresh_claims, &encoding_key)?;

        info!("Generated refresh token for user: {}", claims.sub);
        Ok(token)
    }

    /// Generate token pair (access + refresh)
    pub fn generate_token_pair(
        &mut self,
        user_id: &str,
        device_id: Option<String>,
        permissions: Vec<String>,
    ) -> Result<TokenPair, JwtError> {
        let session_id = Uuid::new_v4().to_string();

        let claims = Claims {
            sub: user_id.to_string(),
            exp: 0, // Will be set in generate functions
            iat: Utc::now().timestamp(),
            iss: self.config.issuer.clone(),
            aud: self.config.audience.clone(),
            jti: Uuid::new_v4().to_string(),
            token_type: TokenType::Access,
            session_id: session_id.clone(),
            device_id: device_id.clone(),
            refresh_count: 0,
            permissions,
        };

        let access_token = self.generate_access_token(&claims)?;
        let refresh_token = self.generate_refresh_token(&claims)?;

        Ok(TokenPair {
            access_token,
            refresh_token,
            expires_in: self.config.access_token_expiry.num_seconds(),
            token_type: "Bearer".to_string(),
        })
    }

    /// Validate token
    pub async fn validate_token(&mut self, token: &str) -> Result<Claims, JwtError> {
        // Check if token is blacklisted first
        if self.is_token_blacklisted(token).await? {
            self.analytics.failed_validations += 1;
            return Err(JwtError::TokenBlacklisted);
        }

        let mut validation = Validation::new(self.config.algorithm);
        validation.set_issuer(&[&self.config.issuer]);
        validation.set_audience(&[&self.config.audience]);

        // Try current key first
        let decoding_key = DecodingKey::from_secret(self.key_rotation.get_current_key().as_bytes());
        let result = decode::<Claims>(token, &decoding_key, &validation);

        let claims = match result {
            Ok(token_data) => token_data.claims,
            Err(_) => {
                // Try previous key if rotation happened
                if let Some(previous_key) = self.key_rotation.get_previous_key() {
                    let prev_decoding_key = DecodingKey::from_secret(previous_key.as_bytes());
                    let prev_result = decode::<Claims>(token, &prev_decoding_key, &validation);
                    match prev_result {
                        Ok(token_data) => token_data.claims,
                        Err(err) => {
                            self.analytics.failed_validations += 1;
                            error!("Token validation failed: {:?}", err);
                            return Err(JwtError::InvalidToken(err.to_string()));
                        }
                    }
                } else {
                    self.analytics.failed_validations += 1;
                    return Err(JwtError::InvalidToken("Invalid token".to_string()));
                }
            }
        };

        // Check expiration
        let now = Utc::now().timestamp();
        if claims.exp < now {
            self.analytics.failed_validations += 1;
            return Err(JwtError::TokenExpired);
        }

        // Update session last accessed time
        if let Err(e) = self.update_session_access(&claims.session_id).await {
            warn!("Failed to update session access time: {:?}", e);
        }

        Ok(claims)
    }

    /// Refresh token
    pub async fn refresh_token(&mut self, refresh_token: &str) -> Result<TokenPair, JwtError> {
        self.analytics.refresh_attempts += 1;

        // Validate refresh token
        let refresh_claims = self.validate_token(refresh_token).await?;

        // Check if it's actually a refresh token
        if refresh_claims.token_type != TokenType::Refresh {
            return Err(JwtError::InvalidToken("Not a refresh token".to_string()));
        }

        // Check refresh count limit
        if refresh_claims.refresh_count >= self.config.max_refresh_count {
            // Blacklist the token and invalidate session
            self.blacklist_token(refresh_token).await?;
            return Err(JwtError::MaxRefreshExceeded);
        }

        // Blacklist old refresh token
        self.blacklist_token(refresh_token).await?;

        // Create new claims with incremented refresh count
        let new_claims = Claims {
            refresh_count: refresh_claims.refresh_count + 1,
            ..refresh_claims
        };

        // Generate new token pair
        let access_token = self.generate_access_token(&new_claims)?;
        let new_refresh_token = self.generate_refresh_token(&new_claims)?;

        Ok(TokenPair {
            access_token,
            refresh_token: new_refresh_token,
            expires_in: self.config.access_token_expiry.num_seconds(),
            token_type: "Bearer".to_string(),
        })
    }

    /// Blacklist a token
    pub async fn blacklist_token(&mut self, token: &str) -> Result<(), JwtError> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;

        // Extract JTI from token for efficient storage
        let jti = self.extract_jti_from_token(token)?;

        // Store in Redis with expiration matching token expiration
        let key = format!("blacklisted:{}", jti);
        let expiry = self.config.refresh_token_expiry.num_seconds() as u64;

        conn.set_ex::<_, _, ()>(&key, "1", expiry).await?;

        self.analytics.blacklisted_tokens += 1;
        info!("Token blacklisted: {}", jti);

        Ok(())
    }

    /// Check if token is blacklisted
    pub async fn is_token_blacklisted(&self, token: &str) -> Result<bool, JwtError> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;

        let jti = self.extract_jti_from_token(token)?;
        let key = format!("blacklisted:{}", jti);

        let result: Option<String> = conn.get(&key).await?;
        Ok(result.is_some())
    }

    /// Create or update session
    pub async fn create_session(&mut self, session_info: &SessionInfo) -> Result<(), JwtError> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;

        let key = format!("session:{}", session_info.session_id);
        let session_data = serde_json::to_string(session_info)
            .map_err(|e| JwtError::InvalidClaims(e.to_string()))?;

        let expiry = self.config.refresh_token_expiry.num_seconds() as u64;
        conn.set_ex::<_, _, ()>(&key, session_data, expiry).await?;

        self.analytics.active_sessions += 1;

        Ok(())
    }

    /// Get session information
    pub async fn get_session(&self, session_id: &str) -> Result<SessionInfo, JwtError> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;

        let key = format!("session:{}", session_id);
        let session_data: Option<String> = conn.get(&key).await?;

        match session_data {
            Some(data) => {
                let session: SessionInfo = serde_json::from_str(&data)
                    .map_err(|e| JwtError::InvalidClaims(e.to_string()))?;
                Ok(session)
            }
            None => Err(JwtError::SessionNotFound),
        }
    }

    /// Update session last accessed time
    pub async fn update_session_access(&self, session_id: &str) -> Result<(), JwtError> {
        let mut session = self.get_session(session_id).await?;
        session.last_accessed = Utc::now();

        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let key = format!("session:{}", session_id);
        let session_data =
            serde_json::to_string(&session).map_err(|e| JwtError::InvalidClaims(e.to_string()))?;

        let expiry = self.config.refresh_token_expiry.num_seconds() as u64;
        conn.set_ex::<_, _, ()>(&key, session_data, expiry).await?;

        Ok(())
    }

    /// Invalidate session
    pub async fn invalidate_session(&mut self, session_id: &str) -> Result<(), JwtError> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;

        let key = format!("session:{}", session_id);
        conn.del::<_, ()>(&key).await?;

        self.analytics.active_sessions = self.analytics.active_sessions.saturating_sub(1);

        info!("Session invalidated: {}", session_id);
        Ok(())
    }

    /// Get user sessions
    pub async fn get_user_sessions(&self, user_id: &str) -> Result<Vec<SessionInfo>, JwtError> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;

        let pattern = "session:*";
        let keys: Vec<String> = conn.keys(pattern).await?;

        let mut user_sessions = Vec::new();

        for key in keys {
            if let Ok(session_data) = conn.get::<String, String>(key).await {
                if let Ok(session) = serde_json::from_str::<SessionInfo>(&session_data) {
                    if session.user_id == user_id && session.is_active {
                        user_sessions.push(session);
                    }
                }
            }
        }

        Ok(user_sessions)
    }

    /// Invalidate all user sessions
    pub async fn invalidate_all_user_sessions(&mut self, user_id: &str) -> Result<u32, JwtError> {
        let sessions = self.get_user_sessions(user_id).await?;
        let mut invalidated_count = 0;

        for session in sessions {
            if let Ok(()) = self.invalidate_session(&session.session_id).await {
                invalidated_count += 1;
            }
        }

        info!(
            "Invalidated {} sessions for user: {}",
            invalidated_count, user_id
        );
        Ok(invalidated_count)
    }

    /// Rotate encryption keys
    pub fn rotate_keys(&mut self, new_key: String) -> Result<(), JwtError> {
        if new_key.is_empty() {
            return Err(JwtError::KeyRotationError("Empty key provided".to_string()));
        }

        self.key_rotation.rotate(new_key);
        info!("JWT keys rotated successfully");

        Ok(())
    }

    /// Check if keys should be rotated
    pub fn should_rotate_keys(&self) -> bool {
        self.key_rotation.should_rotate()
    }

    /// Get token analytics
    pub fn get_analytics(&self) -> &TokenAnalytics {
        &self.analytics
    }

    /// Update analytics from Redis
    pub async fn refresh_analytics(&mut self) -> Result<(), JwtError> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;

        // Count active sessions
        let session_keys: Vec<String> = conn.keys("session:*").await?;
        self.analytics.active_sessions = session_keys.len() as u64;

        // Count blacklisted tokens
        let blacklisted_keys: Vec<String> = conn.keys("blacklisted:*").await?;
        self.analytics.blacklisted_tokens = blacklisted_keys.len() as u64;

        self.analytics.last_updated = Utc::now();

        Ok(())
    }

    /// Cleanup expired tokens and sessions
    pub async fn cleanup_expired(&mut self) -> Result<u32, JwtError> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;

        // Redis automatically handles expiration, but we can clean up manually
        let mut cleaned = 0;

        // Clean up expired sessions
        let session_keys: Vec<String> = conn.keys("session:*").await?;
        for key in session_keys {
            let key_clone = key.clone();
            if let Ok(session_data) = conn.get::<String, String>(key).await {
                if let Ok(session) = serde_json::from_str::<SessionInfo>(&session_data) {
                    let age = Utc::now() - session.last_accessed;
                    if age > self.config.refresh_token_expiry {
                        conn.del::<String, ()>(key_clone).await?;
                        cleaned += 1;
                    }
                }
            }
        }

        info!("Cleaned up {} expired sessions", cleaned);
        Ok(cleaned)
    }

    // Helper method to extract JTI from token
    pub fn extract_jti_from_token(&self, token: &str) -> Result<String, JwtError> {
        // This is a simplified extraction - in production, you might want more robust parsing
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 {
            return Err(JwtError::InvalidToken("Invalid token format".to_string()));
        }

        // For now, we'll decode the token to get JTI
        // In a real implementation, you might cache JTI during token creation
        let validation = Validation::new(self.config.algorithm);
        let decoding_key = DecodingKey::from_secret(self.key_rotation.get_current_key().as_bytes());

        match decode::<Claims>(token, &decoding_key, &validation) {
            Ok(token_data) => Ok(token_data.claims.jti),
            Err(_) => {
                // Try previous key
                if let Some(previous_key) = self.key_rotation.get_previous_key() {
                    let prev_decoding_key = DecodingKey::from_secret(previous_key.as_bytes());
                    match decode::<Claims>(token, &prev_decoding_key, &validation) {
                        Ok(token_data) => Ok(token_data.claims.jti),
                        Err(_) => Err(JwtError::InvalidToken("Cannot extract JTI".to_string())),
                    }
                } else {
                    Err(JwtError::InvalidToken("Cannot extract JTI".to_string()))
                }
            }
        }
    }
}

// Security policies implementation
impl JwtService {
    /// Enforce security policies on token generation
    pub fn enforce_security_policies(&self, claims: &Claims) -> Result<(), JwtError> {
        // Check session duration
        let session_duration = Duration::seconds(claims.exp - claims.iat);
        if session_duration > Duration::hours(24) {
            return Err(JwtError::InvalidClaims("Session too long".to_string()));
        }

        // Validate permissions
        if claims.permissions.is_empty() {
            warn!(
                "Token generated with no permissions for user: {}",
                claims.sub
            );
        }

        // Check refresh count
        if claims.refresh_count > self.config.max_refresh_count {
            return Err(JwtError::MaxRefreshExceeded);
        }

        Ok(())
    }

    /// Monitor suspicious activity
    pub async fn monitor_suspicious_activity(&self, user_id: &str) -> Result<bool, JwtError> {
        let sessions = self.get_user_sessions(user_id).await?;

        // Check for too many concurrent sessions
        if sessions.len() > 10 {
            warn!(
                "User {} has {} concurrent sessions",
                user_id,
                sessions.len()
            );
            return Ok(true);
        }

        // Check for rapid token refresh
        let recent_sessions = sessions
            .iter()
            .filter(|s| Utc::now() - s.last_accessed < Duration::minutes(5))
            .count();

        if recent_sessions > 5 {
            warn!(
                "User {} has {} recent sessions (potential token abuse)",
                user_id, recent_sessions
            );
            return Ok(true);
        }

        Ok(false)
    }
}
