use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub phone_number: String,
    pub username: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub is_verified: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
    pub device_fingerprint: Option<String>,
    pub stellar_account_id: Option<String>,
    pub stellar_public_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserProfile {
    pub id: Uuid,
    pub user_id: Uuid,
    pub display_name: String,
    pub bio: Option<String>,
    pub location: Option<String>,
    pub date_of_birth: Option<DateTime<Utc>>,
    pub preferred_games: Option<String>, // JSON array
    pub social_links: Option<String>, // JSON object
    pub privacy_settings: Option<String>, // JSON object
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token: String,
    pub expires_at: DateTime<Utc>,
    pub device_info: Option<String>, // JSON object
    pub ip_address: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: DateTime<Utc>,
}

// DTOs for API requests/responses
#[derive(Debug, Serialize, Deserialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub is_verified: bool,
    pub stellar_public_key: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateProfileRequest {
    pub username: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub location: Option<String>,
    pub preferred_games: Option<Vec<String>>,
}
