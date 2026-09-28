use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub phone_number: Option<String>,
    pub username: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub country_code: Option<String>,
    pub is_verified: bool,
    pub is_active: bool,
    pub role: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
    // Extended fields (may not be in all DB versions)
    pub password_hash: Option<String>,
    pub profile_image_url: Option<String>,
    pub reputation_score: Option<i32>,
    pub stellar_account_id: Option<Uuid>,
    pub stellar_public_key: Option<String>,
    pub total_earnings: Option<rust_decimal::Decimal>,
    pub is_banned: Option<bool>,
    pub banned_until: Option<DateTime<Utc>>,
    pub device_fingerprint: Option<String>,
}

impl User {
    /// Encrypt all sensitive PII fields (email, phone_number, device_fingerprint) in place.
    pub fn encrypt_pii(&mut self, actor_id: Option<&str>) -> Result<(), crate::security::EncryptionError> {
        let protector = &crate::security::encryption::GLOBAL_PROTECTOR;
        if let Some(ref phone) = self.phone_number {
            if !phone.starts_with("enc:") {
                self.phone_number = Some(protector.encrypt_str(phone, "user.phone_number", actor_id)?);
            }
        }
        if let Some(ref email) = self.email {
            if !email.starts_with("enc:") {
                self.email = Some(protector.encrypt_str(email, "user.email", actor_id)?);
            }
        }
        if let Some(ref fp) = self.device_fingerprint {
            if !fp.starts_with("enc:") {
                self.device_fingerprint = Some(protector.encrypt_str(fp, "user.device_fingerprint", actor_id)?);
            }
        }
        Ok(())
    }

    /// Decrypt all sensitive PII fields in place.
    pub fn decrypt_pii(&mut self, actor_id: Option<&str>) -> Result<(), crate::security::EncryptionError> {
        let protector = &crate::security::encryption::GLOBAL_PROTECTOR;
        if let Some(ref phone) = self.phone_number {
            if phone.starts_with("enc:") {
                self.phone_number = Some(protector.decrypt_str(phone, "user.phone_number", actor_id)?);
            }
        }
        if let Some(ref email) = self.email {
            if email.starts_with("enc:") {
                self.email = Some(protector.decrypt_str(email, "user.email", actor_id)?);
            }
        }
        if let Some(ref fp) = self.device_fingerprint {
            if fp.starts_with("enc:") {
                self.device_fingerprint = Some(protector.decrypt_str(fp, "user.device_fingerprint", actor_id)?);
            }
        }
        Ok(())
    }

    /// Re-encrypt PII fields to the latest active key version.
    pub fn reencrypt_pii(&mut self, actor_id: Option<&str>) -> Result<(), crate::security::EncryptionError> {
        let protector = &crate::security::encryption::GLOBAL_PROTECTOR;
        if let Some(ref phone) = self.phone_number {
            if phone.starts_with("enc:") {
                self.phone_number = Some(protector.reencrypt(phone, "user.phone_number", actor_id)?);
            }
        }
        if let Some(ref email) = self.email {
            if email.starts_with("enc:") {
                self.email = Some(protector.reencrypt(email, "user.email", actor_id)?);
            }
        }
        if let Some(ref fp) = self.device_fingerprint {
            if fp.starts_with("enc:") {
                self.device_fingerprint = Some(protector.reencrypt(fp, "user.device_fingerprint", actor_id)?);
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub email: Option<String>,
    pub phone_number: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    pub token: String,
    pub refresh_token: String,
    pub user: UserProfile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub is_verified: bool,
    pub created_at: DateTime<Utc>,
    // Reputation fields
    pub skill_score: Option<i32>,
    pub fair_play_score: Option<i32>,
    pub is_bad_actor: Option<bool>,
}
