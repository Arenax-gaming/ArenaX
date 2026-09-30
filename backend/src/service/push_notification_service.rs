//! Push notification service (#908): Firebase Cloud Messaging integration
//! with per-user topic subscriptions, rich (title + arbitrary data) payloads,
//! delivery tracking, and a fallback to an in-app `notifications` row when a
//! push can't be delivered (no active device, or FCM rejects every token).
//!
//! Auth against FCM's HTTP v1 API uses a Google service-account JSON: we
//! sign a short-lived JWT with its RSA private key (`jsonwebtoken`, already
//! a dependency for our own JWTs) and exchange it for an OAuth2 bearer token
//! at Google's token endpoint. The access token is not cached across calls —
//! this is a one-round-trip-per-send-batch cost, not per-token, and is
//! documented as the one simplification here rather than adding a token
//! cache with its own invalidation edge cases.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

use crate::db::DbPool;

const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
/// FCM's HTTP v1 send endpoint, keyed on the service account's project id.
const FCM_SEND_URL_TEMPLATE: &str = "https://fcm.googleapis.com/v1/projects/{project}/messages:send";
/// FCM's legacy instance-ID API for topic (de)registration. Still the only
/// documented way to bulk (un)subscribe existing tokens to a topic; it
/// accepts the same OAuth2 bearer token as the v1 send API.
const IID_BATCH_ADD_URL: &str = "https://iid.googleapis.com/iid/v1:batchAdd";
const IID_BATCH_REMOVE_URL: &str = "https://iid.googleapis.com/iid/v1:batchRemove";

#[derive(Debug, thiserror::Error)]
pub enum PushError {
    #[error("push notifications are not configured (FCM_PROJECT_ID / FCM_SERVICE_ACCOUNT_JSON unset)")]
    NotConfigured,
    #[error("invalid FCM service account JSON: {0}")]
    InvalidServiceAccount(String),
    #[error("failed to sign FCM auth JWT: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
    #[error("FCM auth request failed: {0}")]
    AuthRequest(String),
    #[error("FCM send request failed: {0}")]
    SendRequest(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// The subset of a Google service-account JSON needed to mint an OAuth2
/// bearer token for FCM.
#[derive(Debug, Clone, Deserialize)]
struct ServiceAccount {
    client_email: String,
    private_key: String,
}

#[derive(Debug, Serialize)]
struct GoogleJwtClaims {
    iss: String,
    scope: String,
    aud: String,
    iat: u64,
    exp: u64,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
}

/// FCM's per-token error reason that means "this registration is dead, stop
/// sending to it" — distinct from a transient failure worth retrying.
fn is_unregistered_error(body: &str) -> bool {
    body.contains("UNREGISTERED") || body.contains("NOT_FOUND") || body.contains("INVALID_ARGUMENT")
}

pub struct FcmConfig {
    pub project_id: String,
    /// Raw service-account JSON contents (not a file path — matches how
    /// other secrets in this codebase are passed as env var values).
    pub service_account_json: String,
}

/// Outcome of a single `notify_user` call, useful to a caller (or a test)
/// that wants to know whether push actually went out or the in-app fallback
/// fired instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryOutcome {
    /// Delivered to at least one active device via FCM.
    Pushed,
    /// No active device, or every send failed — an in-app notification row
    /// was written instead.
    FellBackToInApp,
}

#[derive(Debug, FromRow)]
struct SubscriptionRow {
    id: Uuid,
    device_token: String,
}

pub struct PushNotificationService {
    config: Option<FcmConfig>,
    http: reqwest::Client,
}

impl PushNotificationService {
    pub fn new(config: Option<FcmConfig>) -> Self {
        Self {
            config,
            http: reqwest::Client::new(),
        }
    }

    fn parse_service_account(&self, config: &FcmConfig) -> Result<ServiceAccount, PushError> {
        serde_json::from_str(&config.service_account_json)
            .map_err(|e| PushError::InvalidServiceAccount(e.to_string()))
    }

    /// Mint a fresh OAuth2 bearer token scoped to Firebase Cloud Messaging.
    async fn get_access_token(&self) -> Result<String, PushError> {
        let config = self.config.as_ref().ok_or(PushError::NotConfigured)?;
        let account = self.parse_service_account(config)?;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let claims = GoogleJwtClaims {
            iss: account.client_email.clone(),
            scope: FCM_SCOPE.to_string(),
            aud: GOOGLE_TOKEN_URL.to_string(),
            iat: now,
            exp: now + 3600,
        };
        let key = EncodingKey::from_rsa_pem(account.private_key.as_bytes())
            .map_err(|e| PushError::InvalidServiceAccount(e.to_string()))?;
        let assertion = encode(&Header::new(Algorithm::RS256), &claims, &key)?;

        let resp = self
            .http
            .post(GOOGLE_TOKEN_URL)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .send()
            .await
            .map_err(|e| PushError::AuthRequest(e.to_string()))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(PushError::AuthRequest(body));
        }

        let token: GoogleTokenResponse = resp
            .json()
            .await
            .map_err(|e| PushError::AuthRequest(e.to_string()))?;
        Ok(token.access_token)
    }

    /// Send a rich notification (title/body plus an arbitrary string-keyed
    /// data payload) to a single device token. Returns `Ok(())` on FCM
    /// acceptance, or `Err` with the response body on rejection so the
    /// caller can distinguish an unregistered token from a transient error.
    async fn send_to_token(
        &self,
        access_token: &str,
        device_token: &str,
        title: &str,
        body: &str,
        data: &HashMap<String, String>,
    ) -> Result<(), String> {
        let config = self.config.as_ref().expect("checked by caller");
        let url = FCM_SEND_URL_TEMPLATE.replace("{project}", &config.project_id);

        let resp = self
            .http
            .post(&url)
            .bearer_auth(access_token)
            .json(&json!({
                "message": {
                    "token": device_token,
                    "notification": { "title": title, "body": body },
                    "data": data,
                }
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if resp.status().is_success() {
            Ok(())
        } else {
            Err(resp.text().await.unwrap_or_default())
        }
    }

    /// Send a rich notification to every device subscribed to `topic`.
    pub async fn send_to_topic(
        &self,
        topic: &str,
        title: &str,
        body: &str,
        data: &HashMap<String, String>,
    ) -> Result<(), PushError> {
        let config = self.config.as_ref().ok_or(PushError::NotConfigured)?;
        let access_token = self.get_access_token().await?;
        let url = FCM_SEND_URL_TEMPLATE.replace("{project}", &config.project_id);

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&access_token)
            .json(&json!({
                "message": {
                    "topic": topic,
                    "notification": { "title": title, "body": body },
                    "data": data,
                }
            }))
            .send()
            .await
            .map_err(|e| PushError::SendRequest(e.to_string()))?;

        if resp.status().is_success() {
            Ok(())
        } else {
            Err(PushError::SendRequest(resp.text().await.unwrap_or_default()))
        }
    }

    /// Register `device_token` for `user_id`'s topic fan-out and subscribe it
    /// to `topics` at the FCM level (best-effort: a topic-subscribe failure
    /// doesn't fail the registration, since direct per-token sends still work).
    pub async fn register_device(
        &self,
        pool: &DbPool,
        user_id: Uuid,
        device_token: &str,
        platform: &str,
        topics: &[String],
    ) -> Result<Uuid, PushError> {
        let row: (Uuid,) = sqlx::query_as(
            r#"
            INSERT INTO push_subscriptions (user_id, device_token, platform, topics)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (device_token)
            DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
                          topics = EXCLUDED.topics, active = TRUE
            RETURNING id
            "#,
        )
        .bind(user_id)
        .bind(device_token)
        .bind(platform)
        .bind(topics)
        .fetch_one(pool)
        .await?;

        if self.config.is_some() && !topics.is_empty() {
            if let Err(e) = self.subscribe_to_topics(device_token, topics).await {
                tracing::warn!(user_id = %user_id, error = %e, "FCM topic subscribe failed; direct sends still work");
            }
        }

        Ok(row.0)
    }

    pub async fn unregister_device(&self, pool: &DbPool, user_id: Uuid, device_token: &str) -> Result<(), PushError> {
        sqlx::query("UPDATE push_subscriptions SET active = FALSE WHERE user_id = $1 AND device_token = $2")
            .bind(user_id)
            .bind(device_token)
            .execute(pool)
            .await?;
        Ok(())
    }

    async fn subscribe_to_topics(&self, device_token: &str, topics: &[String]) -> Result<(), PushError> {
        let access_token = self.get_access_token().await?;
        for topic in topics {
            let resp = self
                .http
                .post(IID_BATCH_ADD_URL)
                .bearer_auth(&access_token)
                .json(&json!({
                    "to": format!("/topics/{topic}"),
                    "registration_tokens": [device_token],
                }))
                .send()
                .await
                .map_err(|e| PushError::SendRequest(e.to_string()))?;
            if !resp.status().is_success() {
                return Err(PushError::SendRequest(resp.text().await.unwrap_or_default()));
            }
        }
        Ok(())
    }

    /// Best-effort cleanup counterpart to `subscribe_to_topics`, used when a
    /// device re-registers with a smaller topic set.
    #[allow(dead_code)]
    async fn unsubscribe_from_topics(&self, device_token: &str, topics: &[String]) -> Result<(), PushError> {
        let access_token = self.get_access_token().await?;
        for topic in topics {
            let _ = self
                .http
                .post(IID_BATCH_REMOVE_URL)
                .bearer_auth(&access_token)
                .json(&json!({
                    "to": format!("/topics/{topic}"),
                    "registration_tokens": [device_token],
                }))
                .send()
                .await;
        }
        Ok(())
    }

    /// Notify a user: push to every active device they have registered, and
    /// fall back to an in-app `notifications` row if they have none or every
    /// send fails. Every attempt (push or fallback) is logged to
    /// `push_deliveries` for the delivery-tracking acceptance criterion.
    pub async fn notify_user(
        &self,
        pool: &DbPool,
        user_id: Uuid,
        title: &str,
        body: &str,
        data: HashMap<String, String>,
    ) -> Result<DeliveryOutcome, PushError> {
        let subscriptions: Vec<SubscriptionRow> = sqlx::query_as(
            "SELECT id, device_token FROM push_subscriptions WHERE user_id = $1 AND active = TRUE",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        if subscriptions.is_empty() || self.config.is_none() {
            self.fall_back_to_in_app(pool, user_id, title, body).await?;
            return Ok(DeliveryOutcome::FellBackToInApp);
        }

        let access_token = match self.get_access_token().await {
            Ok(token) => token,
            Err(e) => {
                tracing::warn!(user_id = %user_id, error = %e, "FCM auth failed; falling back to in-app");
                self.fall_back_to_in_app(pool, user_id, title, body).await?;
                return Ok(DeliveryOutcome::FellBackToInApp);
            }
        };

        let mut any_succeeded = false;
        for sub in &subscriptions {
            match self
                .send_to_token(&access_token, &sub.device_token, title, body, &data)
                .await
            {
                Ok(()) => {
                    any_succeeded = true;
                    self.log_delivery(pool, user_id, Some(sub.id), title, "sent", None).await?;
                    sqlx::query("UPDATE push_subscriptions SET last_delivered_at = NOW() WHERE id = $1")
                        .bind(sub.id)
                        .execute(pool)
                        .await?;
                }
                Err(err_body) => {
                    self.log_delivery(pool, user_id, Some(sub.id), title, "failed", Some(&err_body)).await?;
                    if is_unregistered_error(&err_body) {
                        sqlx::query("UPDATE push_subscriptions SET active = FALSE WHERE id = $1")
                            .bind(sub.id)
                            .execute(pool)
                            .await?;
                    }
                }
            }
        }

        if any_succeeded {
            Ok(DeliveryOutcome::Pushed)
        } else {
            self.fall_back_to_in_app(pool, user_id, title, body).await?;
            Ok(DeliveryOutcome::FellBackToInApp)
        }
    }

    async fn fall_back_to_in_app(&self, pool: &DbPool, user_id: Uuid, title: &str, body: &str) -> Result<(), PushError> {
        sqlx::query(
            "INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'push_fallback', $2, $3)",
        )
        .bind(user_id)
        .bind(title)
        .bind(body)
        .execute(pool)
        .await?;
        self.log_delivery(pool, user_id, None, title, "fallback", None).await
    }

    async fn log_delivery(
        &self,
        pool: &DbPool,
        user_id: Uuid,
        subscription_id: Option<Uuid>,
        title: &str,
        status: &str,
        error: Option<&str>,
    ) -> Result<(), PushError> {
        sqlx::query(
            "INSERT INTO push_deliveries (user_id, subscription_id, title, status, error) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(user_id)
        .bind(subscription_id)
        .bind(title)
        .bind(status)
        .bind(error)
        .execute(pool)
        .await?;
        Ok(())
    }
}
