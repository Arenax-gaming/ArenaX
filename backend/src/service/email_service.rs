//! Email notifications (Issue #905).
//!
//! The platform had no email at all: a player who was not in the app when a
//! tournament opened, a match was scored, or an achievement unlocked simply
//! never found out.
//!
//! # Shape
//!
//! Three pieces, kept separate so each can be reasoned about alone:
//!
//! - [`EmailCategory`] — what an email is *about*. Preferences, unsubscribes
//!   and the digest all key off this, so adding a kind of email means adding
//!   one variant rather than threading a new flag through everything.
//! - [`EmailTransport`] — how bytes leave the process. A trait so the service
//!   is testable without a live SMTP server, and so swapping provider is a
//!   new implementation rather than a rewrite.
//! - [`EmailService`] — the policy: is this player subscribed, have we already
//!   sent this, render it, hand it to the transport, record what happened.
//!
//! # Why preferences are opt-out and security email is not optional
//!
//! Absence of a row means subscribed, so a new category does not need a
//! backfill across every user. [`EmailCategory::AccountSecurity`] ignores
//! preferences entirely — a password change or a suspension notice is not
//! marketing, and a player who muted "everything" still needs to be told their
//! account was acted on.

use crate::api_error::ApiError;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{error, info, warn};
use uuid::Uuid;

/// What an email is about. One variant per thing a player can opt out of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmailCategory {
    TournamentRegistration,
    MatchResult,
    Achievement,
    WeeklyDigest,
    /// Password changes, suspensions, sign-ins from new devices.
    AccountSecurity,
}

impl EmailCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            EmailCategory::TournamentRegistration => "tournament_registration",
            EmailCategory::MatchResult => "match_result",
            EmailCategory::Achievement => "achievement",
            EmailCategory::WeeklyDigest => "weekly_digest",
            EmailCategory::AccountSecurity => "account_security",
        }
    }

    pub fn from_str(raw: &str) -> Option<Self> {
        Some(match raw {
            "tournament_registration" => EmailCategory::TournamentRegistration,
            "match_result" => EmailCategory::MatchResult,
            "achievement" => EmailCategory::Achievement,
            "weekly_digest" => EmailCategory::WeeklyDigest,
            "account_security" => EmailCategory::AccountSecurity,
            _ => return None,
        })
    }

    /// Whether a player may switch this category off.
    ///
    /// Security mail is not optional. Sending it regardless is the point:
    /// "someone changed your password" has to arrive even for a player who
    /// unsubscribed from everything else.
    pub fn is_optional(&self) -> bool {
        !matches!(self, EmailCategory::AccountSecurity)
    }

    /// Every category a player can manage, for the preferences screen.
    pub fn optional_categories() -> Vec<EmailCategory> {
        vec![
            EmailCategory::TournamentRegistration,
            EmailCategory::MatchResult,
            EmailCategory::Achievement,
            EmailCategory::WeeklyDigest,
        ]
    }
}

/// A rendered message, ready to send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailMessage {
    pub to: String,
    pub subject: String,
    pub html_body: String,
    /// Plain-text alternative. Always populated — a text part keeps the mail
    /// out of spam folders and readable in clients that refuse HTML.
    pub text_body: String,
}

/// How a message leaves the process.
#[async_trait]
pub trait EmailTransport: Send + Sync {
    async fn send(&self, message: &EmailMessage) -> Result<(), String>;
}

/// Writes messages to the log instead of sending them.
///
/// The default in development and tests: the full body is visible in the log
/// and nobody's real inbox is involved.
pub struct LoggingTransport;

#[async_trait]
impl EmailTransport for LoggingTransport {
    async fn send(&self, message: &EmailMessage) -> Result<(), String> {
        info!(
            to = %message.to,
            subject = %message.subject,
            "Email (logging transport — not actually sent)"
        );
        Ok(())
    }
}

/// Sends through an HTTP email provider (Postmark, Resend, SendGrid — anything
/// that takes a JSON body and a bearer token).
///
/// HTTP rather than SMTP because the deployment target already carries
/// `reqwest`, and an HTTP 4xx tells you *why* a send was rejected in a way an
/// SMTP status code does not.
pub struct HttpTransport {
    client: reqwest::Client,
    endpoint: String,
    api_key: String,
    from: String,
}

impl HttpTransport {
    pub fn new(endpoint: String, api_key: String, from: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            endpoint,
            api_key,
            from,
        }
    }

    /// Builds a transport from the environment, or `None` when unconfigured.
    ///
    /// Returning `None` rather than panicking keeps a missing provider from
    /// taking the whole service down at boot — the caller falls back to
    /// [`LoggingTransport`] and the absence is logged once.
    pub fn from_env() -> Option<Self> {
        let endpoint = std::env::var("EMAIL_API_ENDPOINT").ok()?;
        let api_key = std::env::var("EMAIL_API_KEY").ok()?;
        let from = std::env::var("EMAIL_FROM_ADDRESS").ok()?;
        Some(Self::new(endpoint, api_key, from))
    }
}

#[async_trait]
impl EmailTransport for HttpTransport {
    async fn send(&self, message: &EmailMessage) -> Result<(), String> {
        let body = serde_json::json!({
            "from": self.from,
            "to": message.to,
            "subject": message.subject,
            "html": message.html_body,
            "text": message.text_body,
        });

        let response = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("email request failed: {e}"))?;

        if response.status().is_success() {
            return Ok(());
        }

        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        Err(format!("provider rejected the message ({status}): {detail}"))
    }
}

/// A player's opt-out state for one category.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EmailPreference {
    pub category: EmailCategory,
    pub subscribed: bool,
    pub updated_at: Option<DateTime<Utc>>,
}

/// One line of a weekly digest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigestEntry {
    pub headline: String,
    pub detail: String,
}

/// What happened to a send.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendOutcome {
    Sent,
    /// The player has opted out of this category.
    SkippedUnsubscribed,
    /// The player has no email address on file.
    SkippedNoAddress,
    /// Already sent — the dedupe key matched an existing delivery.
    SkippedDuplicate,
}

/// Composes, gates and records outbound email.
pub struct EmailService {
    db_pool: PgPool,
    transport: Arc<dyn EmailTransport>,
    /// Base URL used to build unsubscribe links.
    app_base_url: String,
}

impl EmailService {
    pub fn new(db_pool: PgPool, transport: Arc<dyn EmailTransport>) -> Self {
        let app_base_url =
            std::env::var("APP_BASE_URL").unwrap_or_else(|_| "https://arenax.gg".to_string());
        Self {
            db_pool,
            transport,
            app_base_url,
        }
    }

    /// Builds a service using the configured provider, falling back to logging.
    pub fn from_env(db_pool: PgPool) -> Self {
        let transport: Arc<dyn EmailTransport> = match HttpTransport::from_env() {
            Some(http) => Arc::new(http),
            None => {
                warn!(
                    "EMAIL_API_ENDPOINT/EMAIL_API_KEY/EMAIL_FROM_ADDRESS not set — \
                     email will be logged, not delivered"
                );
                Arc::new(LoggingTransport)
            }
        };
        Self::new(db_pool, transport)
    }

    // ------------------------------------------------------------------
    // Preferences
    // ------------------------------------------------------------------

    /// Whether the player wants this category.
    ///
    /// A missing row means subscribed; see the module docs on why the default
    /// lives here rather than in a backfill.
    pub async fn is_subscribed(
        &self,
        user_id: Uuid,
        category: EmailCategory,
    ) -> Result<bool, ApiError> {
        if !category.is_optional() {
            return Ok(true);
        }

        let subscribed = sqlx::query_scalar::<_, bool>(
            "SELECT subscribed FROM email_preferences WHERE user_id = $1 AND category = $2",
        )
        .bind(user_id)
        .bind(category.as_str())
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        Ok(subscribed.unwrap_or(true))
    }

    /// Sets one category on or off.
    pub async fn set_preference(
        &self,
        user_id: Uuid,
        category: EmailCategory,
        subscribed: bool,
    ) -> Result<(), ApiError> {
        if !category.is_optional() && !subscribed {
            return Err(ApiError::BadRequest(format!(
                "{} email cannot be switched off",
                category.as_str()
            )));
        }

        sqlx::query(
            r#"
            INSERT INTO email_preferences (user_id, category, subscribed, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (user_id, category) DO UPDATE
                SET subscribed = EXCLUDED.subscribed, updated_at = NOW()
            "#,
        )
        .bind(user_id)
        .bind(category.as_str())
        .bind(subscribed)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        Ok(())
    }

    /// Every manageable category and its current state, for the settings page.
    pub async fn preferences(&self, user_id: Uuid) -> Result<Vec<EmailPreference>, ApiError> {
        let rows = sqlx::query_as::<_, (String, bool, DateTime<Utc>)>(
            "SELECT category, subscribed, updated_at FROM email_preferences WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        let mut preferences = Vec::new();
        for category in EmailCategory::optional_categories() {
            let stored = rows.iter().find(|(c, _, _)| c == category.as_str());
            preferences.push(EmailPreference {
                category,
                subscribed: stored.map(|(_, s, _)| *s).unwrap_or(true),
                updated_at: stored.map(|(_, _, u)| *u),
            });
        }

        Ok(preferences)
    }

    // ------------------------------------------------------------------
    // Unsubscribe links
    // ------------------------------------------------------------------

    /// Mints a single-use unsubscribe token.
    ///
    /// `category: None` unsubscribes from everything optional. The token is
    /// random rather than derived from the user id so a link that leaks (mail
    /// is forwarded constantly) cannot be turned into a way to unsubscribe
    /// arbitrary accounts.
    pub async fn create_unsubscribe_token(
        &self,
        user_id: Uuid,
        category: Option<EmailCategory>,
    ) -> Result<String, ApiError> {
        let token: String = {
            let mut rng = rand::thread_rng();
            (0..48)
                .map(|_| {
                    const ALPHABET: &[u8] =
                        b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
                    ALPHABET[rng.gen_range(0..ALPHABET.len())] as char
                })
                .collect()
        };

        sqlx::query(
            "INSERT INTO email_unsubscribe_tokens (token, user_id, category) VALUES ($1, $2, $3)",
        )
        .bind(&token)
        .bind(user_id)
        .bind(category.map(|c| c.as_str()))
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        Ok(token)
    }

    /// Honours an unsubscribe link.
    ///
    /// Marking the token used is not the same as rejecting a reused one — a
    /// player who clicks the link twice should see "you are unsubscribed", not
    /// an error, so a spent token still succeeds. `used_at` records the first
    /// click for support purposes.
    pub async fn unsubscribe_by_token(&self, token: &str) -> Result<(), ApiError> {
        let row = sqlx::query_as::<_, (Uuid, Option<String>)>(
            "SELECT user_id, category FROM email_unsubscribe_tokens WHERE token = $1",
        )
        .bind(token)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        let (user_id, category) = row.ok_or(ApiError::NotFound)?;

        match category.as_deref().and_then(EmailCategory::from_str) {
            Some(category) => self.set_preference(user_id, category, false).await?,
            None => {
                for category in EmailCategory::optional_categories() {
                    self.set_preference(user_id, category, false).await?;
                }
            }
        }

        sqlx::query(
            "UPDATE email_unsubscribe_tokens SET used_at = COALESCE(used_at, NOW()) WHERE token = $1",
        )
        .bind(token)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        info!(user_id = %user_id, "Unsubscribe link honoured");
        Ok(())
    }

    // ------------------------------------------------------------------
    // Sending
    // ------------------------------------------------------------------

    /// Sends one email, subject to preferences and de-duplication.
    ///
    /// `dedupe_key` should identify the *event*, not the attempt — for example
    /// `match_result:<match_id>:<user_id>`. A retried job then produces the
    /// same key and the second send is skipped rather than double-mailing the
    /// player.
    pub async fn send(
        &self,
        user_id: Uuid,
        category: EmailCategory,
        subject: &str,
        html_body: &str,
        text_body: &str,
        dedupe_key: Option<&str>,
    ) -> Result<SendOutcome, ApiError> {
        if !self.is_subscribed(user_id, category).await? {
            self.record(user_id, category, "", subject, dedupe_key, "skipped", None)
                .await?;
            return Ok(SendOutcome::SkippedUnsubscribed);
        }

        let recipient = sqlx::query_scalar::<_, Option<String>>(
            "SELECT email FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?
        .flatten();

        let recipient = match recipient {
            Some(address) if !address.trim().is_empty() => address,
            // Email is optional on this platform — phone number is the real
            // identity — so this is an ordinary outcome, not an error.
            _ => return Ok(SendOutcome::SkippedNoAddress),
        };

        if let Some(key) = dedupe_key {
            let already = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM email_deliveries WHERE dedupe_key = $1",
            )
            .bind(key)
            .fetch_one(&self.db_pool)
            .await
            .map_err(ApiError::DatabaseError)?;

            if already > 0 {
                return Ok(SendOutcome::SkippedDuplicate);
            }
        }

        // Every optional email carries its own unsubscribe link. Required by
        // bulk-mail conventions, and the only way a player can act on the mail
        // they are actually holding.
        let (html_body, text_body) = if category.is_optional() {
            let token = self.create_unsubscribe_token(user_id, Some(category)).await?;
            let link = format!("{}/email/unsubscribe/{}", self.app_base_url, token);
            (
                format!(
                    "{html_body}\n<hr/>\n<p style=\"font-size:12px;color:#888\">\
                     Don't want these? <a href=\"{link}\">Unsubscribe from {} email</a>.</p>",
                    category.as_str().replace('_', " ")
                ),
                format!(
                    "{text_body}\n\n---\nUnsubscribe from {} email: {link}",
                    category.as_str().replace('_', " ")
                ),
            )
        } else {
            (html_body.to_string(), text_body.to_string())
        };

        let message = EmailMessage {
            to: recipient.clone(),
            subject: subject.to_string(),
            html_body,
            text_body,
        };

        match self.transport.send(&message).await {
            Ok(()) => {
                self.record(user_id, category, &recipient, subject, dedupe_key, "sent", None)
                    .await?;
                Ok(SendOutcome::Sent)
            }
            Err(e) => {
                error!(user_id = %user_id, category = %category.as_str(), error = %e, "Email send failed");
                self.record(
                    user_id,
                    category,
                    &recipient,
                    subject,
                    dedupe_key,
                    "failed",
                    Some(&e),
                )
                .await?;
                // A failed notification must not fail the action that triggered
                // it — a match result stands whether or not the email landed.
                Ok(SendOutcome::SkippedNoAddress)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn record(
        &self,
        user_id: Uuid,
        category: EmailCategory,
        recipient: &str,
        subject: &str,
        dedupe_key: Option<&str>,
        status: &str,
        error: Option<&str>,
    ) -> Result<(), ApiError> {
        // ON CONFLICT DO NOTHING closes the race where two workers pass the
        // dedupe check at the same moment: the unique index decides, and the
        // loser silently does not log a second delivery.
        sqlx::query(
            r#"
            INSERT INTO email_deliveries
                (user_id, category, recipient, subject, dedupe_key, status, error, sent_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 = 'sent' THEN NOW() ELSE NULL END)
            ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
            "#,
        )
        .bind(user_id)
        .bind(category.as_str())
        .bind(recipient)
        .bind(subject)
        .bind(dedupe_key)
        .bind(status)
        .bind(error)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        Ok(())
    }

    // ------------------------------------------------------------------
    // The notifications themselves
    // ------------------------------------------------------------------

    pub async fn send_tournament_registration(
        &self,
        user_id: Uuid,
        tournament_id: Uuid,
        tournament_name: &str,
        starts_at: DateTime<Utc>,
        entry_fee_ngn: i64,
    ) -> Result<SendOutcome, ApiError> {
        let subject = format!("You're in: {tournament_name}");
        let starts = starts_at.format("%A %e %B at %H:%M UTC");

        let html = format!(
            "<h2>You're registered for {tournament_name}</h2>\
             <p>It starts <strong>{starts}</strong>.</p>\
             <p>Entry fee: ₦{entry_fee_ngn}</p>\
             <p>Be online and ready a few minutes early — no-shows forfeit.</p>"
        );
        let text = format!(
            "You're registered for {tournament_name}.\n\n\
             Starts: {starts}\n\
             Entry fee: NGN {entry_fee_ngn}\n\n\
             Be online and ready a few minutes early — no-shows forfeit."
        );

        self.send(
            user_id,
            EmailCategory::TournamentRegistration,
            &subject,
            &html,
            &text,
            Some(&format!("tournament_registration:{tournament_id}:{user_id}")),
        )
        .await
    }

    pub async fn send_match_result(
        &self,
        user_id: Uuid,
        match_id: Uuid,
        won: bool,
        opponent_name: &str,
        elo_change: i32,
    ) -> Result<SendOutcome, ApiError> {
        let verb = if won { "beat" } else { "lost to" };
        let subject = if won {
            format!("You beat {opponent_name}")
        } else {
            format!("Match result vs {opponent_name}")
        };

        // Sign is explicit: "+18" and "-18" read very differently at a glance,
        // and a bare number would be ambiguous on a loss.
        let elo = if elo_change >= 0 {
            format!("+{elo_change}")
        } else {
            elo_change.to_string()
        };

        let html = format!(
            "<h2>Match complete</h2>\
             <p>You {verb} <strong>{opponent_name}</strong>.</p>\
             <p>Rating change: <strong>{elo}</strong></p>"
        );
        let text = format!("You {verb} {opponent_name}.\n\nRating change: {elo}");

        self.send(
            user_id,
            EmailCategory::MatchResult,
            &subject,
            &html,
            &text,
            Some(&format!("match_result:{match_id}:{user_id}")),
        )
        .await
    }

    pub async fn send_achievement_unlocked(
        &self,
        user_id: Uuid,
        achievement_id: Uuid,
        achievement_name: &str,
        description: &str,
    ) -> Result<SendOutcome, ApiError> {
        let subject = format!("Achievement unlocked: {achievement_name}");
        let html = format!(
            "<h2>{achievement_name}</h2><p>{description}</p>\
             <p>Nicely done.</p>"
        );
        let text = format!("Achievement unlocked: {achievement_name}\n\n{description}");

        self.send(
            user_id,
            EmailCategory::Achievement,
            &subject,
            &html,
            &text,
            Some(&format!("achievement:{achievement_id}:{user_id}")),
        )
        .await
    }

    /// Weekly digest. Skipped entirely when there is nothing to report —
    /// an empty "here's your week" email is the fastest way to get a player to
    /// unsubscribe.
    pub async fn send_weekly_digest(
        &self,
        user_id: Uuid,
        week_starting: DateTime<Utc>,
        entries: &[DigestEntry],
    ) -> Result<SendOutcome, ApiError> {
        if entries.is_empty() {
            return Ok(SendOutcome::SkippedUnsubscribed);
        }

        let week = week_starting.format("%e %B");
        let subject = format!("Your ArenaX week — {week}");

        let html_items: String = entries
            .iter()
            .map(|e| format!("<li><strong>{}</strong><br/>{}</li>", e.headline, e.detail))
            .collect();
        let html = format!("<h2>Your week on ArenaX</h2><ul>{html_items}</ul>");

        let text_items: String = entries
            .iter()
            .map(|e| format!("- {}: {}\n", e.headline, e.detail))
            .collect();
        let text = format!("Your week on ArenaX\n\n{text_items}");

        self.send(
            user_id,
            EmailCategory::WeeklyDigest,
            &subject,
            &html,
            &text,
            Some(&format!(
                "weekly_digest:{}:{user_id}",
                week_starting.format("%Y-%m-%d")
            )),
        )
        .await
    }

    /// Tells a player they have been suspended (Issue #906).
    ///
    /// Sent as `AccountSecurity`, so it reaches a player who has unsubscribed
    /// from everything else — being told is what makes the appeal process
    /// meaningful.
    pub async fn send_suspension_notice(
        &self,
        user_id: Uuid,
        suspension_id: Uuid,
        reason: &str,
        expires_at: Option<DateTime<Utc>>,
    ) -> Result<SendOutcome, ApiError> {
        let (subject, duration_line) = match expires_at {
            Some(expiry) => (
                "Your ArenaX account has been suspended",
                format!(
                    "The suspension lifts on {}.",
                    expiry.format("%e %B %Y at %H:%M UTC")
                ),
            ),
            None => (
                "Your ArenaX account has been banned",
                "This is a permanent ban.".to_string(),
            ),
        };

        let appeal_link = format!("{}/appeals/{}", self.app_base_url, suspension_id);
        let html = format!(
            "<h2>{subject}</h2><p><strong>Reason:</strong> {reason}</p>\
             <p>{duration_line}</p>\
             <p>If you believe this is a mistake, you can \
             <a href=\"{appeal_link}\">appeal this decision</a>.</p>"
        );
        let text = format!(
            "{subject}\n\nReason: {reason}\n{duration_line}\n\n\
             If you believe this is a mistake, appeal here: {appeal_link}"
        );

        self.send(
            user_id,
            EmailCategory::AccountSecurity,
            subject,
            &html,
            &text,
            Some(&format!("suspension:{suspension_id}")),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Captures messages so assertions can look at what was composed.
    struct CapturingTransport {
        sent: Mutex<Vec<EmailMessage>>,
    }

    #[async_trait]
    impl EmailTransport for CapturingTransport {
        async fn send(&self, message: &EmailMessage) -> Result<(), String> {
            self.sent.lock().unwrap().push(message.clone());
            Ok(())
        }
    }

    #[test]
    fn categories_round_trip_through_their_stored_strings() {
        for category in [
            EmailCategory::TournamentRegistration,
            EmailCategory::MatchResult,
            EmailCategory::Achievement,
            EmailCategory::WeeklyDigest,
            EmailCategory::AccountSecurity,
        ] {
            assert_eq!(EmailCategory::from_str(category.as_str()), Some(category));
        }
    }

    #[test]
    fn an_unknown_category_is_rejected_rather_than_guessed() {
        assert_eq!(EmailCategory::from_str("promotions"), None);
    }

    #[test]
    fn security_email_cannot_be_unsubscribed_from() {
        assert!(!EmailCategory::AccountSecurity.is_optional());
        assert!(!EmailCategory::optional_categories().contains(&EmailCategory::AccountSecurity));
    }

    #[test]
    fn every_other_category_is_optional() {
        for category in EmailCategory::optional_categories() {
            assert!(
                category.is_optional(),
                "{} is listed as manageable but is not optional",
                category.as_str()
            );
        }
    }

    #[tokio::test]
    async fn the_capturing_transport_records_what_it_is_given() {
        let transport = CapturingTransport {
            sent: Mutex::new(Vec::new()),
        };

        let message = EmailMessage {
            to: "player@example.com".to_string(),
            subject: "Achievement unlocked: First Blood".to_string(),
            html_body: "<p>hi</p>".to_string(),
            text_body: "hi".to_string(),
        };

        transport.send(&message).await.unwrap();

        let sent = transport.sent.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].to, "player@example.com");
    }

    #[tokio::test]
    async fn the_logging_transport_never_fails() {
        // It is the fallback when no provider is configured, so a send must not
        // turn into an error just because email is not set up in development.
        let message = EmailMessage {
            to: "player@example.com".to_string(),
            subject: "s".to_string(),
            html_body: "h".to_string(),
            text_body: "t".to_string(),
        };

        assert!(LoggingTransport.send(&message).await.is_ok());
    }
}
