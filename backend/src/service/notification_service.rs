//! Fan-out notification delivery — Issue #1107.
//!
//! `POST /api/notifications` used to only ever insert a database row. This
//! adds real multi-channel delivery: in-app (the DB row itself), push (Web
//! Push to any endpoints the user has registered), and email (SendGrid's
//! HTTP API). Channel selection follows `user_notification_preferences`;
//! delivery is fanned out as a background task so the HTTP response doesn't
//! wait on a push/email round trip, each channel is rate-limited per user,
//! and every attempt — success or failure — is recorded in
//! `notification_deliveries` for audit and for the rate limiter itself to
//! query.

use crate::api_error::ApiError;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

// ─── Channels ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationChannel {
    InApp,
    Push,
    Email,
}

impl NotificationChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InApp => "in_app",
            Self::Push => "push",
            Self::Email => "email",
        }
    }
}

/// Hourly per-user, per-channel caps (#1107). In-app has none — it's a
/// single DB row per notification, not an external send.
pub const PUSH_LIMIT_PER_HOUR: i64 = 5;
pub const EMAIL_LIMIT_PER_HOUR: i64 = 2;

#[derive(Debug)]
pub struct ChannelDeliveryError(pub String);

impl std::fmt::Display for ChannelDeliveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone)]
pub struct NewNotification {
    pub user_id: Uuid,
    pub typ: String,
    pub title: String,
    pub message: String,
    pub link: Option<String>,
    pub link_label: Option<String>,
}

#[async_trait::async_trait]
pub trait ChannelSender: Send + Sync {
    async fn send(&self, db: &PgPool, notification: &NewNotification) -> Result<(), ChannelDeliveryError>;
}

/// The in-app "channel" is the `notifications` row itself, already written
/// by `NotificationService::create_and_fan_out` before this ever runs — so
/// there is nothing left to send.
pub struct InAppSender;

#[async_trait::async_trait]
impl ChannelSender for InAppSender {
    async fn send(&self, _db: &PgPool, _notification: &NewNotification) -> Result<(), ChannelDeliveryError> {
        Ok(())
    }
}

/// Web Push (RFC 8030) to every endpoint the user has registered.
///
/// Honest limitation: a production Web Push payload must be AES128GCM
/// encrypted per RFC 8291 with a VAPID `Authorization` header — that crypto
/// isn't implemented here. This sends an empty-body "tickle" POST, which
/// wakes a service worker to re-fetch from the in-app channel on push
/// services that accept it, but is not a full encrypted payload push.
/// Wiring real payload encryption is a follow-up, not silently pretended.
pub struct PushSender {
    http: reqwest::Client,
}

impl PushSender {
    pub fn new() -> Self {
        Self { http: reqwest::Client::new() }
    }
}

#[async_trait::async_trait]
impl ChannelSender for PushSender {
    async fn send(&self, db: &PgPool, notification: &NewNotification) -> Result<(), ChannelDeliveryError> {
        let endpoints: Vec<(String,)> = sqlx::query_as(
            "SELECT endpoint FROM push_subscriptions WHERE user_id = $1",
        )
        .bind(notification.user_id)
        .fetch_all(db)
        .await
        .map_err(|e| ChannelDeliveryError(e.to_string()))?;

        if endpoints.is_empty() {
            return Err(ChannelDeliveryError("no push subscription registered".to_string()));
        }

        for (endpoint,) in endpoints {
            let response = self
                .http
                .post(&endpoint)
                .header("TTL", "60")
                .send()
                .await
                .map_err(|e| ChannelDeliveryError(e.to_string()))?;

            if !response.status().is_success() {
                return Err(ChannelDeliveryError(format!(
                    "push endpoint returned {}",
                    response.status()
                )));
            }
        }
        Ok(())
    }
}

/// Email via SendGrid's HTTP API (`api.sendgrid.com/v3/mail/send`) — chosen
/// over raw SMTP so no new SMTP client dependency is needed; the acceptance
/// criteria names either as acceptable.
pub struct EmailSender {
    http: reqwest::Client,
    api_key: String,
    from_email: String,
}

impl EmailSender {
    pub fn new(api_key: String, from_email: String) -> Self {
        Self { http: reqwest::Client::new(), api_key, from_email }
    }
}

#[async_trait::async_trait]
impl ChannelSender for EmailSender {
    async fn send(&self, db: &PgPool, notification: &NewNotification) -> Result<(), ChannelDeliveryError> {
        if self.api_key.is_empty() {
            return Err(ChannelDeliveryError("SENDGRID_API_KEY is not configured".to_string()));
        }

        let to_email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
            .bind(notification.user_id)
            .fetch_optional(db)
            .await
            .map_err(|e| ChannelDeliveryError(e.to_string()))?
            .flatten();

        let Some(to_email) = to_email else {
            return Err(ChannelDeliveryError("user has no email on file".to_string()));
        };

        let payload = serde_json::json!({
            "personalizations": [{ "to": [{ "email": to_email }] }],
            "from": { "email": self.from_email },
            "subject": notification.title,
            "content": [{ "type": "text/plain", "value": notification.message }],
        });

        let response = self
            .http
            .post("https://api.sendgrid.com/v3/mail/send")
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|e| ChannelDeliveryError(e.to_string()))?;

        if !response.status().is_success() {
            return Err(ChannelDeliveryError(format!("SendGrid returned {}", response.status())));
        }
        Ok(())
    }
}

// ─── Service ────────────────────────────────────────────────────────────────

#[derive(Debug, sqlx::FromRow)]
pub struct NotificationRow {
    pub id: Uuid,
    pub user_id: Uuid,
    #[sqlx(rename = "type")]
    pub typ: String,
    pub title: String,
    pub message: String,
    pub link: Option<String>,
    pub link_label: Option<String>,
    pub read: bool,
    pub created_at: DateTime<Utc>,
}

pub struct NotificationService {
    db: PgPool,
    push_sender: Arc<dyn ChannelSender>,
    email_sender: Arc<dyn ChannelSender>,
}

impl NotificationService {
    pub fn new(db: PgPool, sendgrid_api_key: String, sendgrid_from_email: String) -> Self {
        Self {
            db,
            push_sender: Arc::new(PushSender::new()),
            email_sender: Arc::new(EmailSender::new(sendgrid_api_key, sendgrid_from_email)),
        }
    }

    /// Test/DI hook — inject fake channel senders instead of real HTTP ones.
    pub fn with_senders(
        db: PgPool,
        push_sender: Arc<dyn ChannelSender>,
        email_sender: Arc<dyn ChannelSender>,
    ) -> Self {
        Self { db, push_sender, email_sender }
    }

    /// Inserts the in-app row, then dispatches to every channel the user has
    /// enabled as a background task (#1107) — the caller gets the row back
    /// immediately without waiting on push/email round trips.
    pub async fn create_and_fan_out(&self, n: NewNotification) -> Result<NotificationRow, ApiError> {
        let row = sqlx::query_as::<_, NotificationRow>(
            r#"
            INSERT INTO notifications (user_id, type, title, message, link, link_label)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, user_id, type, title, message, link, link_label, read, created_at
            "#,
        )
        .bind(n.user_id)
        .bind(&n.typ)
        .bind(&n.title)
        .bind(&n.message)
        .bind(&n.link)
        .bind(&n.link_label)
        .fetch_one(&self.db)
        .await
        .map_err(ApiError::DatabaseError)?;

        self.record_delivery(row.id, n.user_id, NotificationChannel::InApp, "sent", None)
            .await;

        let db = self.db.clone();
        let push_sender = self.push_sender.clone();
        let email_sender = self.email_sender.clone();
        let notification_id = row.id;

        tokio::spawn(async move {
            Self::fan_out(db, notification_id, n, push_sender, email_sender).await;
        });

        Ok(row)
    }

    /// Runs on the spawned background task: loads the user's channel
    /// preferences and dispatches push/email accordingly.
    async fn fan_out(
        db: PgPool,
        notification_id: Uuid,
        n: NewNotification,
        push_sender: Arc<dyn ChannelSender>,
        email_sender: Arc<dyn ChannelSender>,
    ) {
        let prefs: Option<(bool, bool)> = sqlx::query_as(
            "SELECT push_enabled, email_enabled FROM user_notification_preferences WHERE user_id = $1",
        )
        .bind(n.user_id)
        .fetch_optional(&db)
        .await
        .unwrap_or(None);

        let (push_enabled, email_enabled) = prefs.unwrap_or((false, false));

        if push_enabled {
            Self::dispatch_channel(
                &db,
                NotificationChannel::Push,
                PUSH_LIMIT_PER_HOUR,
                notification_id,
                &n,
                push_sender.as_ref(),
            )
            .await;
        }

        if email_enabled {
            Self::dispatch_channel(
                &db,
                NotificationChannel::Email,
                EMAIL_LIMIT_PER_HOUR,
                notification_id,
                &n,
                email_sender.as_ref(),
            )
            .await;
        }
    }

    /// Sends via one channel, retrying once on failure, logging + recording
    /// a permanent failure with `user_id`/`channel`/`notification_id` if the
    /// retry also fails (#1107). Rate-limited channels never attempt a send.
    async fn dispatch_channel(
        db: &PgPool,
        channel: NotificationChannel,
        limit_per_hour: i64,
        notification_id: Uuid,
        n: &NewNotification,
        sender: &(dyn ChannelSender),
    ) {
        match Self::is_rate_limited(db, n.user_id, channel, limit_per_hour).await {
            Ok(true) => {
                Self::record_delivery_static(db, notification_id, n.user_id, channel, "failed", Some("rate limited"))
                    .await;
                return;
            }
            Ok(false) => {}
            Err(e) => {
                tracing::warn!(error = %e, "Failed to check notification rate limit; proceeding");
            }
        }

        if sender.send(db, n).await.is_ok() {
            Self::record_delivery_static(db, notification_id, n.user_id, channel, "sent", None).await;
            return;
        }

        // One retry, per the acceptance criteria.
        match sender.send(db, n).await {
            Ok(()) => {
                Self::record_delivery_static(db, notification_id, n.user_id, channel, "sent", None).await;
            }
            Err(e) => {
                tracing::error!(
                    user_id = %n.user_id,
                    channel = channel.as_str(),
                    notification_id = %notification_id,
                    error = %e,
                    "Notification channel delivery permanently failed after retry"
                );
                Self::record_delivery_static(db, notification_id, n.user_id, channel, "failed", Some(&e.0))
                    .await;
            }
        }
    }

    async fn is_rate_limited(
        db: &PgPool,
        user_id: Uuid,
        channel: NotificationChannel,
        limit_per_hour: i64,
    ) -> Result<bool, sqlx::Error> {
        let count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*) FROM notification_deliveries
            WHERE user_id = $1 AND channel = $2 AND status = 'sent'
              AND attempted_at > NOW() - INTERVAL '1 hour'
            "#,
        )
        .bind(user_id)
        .bind(channel.as_str())
        .fetch_one(db)
        .await?;
        Ok(count >= limit_per_hour)
    }

    async fn record_delivery(
        &self,
        notification_id: Uuid,
        user_id: Uuid,
        channel: NotificationChannel,
        status: &str,
        error: Option<&str>,
    ) {
        Self::record_delivery_static(&self.db, notification_id, user_id, channel, status, error).await;
    }

    async fn record_delivery_static(
        db: &PgPool,
        notification_id: Uuid,
        user_id: Uuid,
        channel: NotificationChannel,
        status: &str,
        error: Option<&str>,
    ) {
        if let Err(e) = sqlx::query(
            r#"
            INSERT INTO notification_deliveries (notification_id, user_id, channel, status, error)
            VALUES ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(notification_id)
        .bind(user_id)
        .bind(channel.as_str())
        .bind(status)
        .bind(error)
        .execute(db)
        .await
        {
            tracing::warn!(error = %e, "Failed to record notification delivery audit row");
        }
    }
}

/// Requires a live Postgres (`TEST_DATABASE_URL`, same convention as
/// `service::idempotency_tests`); skips (rather than failing) when one isn't
/// reachable, since this environment doesn't always have one.
#[cfg(test)]
mod fan_out_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    struct CountingSender {
        calls: Arc<AtomicUsize>,
        fail: bool,
    }

    #[async_trait::async_trait]
    impl ChannelSender for CountingSender {
        async fn send(&self, _db: &PgPool, _n: &NewNotification) -> Result<(), ChannelDeliveryError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.fail {
                Err(ChannelDeliveryError("simulated failure".to_string()))
            } else {
                Ok(())
            }
        }
    }

    async fn connect_test_db() -> Option<PgPool> {
        let database_url = std::env::var("TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://test:test@localhost/arenax_test".to_string());
        sqlx::PgPool::connect(&database_url).await.ok()
    }

    async fn seed_user(db: &PgPool) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO users (id, phone_number, username)
            VALUES ($1, $2, $3)
            "#,
        )
        .bind(id)
        .bind(format!("+1555{}", &id.simple().to_string()[..7]))
        .bind(format!("user_{}", id.simple()))
        .execute(db)
        .await
        .expect("seed user");
        id
    }

    #[tokio::test]
    async fn all_three_channels_dispatch_when_all_are_enabled() {
        let Some(db) = connect_test_db().await else {
            eprintln!("skipping: no TEST_DATABASE_URL reachable");
            return;
        };

        let user_id = seed_user(&db).await;
        sqlx::query(
            "INSERT INTO user_notification_preferences (user_id, in_app_enabled, push_enabled, email_enabled) VALUES ($1, true, true, true)",
        )
        .bind(user_id)
        .execute(&db)
        .await
        .expect("seed preferences");
        sqlx::query(
            "INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key) VALUES ($1, 'https://push.example/ep', 'p256', 'auth')",
        )
        .bind(user_id)
        .execute(&db)
        .await
        .expect("seed push subscription");

        let push_calls = Arc::new(AtomicUsize::new(0));
        let email_calls = Arc::new(AtomicUsize::new(0));
        let push_sender: Arc<dyn ChannelSender> =
            Arc::new(CountingSender { calls: push_calls.clone(), fail: false });
        let email_sender: Arc<dyn ChannelSender> =
            Arc::new(CountingSender { calls: email_calls.clone(), fail: false });

        let service = NotificationService::with_senders(db.clone(), push_sender, email_sender);

        let row = service
            .create_and_fan_out(NewNotification {
                user_id,
                typ: "info".to_string(),
                title: "Tournament starting".to_string(),
                message: "Your tournament starts in 10 minutes".to_string(),
                link: None,
                link_label: None,
            })
            .await
            .expect("create_and_fan_out");

        // In-app delivery (the row itself) is synchronous; push/email are
        // fanned out on a background task — poll briefly for them to land.
        let mut waited_ms = 0;
        while (push_calls.load(Ordering::SeqCst) == 0 || email_calls.load(Ordering::SeqCst) == 0)
            && waited_ms < 2000
        {
            tokio::time::sleep(Duration::from_millis(50)).await;
            waited_ms += 50;
        }

        assert_eq!(push_calls.load(Ordering::SeqCst), 1, "push channel should have dispatched once");
        assert_eq!(email_calls.load(Ordering::SeqCst), 1, "email channel should have dispatched once");

        let delivery_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM notification_deliveries WHERE notification_id = $1",
        )
        .bind(row.id)
        .fetch_one(&db)
        .await
        .expect("count deliveries");
        assert_eq!(delivery_count, 3, "in_app + push + email = 3 recorded deliveries");

        sqlx::query("DELETE FROM notification_deliveries WHERE notification_id = $1")
            .bind(row.id)
            .execute(&db)
            .await
            .ok();
        sqlx::query("DELETE FROM notifications WHERE id = $1").bind(row.id).execute(&db).await.ok();
        sqlx::query("DELETE FROM push_subscriptions WHERE user_id = $1").bind(user_id).execute(&db).await.ok();
        sqlx::query("DELETE FROM user_notification_preferences WHERE user_id = $1").bind(user_id).execute(&db).await.ok();
        sqlx::query("DELETE FROM users WHERE id = $1").bind(user_id).execute(&db).await.ok();
    }

    #[tokio::test]
    async fn a_channel_that_fails_twice_is_recorded_as_a_permanent_failure() {
        let Some(db) = connect_test_db().await else {
            eprintln!("skipping: no TEST_DATABASE_URL reachable");
            return;
        };

        let user_id = seed_user(&db).await;
        sqlx::query(
            "INSERT INTO user_notification_preferences (user_id, push_enabled, email_enabled) VALUES ($1, true, false)",
        )
        .bind(user_id)
        .execute(&db)
        .await
        .expect("seed preferences");

        let push_calls = Arc::new(AtomicUsize::new(0));
        let push_sender: Arc<dyn ChannelSender> =
            Arc::new(CountingSender { calls: push_calls.clone(), fail: true });
        let email_sender: Arc<dyn ChannelSender> =
            Arc::new(CountingSender { calls: Arc::new(AtomicUsize::new(0)), fail: true });

        let service = NotificationService::with_senders(db.clone(), push_sender, email_sender);
        let row = service
            .create_and_fan_out(NewNotification {
                user_id,
                typ: "info".to_string(),
                title: "Test".to_string(),
                message: "msg".to_string(),
                link: None,
                link_label: None,
            })
            .await
            .expect("create_and_fan_out");

        let mut waited_ms = 0;
        while push_calls.load(Ordering::SeqCst) < 2 && waited_ms < 2000 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            waited_ms += 50;
        }
        assert_eq!(push_calls.load(Ordering::SeqCst), 2, "must retry exactly once (2 total attempts)");

        let failed_status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM notification_deliveries WHERE notification_id = $1 AND channel = 'push'",
        )
        .bind(row.id)
        .fetch_optional(&db)
        .await
        .expect("query delivery");
        assert_eq!(failed_status.as_deref(), Some("failed"));

        sqlx::query("DELETE FROM notification_deliveries WHERE notification_id = $1")
            .bind(row.id)
            .execute(&db)
            .await
            .ok();
        sqlx::query("DELETE FROM notifications WHERE id = $1").bind(row.id).execute(&db).await.ok();
        sqlx::query("DELETE FROM user_notification_preferences WHERE user_id = $1").bind(user_id).execute(&db).await.ok();
        sqlx::query("DELETE FROM users WHERE id = $1").bind(user_id).execute(&db).await.ok();
    }
}
