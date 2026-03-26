#![allow(dead_code)]

use crate::api_error::ApiError;
use crate::auth::jwt_service::{JwtService, TokenPair};
use crate::db::DbPool;
use crate::models::user::{AuthResponse, CreateUserRequest, LoginRequest, User, UserProfile};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::Utc;
use tracing::info;
use uuid::Uuid;

/// Authentication Service with JWT integration
#[derive(Clone)]
pub struct AuthService {
    pool: DbPool,
    jwt_service: JwtService,
}

impl AuthService {
    pub fn new(pool: DbPool, jwt_service: JwtService) -> Self {
        Self { pool, jwt_service }
    }

    /// Register a new user
    pub async fn register(&self, request: CreateUserRequest) -> Result<AuthResponse, ApiError> {
        if request.username.is_empty() || request.password.is_empty() {
            return Err(ApiError::bad_request("Username and password are required"));
        }

        if request.password.len() < 8 {
            return Err(ApiError::bad_request(
                "Password must be at least 8 characters",
            ));
        }

        // Check if user already exists
        let existing = sqlx::query("SELECT id FROM users WHERE email = $1 OR username = $2")
            .bind(&request.email)
            .bind(&request.username)
            .fetch_optional(&self.pool)
            .await
            .map_err(ApiError::database_error)?;

        if existing.is_some() {
            return Err(ApiError::bad_request(
                "User with this email or username already exists",
            ));
        }

        // Hash password
        let password_hash = hash(&request.password, DEFAULT_COST)
            .map_err(|e| ApiError::internal_error(format!("Password hashing failed: {}", e)))?;

        // Create user
        let user_id = Uuid::new_v4();
        let now = Utc::now();

        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (
                id, username, email, phone_number, password_hash, is_active, is_verified,
                role, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, true, false, 'user', $6, $7)
            RETURNING *
            "#,
        )
        .bind(user_id)
        .bind(&request.username)
        .bind(&request.email)
        .bind(&request.phone_number)
        .bind(&password_hash)
        .bind(now)
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::database_error)?;

        // Generate JWT tokens
        let roles = vec!["user".to_string()];
        let token_pair = self
            .jwt_service
            .generate_token_pair(user.id, roles, None)
            .await
            .map_err(|e| ApiError::internal_error(format!("Token generation failed: {}", e)))?;

        info!(user_id = %user.id, username = %user.username, "User registered successfully");

        Ok(AuthResponse {
            token: token_pair.access_token,
            refresh_token: token_pair.refresh_token,
            user: UserProfile {
                id: user.id,
                username: user.username.clone(),
                email: user.email.clone(),
                display_name: user.display_name.clone(),
                avatar_url: user.avatar_url.clone(),
                is_verified: user.is_verified,
                created_at: user.created_at,
            },
        })
    }

    /// Login user and return JWT tokens
    pub async fn login(&self, request: LoginRequest) -> Result<AuthResponse, ApiError> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
            .bind(&request.email)
            .fetch_optional(&self.pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or_else(|| ApiError::unauthorized("Invalid email or password"))?;

        if !user.is_active {
            return Err(ApiError::forbidden("Account is deactivated"));
        }

        // Verify password
        let pw_hash = user
            .password_hash
            .as_deref()
            .ok_or_else(|| ApiError::internal_error("User has no password set"))?;

        let valid = verify(&request.password, pw_hash).map_err(|e| {
            ApiError::internal_error(format!("Password verification failed: {}", e))
        })?;

        if !valid {
            return Err(ApiError::unauthorized("Invalid email or password"));
        }

        // Update last login
        sqlx::query("UPDATE users SET last_login_at = $1 WHERE id = $2")
            .bind(Utc::now())
            .bind(user.id)
            .execute(&self.pool)
            .await
            .map_err(ApiError::database_error)?;

        // Generate JWT tokens
        let roles = vec![user.role.clone()];
        let token_pair = self
            .jwt_service
            .generate_token_pair(user.id, roles, None)
            .await
            .map_err(|e| ApiError::internal_error(format!("Token generation failed: {}", e)))?;

        info!(user_id = %user.id, username = %user.username, "User logged in successfully");

        Ok(AuthResponse {
            token: token_pair.access_token,
            refresh_token: token_pair.refresh_token,
            user: UserProfile {
                id: user.id,
                username: user.username.clone(),
                email: user.email.clone(),
                display_name: user.display_name.clone(),
                avatar_url: user.avatar_url.clone(),
                is_verified: user.is_verified,
                created_at: user.created_at,
            },
        })
    }

    /// Verify JWT token and return user ID
    pub async fn verify_token(&self, token: &str) -> Result<Uuid, ApiError> {
        let claims = self
            .jwt_service
            .validate_token(token)
            .await
            .map_err(|e| ApiError::unauthorized(format!("Token validation failed: {}", e)))?;

        let user_id = Uuid::parse_str(&claims.sub)
            .map_err(|e| ApiError::internal_error(format!("Invalid user ID in token: {}", e)))?;

        Ok(user_id)
    }

    /// Refresh access token
    pub async fn refresh_token(&self, refresh_token: &str) -> Result<TokenPair, ApiError> {
        self.jwt_service
            .refresh_token(refresh_token)
            .await
            .map_err(|e| ApiError::unauthorized(format!("Token refresh failed: {}", e)))
    }

    /// Logout user (blacklist token)
    pub async fn logout(&self, token: &str) -> Result<(), ApiError> {
        self.jwt_service
            .blacklist_token(token, "User logout")
            .await
            .map_err(|e| ApiError::internal_error(format!("Logout failed: {}", e)))?;

        Ok(())
    }

    /// Revoke all user sessions
    pub async fn revoke_all_sessions(&self, user_id: Uuid) -> Result<u32, ApiError> {
        let count = self
            .jwt_service
            .revoke_user_sessions(user_id)
            .await
            .map_err(|e| ApiError::internal_error(format!("Session revocation failed: {}", e)))?;

        info!(user_id = %user_id, count = count, "All user sessions revoked");

        Ok(count)
    }

    /// Get user by ID
    pub async fn get_user(&self, user_id: Uuid) -> Result<User, ApiError> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or_else(|| ApiError::not_found("User not found"))
    }

    /// Change user password
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

        let pw_hash = user
            .password_hash
            .as_deref()
            .ok_or_else(|| ApiError::internal_error("User has no password set"))?;

        let valid = verify(old_password, pw_hash).map_err(|e| {
            ApiError::internal_error(format!("Password verification failed: {}", e))
        })?;

        if !valid {
            return Err(ApiError::unauthorized("Current password is incorrect"));
        }

        let new_hash = hash(new_password, DEFAULT_COST)
            .map_err(|e| ApiError::internal_error(format!("Password hashing failed: {}", e)))?;

        sqlx::query("UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3")
            .bind(&new_hash)
            .bind(Utc::now())
            .bind(user_id)
            .execute(&self.pool)
            .await
            .map_err(ApiError::database_error)?;

        // Revoke all existing sessions for security
        self.revoke_all_sessions(user_id).await?;

        info!(user_id = %user_id, "Password changed successfully");

        Ok(())
    }
}
