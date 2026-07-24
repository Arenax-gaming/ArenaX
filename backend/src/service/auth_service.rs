use crate::api_error::ApiError;
use crate::auth::jwt_service::{JwtService, RefreshTokenRecord, TokenPair};
use crate::db::DbPool;
use crate::models::user::{AuthResponse, CreateUserRequest, LoginRequest, User, UserProfile};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::Utc;
use tracing::{info, warn};
use uuid::Uuid;

/// Active session info returned by `GET /api/auth/sessions`.
#[derive(Debug, serde::Serialize)]
pub struct ActiveSession {
    pub device_id: Option<String>,
    pub created_at: i64,
    pub last_used_at: i64,
}

impl From<RefreshTokenRecord> for ActiveSession {
    fn from(r: RefreshTokenRecord) -> Self {
        Self {
            device_id: r.device_id,
            created_at: r.created_at,
            last_used_at: r.last_used_at,
        }
    }
}

/// Authentication service.
///
/// Owns the [`JwtService`] so it can perform refresh-token rotation,
/// session listing, and revocation on behalf of HTTP handlers.
#[derive(Clone)]
pub struct AuthService {
    pool: DbPool,
    jwt_service: JwtService,
}

impl AuthService {
    pub fn new(pool: DbPool, jwt_service: JwtService) -> Self {
        Self { pool, jwt_service }
    }

    // ── Registration & Login ─────────────────────────────────────────────────

    /// Register a new user and return a fresh token pair.
    pub async fn register(&self, request: CreateUserRequest) -> Result<AuthResponse, ApiError> {
        if request.username.is_empty() || request.password.is_empty() {
            return Err(ApiError::bad_request("username and password are required"));
        }

        if request.password.len() < 8 {
            return Err(ApiError::bad_request(
                "Password must be at least 8 characters",
            ));
        }

        // Uniqueness check
        let existing = sqlx::query!(
            "SELECT id FROM users WHERE username = $1",
            request.username
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        if existing.is_some() {
            return Err(ApiError::conflict("Username already taken"));
        }

        if let Some(ref email) = request.email {
            let email_exists = sqlx::query!(
                "SELECT id FROM users WHERE email = $1",
                email
            )
            .fetch_optional(&self.pool)
            .await
            .map_err(ApiError::database_error)?;

            if email_exists.is_some() {
                return Err(ApiError::conflict(
                    "User with this email already exists",
                ));
            }
        }

        let password_hash = hash(&request.password, DEFAULT_COST)
            .map_err(|e| ApiError::internal_error(format!("Password hashing failed: {}", e)))?;

        let user_id = Uuid::new_v4();
        let now = Utc::now();

        sqlx::query!(
            r#"
            INSERT INTO users (
                id, username, email, phone_number, password_hash,
                is_active, is_verified, role, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, true, false, 'user', $6, $7)
            "#,
            user_id,
            request.username,
            request.email,
            request.phone_number,
            password_hash,
            now,
            now,
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        let roles = vec!["user".to_string()];
        let token_pair = self
            .jwt_service
            .generate_token_pair(user_id, roles, None)
            .await
            .map_err(|e| ApiError::internal_error(format!("Token generation failed: {}", e)))?;

        info!(user_id = %user_id, username = %request.username, "User registered");

        Ok(AuthResponse {
            token: token_pair.access_token,
            refresh_token: token_pair.refresh_token,
            user: UserProfile {
                id: user_id,
                username: request.username,
                email: request.email,
                display_name: None,
                avatar_url: None,
                is_verified: false,
                created_at: now,
                skill_score: None,
                fair_play_score: None,
                is_bad_actor: None,
            },
        })
    }

    /// Authenticate a user and return a fresh token pair.
    pub async fn login(&self, request: LoginRequest) -> Result<AuthResponse, ApiError> {
        let user = sqlx::query_as!(
            User,
            r#"
            SELECT id, username, email, phone_number, display_name, avatar_url, bio,
                   country_code, is_verified, is_active, role, created_at, updated_at,
                   last_login_at, password_hash, profile_image_url, reputation_score,
                   stellar_account_id, stellar_public_key, total_earnings, is_banned,
                   banned_until, device_fingerprint
            FROM users
            WHERE email = $1
            "#,
            request.email,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(ApiError::database_error)?
        .ok_or_else(|| ApiError::unauthorized("Invalid credentials"))?;

        if !user.is_active {
            return Err(ApiError::forbidden("Account is deactivated"));
        }

        let password_hash = user
            .password_hash
            .as_deref()
            .ok_or_else(|| ApiError::unauthorized("Invalid credentials"))?;

        let valid = verify(&request.password, password_hash)
            .map_err(|e| ApiError::internal_error(format!("Password check failed: {}", e)))?;

        if !valid {
            return Err(ApiError::unauthorized("Invalid credentials"));
        }

        sqlx::query!(
            "UPDATE users SET last_login_at = $1 WHERE id = $2",
            Utc::now(),
            user.id
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        let roles = vec!["user".to_string()];
        let token_pair = self
            .jwt_service
            .generate_token_pair(user.id, roles, None)
            .await
            .map_err(|e| ApiError::internal_error(format!("Token generation failed: {}", e)))?;

        info!(user_id = %user.id, "User logged in");

        Ok(AuthResponse {
            token: token_pair.access_token,
            refresh_token: token_pair.refresh_token,
            user: UserProfile {
                id: user.id,
                username: user.username,
                email: user.email,
                display_name: user.display_name,
                avatar_url: user.avatar_url,
                is_verified: user.is_verified,
                created_at: user.created_at,
                skill_score: None,
                fair_play_score: None,
                is_bad_actor: None,
            },
        })
    }

    // ── Token operations ─────────────────────────────────────────────────────

    /// Verify a JWT access token and return the subject user ID.
    pub async fn verify_token(&self, token: &str) -> Result<Uuid, ApiError> {
        let claims = self
            .jwt_service
            .validate_token(token)
            .await
            .map_err(|e| ApiError::unauthorized(format!("Token validation failed: {}", e)))?;

        Uuid::parse_str(&claims.sub)
            .map_err(|e| ApiError::internal_error(format!("Invalid user ID in token: {}", e)))
    }

    /// Rotate refresh token: invalidate the old one, issue a fresh pair.
    ///
    /// Replaying the old refresh token after a successful rotation returns
    /// 401 because the Redis record has been deleted.
    pub async fn refresh_token(&self, refresh_token: &str) -> Result<TokenPair, ApiError> {
        self.jwt_service
            .refresh_token(refresh_token)
            .await
            .map_err(|e| ApiError::unauthorized(format!("Token refresh failed: {}", e)))
    }

    /// Blacklist the supplied access token (logout).
    pub async fn logout(&self, token: &str) -> Result<(), ApiError> {
        self.jwt_service
            .blacklist_token(token, "User logout")
            .await
            .map_err(|e| ApiError::internal_error(format!("Logout failed: {}", e)))?;

        info!("User logged out");
        Ok(())
    }

    // ── Session management ───────────────────────────────────────────────────

    /// Return the list of active refresh-token sessions for a user.
    ///
    /// Each entry carries device info and the timestamp the token was last
    /// used, so the user can identify and revoke unfamiliar sessions.
    pub async fn get_sessions(&self, user_id: Uuid) -> Result<Vec<ActiveSession>, ApiError> {
        let records = self
            .jwt_service
            .get_active_refresh_tokens(user_id)
            .await
            .map_err(|e| ApiError::internal_error(format!("Session fetch failed: {}", e)))?;

        Ok(records.into_iter().map(ActiveSession::from).collect())
    }

    /// Invalidate **all** refresh tokens and access-token sessions for a user.
    ///
    /// Used by `POST /api/auth/revoke-sessions` and internally during
    /// password change.
    pub async fn revoke_all_sessions(&self, user_id: Uuid) -> Result<u32, ApiError> {
        let count = self
            .jwt_service
            .revoke_user_sessions(user_id)
            .await
            .map_err(|e| ApiError::internal_error(format!("Session revocation failed: {}", e)))?;

        info!(user_id = %user_id, count, "All sessions revoked");
        Ok(count)
    }

    // ── User helpers ─────────────────────────────────────────────────────────

    /// Fetch a user record by ID (used by `GET /api/auth/me`).
    pub async fn get_user(&self, user_id: Uuid) -> Result<User, ApiError> {
        sqlx::query_as!(
            User,
            r#"
            SELECT id, username, email, phone_number, display_name, avatar_url, bio,
                   country_code, is_verified, is_active, role, created_at, updated_at,
                   last_login_at, password_hash, profile_image_url, reputation_score,
                   stellar_account_id, stellar_public_key, total_earnings, is_banned,
                   banned_until, device_fingerprint
            FROM users
            WHERE id = $1
            "#,
            user_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(ApiError::database_error)?
        .ok_or_else(|| ApiError::not_found("User not found"))
    }

    /// Change a user's password and immediately revoke all existing sessions.
    pub async fn change_password(
        &self,
        user_id: Uuid,
        old_password: &str,
        new_password: &str,
    ) -> Result<(), ApiError> {
        if new_password.len() < 8 {
            return Err(ApiError::bad_request(
                "Password must be at least 8 characters",
            ));
        }

        let user = self.get_user(user_id).await?;

        let current_hash = user
            .password_hash
            .as_deref()
            .ok_or_else(|| ApiError::unauthorized("No password set"))?;

        let valid = verify(old_password, current_hash)
            .map_err(|e| ApiError::internal_error(format!("Password check failed: {}", e)))?;

        if !valid {
            return Err(ApiError::unauthorized("Current password is incorrect"));
        }

        let new_hash = hash(new_password, DEFAULT_COST)
            .map_err(|e| ApiError::internal_error(format!("Password hashing failed: {}", e)))?;

        sqlx::query!(
            "UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3",
            new_hash,
            Utc::now(),
            user_id,
        )
        .execute(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        // Security: invalidate all sessions so the old password can't be used
        // to keep a session alive.
        self.revoke_all_sessions(user_id).await?;

        info!(user_id = %user_id, "Password changed");
        Ok(())
    }
}
