use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use validator::Validate;
use rust_decimal::Decimal;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub phone_number: String,
    pub email: Option<String>,
    pub password_hash: Option<String>,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub profile_image_url: Option<String>,
    pub bio: Option<String>,
    pub country_code: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
    pub is_verified: bool,
    pub is_active: bool,
    pub is_banned: bool,
    pub banned_until: Option<DateTime<Utc>>,
    pub reputation_score: i32,
    pub total_earnings: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateUserRequest {
    #[validate(length(min = 10, max = 20))]
    pub phone_number: String,
    #[validate(email)]
    pub email: Option<String>,
    pub password: String,
    #[validate(length(min = 3, max = 50))]
    pub username: Option<String>,
    #[validate(length(max = 100))]
    pub display_name: Option<String>,
    pub country_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct UpdateUserRequest {
    #[validate(email)]
    pub email: Option<String>,
    #[validate(length(min = 3, max = 50))]
    pub username: Option<String>,
    #[validate(length(max = 100))]
    pub display_name: Option<String>,
    #[validate(length(max = 500))]
    pub bio: Option<String>,
    pub profile_image_url: Option<String>,
    pub country_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub phone_number: String,
    pub email: Option<String>,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub profile_image_url: Option<String>,
    pub bio: Option<String>,
    pub country_code: Option<String>,
    pub created_at: DateTime<Utc>,
    pub is_verified: bool,
    pub reputation_score: i32,
    pub total_earnings: Decimal,
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            phone_number: user.phone_number,
            email: user.email,
            username: user.username,
            display_name: user.display_name,
            profile_image_url: user.profile_image_url,
            bio: user.bio,
            country_code: user.country_code,
            created_at: user.created_at,
            is_verified: user.is_verified,
            reputation_score: user.reputation_score,
            total_earnings: user.total_earnings,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserStatistics {
    pub id: Uuid,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub reputation_score: i32,
    pub total_earnings: Decimal,
    pub tournaments_participated: Option<i64>,
    pub tournaments_won: Option<i64>,
    pub matches_won: Option<i64>,
    pub matches_played: Option<i64>,
    pub win_rate: Option<Decimal>,
    pub current_balance: Option<Decimal>,
    pub escrow_balance: Option<Decimal>,
}
