//! Player suspension and restriction (Issue #906).
//!
//! There was no way to act on a rule breaker short of deleting the account.
//! This adds graded enforcement: a temporary suspension that expires on its
//! own, a permanent ban, and an appeal each of them can be reviewed through.
//!
//! # Why suspensions are rows, not a flag on `users`
//!
//! A boolean on the user row answers "is this player suspended right now" and
//! nothing else. Enforcement work needs the rest: what they did, who decided,
//! when it lifts, whether they appealed, and what happened last time. Keeping
//! each action as a row means a repeat offender's history is queryable, an
//! expired suspension stays on the record instead of being overwritten, and
//! reversing a bad call is an update to one row rather than a guess about what
//! the flag used to be.
//!
//! Expiry is computed from `expires_at` at read time rather than swept by a
//! job. A cron that falls behind would leave players locked out past their
//! sentence, which is the failure everyone notices.

use crate::api_error::ApiError;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::{info, warn};
use uuid::Uuid;

/// How severely a player is restricted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SuspensionKind {
    /// Time-boxed. Lifts by itself at `expires_at`.
    Temporary,
    /// No expiry. Only an accepted appeal or an explicit lift ends it.
    Permanent,
}

impl SuspensionKind {
    fn as_str(&self) -> &'static str {
        match self {
            SuspensionKind::Temporary => "temporary",
            SuspensionKind::Permanent => "permanent",
        }
    }

    fn from_str(raw: &str) -> Self {
        match raw {
            "permanent" => SuspensionKind::Permanent,
            _ => SuspensionKind::Temporary,
        }
    }
}

/// What the player may no longer do.
///
/// Graded because the punishments are not interchangeable: someone abusing
/// chat should lose chat, not their tournament entry fee. A full `AllAccess`
/// ban stays available for the cases that warrant it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RestrictionScope {
    /// Cannot sign in at all.
    AllAccess,
    /// Can sign in and watch, but not enter matches or tournaments.
    Competition,
    /// Can play; cannot post in chat or social feeds.
    Social,
    /// Can play; cannot withdraw or stake.
    Financial,
}

impl RestrictionScope {
    fn as_str(&self) -> &'static str {
        match self {
            RestrictionScope::AllAccess => "all_access",
            RestrictionScope::Competition => "competition",
            RestrictionScope::Social => "social",
            RestrictionScope::Financial => "financial",
        }
    }

    fn from_str(raw: &str) -> Self {
        match raw {
            "competition" => RestrictionScope::Competition,
            "social" => RestrictionScope::Social,
            "financial" => RestrictionScope::Financial,
            _ => RestrictionScope::AllAccess,
        }
    }
}

/// Where an appeal stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppealStatus {
    None,
    Pending,
    Accepted,
    Rejected,
}

impl AppealStatus {
    fn as_str(&self) -> &'static str {
        match self {
            AppealStatus::None => "none",
            AppealStatus::Pending => "pending",
            AppealStatus::Accepted => "accepted",
            AppealStatus::Rejected => "rejected",
        }
    }

    fn from_str(raw: &str) -> Self {
        match raw {
            "pending" => AppealStatus::Pending,
            "accepted" => AppealStatus::Accepted,
            "rejected" => AppealStatus::Rejected,
            _ => AppealStatus::None,
        }
    }
}

/// A suspension as stored and returned.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Suspension {
    pub id: Uuid,
    pub user_id: Uuid,
    pub kind: SuspensionKind,
    pub scope: RestrictionScope,
    /// Operator-facing reason. Shown to the player, so it must be specific
    /// enough to appeal against — "cheating" is not, "aim assist detected in
    /// match <id>" is.
    pub reason: String,
    /// Moderator who issued it. `None` for automated enforcement.
    pub issued_by: Option<Uuid>,
    pub issued_at: DateTime<Utc>,
    /// When a temporary suspension lifts. Always `None` for a permanent ban.
    pub expires_at: Option<DateTime<Utc>>,
    /// Set when a suspension is ended early.
    pub lifted_at: Option<DateTime<Utc>>,
    pub lifted_by: Option<Uuid>,
    pub lift_reason: Option<String>,
    pub appeal_status: AppealStatus,
    pub appeal_text: Option<String>,
    pub appeal_submitted_at: Option<DateTime<Utc>>,
    pub appeal_reviewed_at: Option<DateTime<Utc>>,
    pub appeal_reviewed_by: Option<Uuid>,
    pub appeal_response: Option<String>,
}

impl Suspension {
    /// Whether this suspension restricts the player right now.
    ///
    /// The single place that decides "is this active", so a lifted suspension,
    /// an accepted appeal and an elapsed sentence cannot be judged differently
    /// by different callers.
    pub fn is_active(&self, now: DateTime<Utc>) -> bool {
        if self.lifted_at.is_some() {
            return false;
        }
        if self.appeal_status == AppealStatus::Accepted {
            return false;
        }
        match self.expires_at {
            Some(expiry) => expiry > now,
            None => true, // Permanent, or temporary with no expiry recorded.
        }
    }

    /// Time left to serve, or `None` for a permanent ban.
    pub fn remaining(&self, now: DateTime<Utc>) -> Option<Duration> {
        self.expires_at
            .map(|expiry| (expiry - now).max(Duration::zero()))
    }
}

/// What a caller needs to know before allowing an action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestrictionCheck {
    pub restricted: bool,
    pub scope: Option<RestrictionScope>,
    pub reason: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub suspension_id: Option<Uuid>,
}

impl RestrictionCheck {
    fn clear() -> Self {
        Self {
            restricted: false,
            scope: None,
            reason: None,
            expires_at: None,
            suspension_id: None,
        }
    }
}

/// Row shape returned by every query here.
type SuspensionRow = (
    Uuid,
    Uuid,
    String,
    String,
    String,
    Option<Uuid>,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
    Option<DateTime<Utc>>,
    Option<Uuid>,
    Option<String>,
    String,
    Option<String>,
    Option<DateTime<Utc>>,
    Option<DateTime<Utc>>,
    Option<Uuid>,
    Option<String>,
);

const SELECT_COLUMNS: &str = r#"
    id, user_id, kind, scope, reason, issued_by, issued_at, expires_at,
    lifted_at, lifted_by, lift_reason, appeal_status, appeal_text,
    appeal_submitted_at, appeal_reviewed_at, appeal_reviewed_by, appeal_response
"#;

fn row_to_suspension(row: SuspensionRow) -> Suspension {
    Suspension {
        id: row.0,
        user_id: row.1,
        kind: SuspensionKind::from_str(&row.2),
        scope: RestrictionScope::from_str(&row.3),
        reason: row.4,
        issued_by: row.5,
        issued_at: row.6,
        expires_at: row.7,
        lifted_at: row.8,
        lifted_by: row.9,
        lift_reason: row.10,
        appeal_status: AppealStatus::from_str(&row.11),
        appeal_text: row.12,
        appeal_submitted_at: row.13,
        appeal_reviewed_at: row.14,
        appeal_reviewed_by: row.15,
        appeal_response: row.16,
    }
}

/// Issues, lifts, and reviews player suspensions.
pub struct SuspensionService {
    db_pool: PgPool,
}

impl SuspensionService {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool }
    }

    /// Suspends a player for a fixed period.
    ///
    /// `duration_hours` is taken in hours because that is the unit moderators
    /// actually reach for — 24, 72, 168 — and it keeps "one day" from meaning
    /// something different across a daylight-saving boundary.
    #[allow(clippy::too_many_arguments)]
    pub async fn suspend_temporarily(
        &self,
        user_id: Uuid,
        scope: RestrictionScope,
        reason: &str,
        duration_hours: i64,
        issued_by: Option<Uuid>,
    ) -> Result<Suspension, ApiError> {
        if duration_hours <= 0 {
            return Err(ApiError::BadRequest(
                "Suspension duration must be at least one hour".to_string(),
            ));
        }

        let expires_at = Utc::now() + Duration::hours(duration_hours);
        self.insert(
            user_id,
            SuspensionKind::Temporary,
            scope,
            reason,
            Some(expires_at),
            issued_by,
        )
        .await
    }

    /// Bans a player with no expiry.
    pub async fn ban_permanently(
        &self,
        user_id: Uuid,
        scope: RestrictionScope,
        reason: &str,
        issued_by: Option<Uuid>,
    ) -> Result<Suspension, ApiError> {
        self.insert(
            user_id,
            SuspensionKind::Permanent,
            scope,
            reason,
            None,
            issued_by,
        )
        .await
    }

    async fn insert(
        &self,
        user_id: Uuid,
        kind: SuspensionKind,
        scope: RestrictionScope,
        reason: &str,
        expires_at: Option<DateTime<Utc>>,
        issued_by: Option<Uuid>,
    ) -> Result<Suspension, ApiError> {
        let reason = reason.trim();
        if reason.is_empty() {
            // Every suspension has to be appealable, and an unexplained one
            // is not.
            return Err(ApiError::BadRequest(
                "A suspension reason is required".to_string(),
            ));
        }

        let row = sqlx::query_as::<_, SuspensionRow>(&format!(
            r#"
            INSERT INTO player_suspensions
                (user_id, kind, scope, reason, issued_by, issued_at, expires_at, appeal_status)
            VALUES ($1, $2, $3, $4, $5, NOW(), $6, 'none')
            RETURNING {SELECT_COLUMNS}
            "#
        ))
        .bind(user_id)
        .bind(kind.as_str())
        .bind(scope.as_str())
        .bind(reason)
        .bind(issued_by)
        .bind(expires_at)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        let suspension = row_to_suspension(row);

        info!(
            user_id = %user_id,
            suspension_id = %suspension.id,
            kind = %kind.as_str(),
            scope = %scope.as_str(),
            expires_at = ?expires_at,
            "Player suspended"
        );

        Ok(suspension)
    }

    /// Ends a suspension early.
    pub async fn lift(
        &self,
        suspension_id: Uuid,
        lifted_by: Uuid,
        lift_reason: &str,
    ) -> Result<Suspension, ApiError> {
        let row = sqlx::query_as::<_, SuspensionRow>(&format!(
            r#"
            UPDATE player_suspensions
            SET lifted_at = NOW(), lifted_by = $2, lift_reason = $3
            WHERE id = $1 AND lifted_at IS NULL
            RETURNING {SELECT_COLUMNS}
            "#
        ))
        .bind(suspension_id)
        .bind(lifted_by)
        .bind(lift_reason)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        // NotFound carries no payload in this codebase, so the distinction
        // between "no such id" and "already lifted" stays in the log line.
        let row = row.ok_or(ApiError::NotFound)?;

        info!(suspension_id = %suspension_id, lifted_by = %lifted_by, "Suspension lifted");
        Ok(row_to_suspension(row))
    }

    /// The player's currently active suspensions, most restrictive first.
    pub async fn active_for_user(&self, user_id: Uuid) -> Result<Vec<Suspension>, ApiError> {
        let rows = sqlx::query_as::<_, SuspensionRow>(&format!(
            r#"
            SELECT {SELECT_COLUMNS}
            FROM player_suspensions
            WHERE user_id = $1
              AND lifted_at IS NULL
              AND appeal_status <> 'accepted'
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY issued_at DESC
            "#
        ))
        .bind(user_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        Ok(rows.into_iter().map(row_to_suspension).collect())
    }

    /// Everything ever issued against a player, newest first.
    ///
    /// Expired and lifted entries are included on purpose — the history is what
    /// tells a moderator whether this is a first offence.
    pub async fn history_for_user(&self, user_id: Uuid) -> Result<Vec<Suspension>, ApiError> {
        let rows = sqlx::query_as::<_, SuspensionRow>(&format!(
            r#"
            SELECT {SELECT_COLUMNS}
            FROM player_suspensions
            WHERE user_id = $1
            ORDER BY issued_at DESC
            "#
        ))
        .bind(user_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        Ok(rows.into_iter().map(row_to_suspension).collect())
    }

    /// Whether `user_id` may perform something covered by `scope`.
    ///
    /// An `AllAccess` suspension restricts every scope — a banned player is not
    /// merely barred from the thing the ban was scoped to.
    pub async fn check(
        &self,
        user_id: Uuid,
        scope: RestrictionScope,
    ) -> Result<RestrictionCheck, ApiError> {
        let active = self.active_for_user(user_id).await?;
        let now = Utc::now();

        let blocking = active.into_iter().find(|s| {
            s.is_active(now) && (s.scope == RestrictionScope::AllAccess || s.scope == scope)
        });

        Ok(match blocking {
            Some(s) => RestrictionCheck {
                restricted: true,
                scope: Some(s.scope),
                reason: Some(s.reason.clone()),
                expires_at: s.expires_at,
                suspension_id: Some(s.id),
            },
            None => RestrictionCheck::clear(),
        })
    }

    /// Records a player's appeal against a suspension.
    pub async fn submit_appeal(
        &self,
        suspension_id: Uuid,
        user_id: Uuid,
        appeal_text: &str,
    ) -> Result<Suspension, ApiError> {
        let appeal_text = appeal_text.trim();
        if appeal_text.is_empty() {
            return Err(ApiError::BadRequest(
                "An appeal must say something".to_string(),
            ));
        }

        // `user_id` is in the predicate rather than checked afterwards so one
        // player cannot appeal another's suspension, and the appeal cannot be
        // resubmitted while one is already pending or decided.
        let row = sqlx::query_as::<_, SuspensionRow>(&format!(
            r#"
            UPDATE player_suspensions
            SET appeal_status = 'pending',
                appeal_text = $3,
                appeal_submitted_at = NOW()
            WHERE id = $1
              AND user_id = $2
              AND appeal_status = 'none'
              AND lifted_at IS NULL
            RETURNING {SELECT_COLUMNS}
            "#
        ))
        .bind(suspension_id)
        .bind(user_id)
        .bind(appeal_text)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        let row = row.ok_or_else(|| {
            ApiError::BadRequest(
                "No appealable suspension found — it may already have been appealed or lifted"
                    .to_string(),
            )
        })?;

        info!(suspension_id = %suspension_id, user_id = %user_id, "Appeal submitted");
        Ok(row_to_suspension(row))
    }

    /// Decides a pending appeal.
    ///
    /// Accepting one ends the suspension: `is_active` treats an accepted appeal
    /// as lifted, so there is no window where a cleared player stays locked out
    /// waiting for a separate lift call.
    pub async fn review_appeal(
        &self,
        suspension_id: Uuid,
        reviewer_id: Uuid,
        accept: bool,
        response: &str,
    ) -> Result<Suspension, ApiError> {
        let status = if accept {
            AppealStatus::Accepted
        } else {
            AppealStatus::Rejected
        };

        let row = sqlx::query_as::<_, SuspensionRow>(&format!(
            r#"
            UPDATE player_suspensions
            SET appeal_status = $2,
                appeal_reviewed_at = NOW(),
                appeal_reviewed_by = $3,
                appeal_response = $4,
                lifted_at = CASE WHEN $2 = 'accepted' THEN NOW() ELSE lifted_at END,
                lifted_by = CASE WHEN $2 = 'accepted' THEN $3 ELSE lifted_by END,
                lift_reason = CASE WHEN $2 = 'accepted' THEN 'Appeal accepted' ELSE lift_reason END
            WHERE id = $1 AND appeal_status = 'pending'
            RETURNING {SELECT_COLUMNS}
            "#
        ))
        .bind(suspension_id)
        .bind(status.as_str())
        .bind(reviewer_id)
        .bind(response)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        let row = row.ok_or(ApiError::NotFound)?;

        info!(
            suspension_id = %suspension_id,
            reviewer_id = %reviewer_id,
            accepted = accept,
            "Appeal reviewed"
        );

        Ok(row_to_suspension(row))
    }

    /// Appeals waiting on a moderator, oldest first.
    pub async fn pending_appeals(&self, limit: i64) -> Result<Vec<Suspension>, ApiError> {
        let rows = sqlx::query_as::<_, SuspensionRow>(&format!(
            r#"
            SELECT {SELECT_COLUMNS}
            FROM player_suspensions
            WHERE appeal_status = 'pending'
            ORDER BY appeal_submitted_at ASC
            LIMIT $1
            "#
        ))
        .bind(limit)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        Ok(rows.into_iter().map(row_to_suspension).collect())
    }

    /// Fetches one suspension by id.
    pub async fn get(&self, suspension_id: Uuid) -> Result<Suspension, ApiError> {
        let row = sqlx::query_as::<_, SuspensionRow>(&format!(
            "SELECT {SELECT_COLUMNS} FROM player_suspensions WHERE id = $1"
        ))
        .bind(suspension_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        row.map(row_to_suspension).ok_or(ApiError::NotFound)
    }

    /// Warns when a player is accumulating suspensions.
    ///
    /// Returns the number issued in the trailing window, so callers can
    /// escalate — three temporary suspensions in a month is a different
    /// situation from three across two years.
    pub async fn offence_count(&self, user_id: Uuid, within_days: i64) -> Result<i64, ApiError> {
        let count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM player_suspensions
            WHERE user_id = $1
              AND issued_at > NOW() - ($2 || ' days')::interval
              AND appeal_status <> 'accepted'
            "#,
        )
        .bind(user_id)
        .bind(within_days.to_string())
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::DatabaseError)?;

        if count >= 3 {
            warn!(user_id = %user_id, count, within_days, "Repeat offender");
        }

        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn suspension(kind: SuspensionKind, expires_at: Option<DateTime<Utc>>) -> Suspension {
        Suspension {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            kind,
            scope: RestrictionScope::AllAccess,
            reason: "aim assist detected".to_string(),
            issued_by: Some(Uuid::new_v4()),
            issued_at: Utc::now(),
            expires_at,
            lifted_at: None,
            lifted_by: None,
            lift_reason: None,
            appeal_status: AppealStatus::None,
            appeal_text: None,
            appeal_submitted_at: None,
            appeal_reviewed_at: None,
            appeal_reviewed_by: None,
            appeal_response: None,
        }
    }

    #[test]
    fn a_temporary_suspension_lapses_on_its_own() {
        let now = Utc::now();
        let expired = suspension(SuspensionKind::Temporary, Some(now - Duration::hours(1)));

        assert!(!expired.is_active(now), "the sentence has been served");
        assert_eq!(expired.remaining(now), Some(Duration::zero()));
    }

    #[test]
    fn a_running_temporary_suspension_is_active() {
        let now = Utc::now();
        let running = suspension(SuspensionKind::Temporary, Some(now + Duration::hours(24)));

        assert!(running.is_active(now));
        assert_eq!(running.remaining(now).unwrap().num_hours(), 23);
    }

    #[test]
    fn a_permanent_ban_never_lapses() {
        let ban = suspension(SuspensionKind::Permanent, None);

        assert!(ban.is_active(Utc::now()));
        assert!(ban.is_active(Utc::now() + Duration::days(3650)));
        assert_eq!(ban.remaining(Utc::now()), None);
    }

    #[test]
    fn lifting_ends_a_permanent_ban() {
        let mut ban = suspension(SuspensionKind::Permanent, None);
        ban.lifted_at = Some(Utc::now());

        assert!(!ban.is_active(Utc::now()));
    }

    #[test]
    fn an_accepted_appeal_ends_the_suspension() {
        let mut ban = suspension(SuspensionKind::Permanent, None);
        ban.appeal_status = AppealStatus::Accepted;

        // Without this, a cleared player stays locked out until someone
        // remembers to call lift separately.
        assert!(!ban.is_active(Utc::now()));
    }

    #[test]
    fn a_rejected_appeal_leaves_the_suspension_standing() {
        let mut ban = suspension(SuspensionKind::Permanent, None);
        ban.appeal_status = AppealStatus::Rejected;

        assert!(ban.is_active(Utc::now()));
    }

    #[test]
    fn scope_and_kind_round_trip_through_their_stored_strings() {
        for scope in [
            RestrictionScope::AllAccess,
            RestrictionScope::Competition,
            RestrictionScope::Social,
            RestrictionScope::Financial,
        ] {
            assert_eq!(RestrictionScope::from_str(scope.as_str()), scope);
        }

        for kind in [SuspensionKind::Temporary, SuspensionKind::Permanent] {
            assert_eq!(SuspensionKind::from_str(kind.as_str()), kind);
        }

        for status in [
            AppealStatus::None,
            AppealStatus::Pending,
            AppealStatus::Accepted,
            AppealStatus::Rejected,
        ] {
            assert_eq!(AppealStatus::from_str(status.as_str()), status);
        }
    }

    #[test]
    fn an_unknown_stored_value_falls_back_to_the_strictest_reading() {
        // A row written by a newer deploy must not silently read as "no
        // restriction" on an older one.
        assert_eq!(
            RestrictionScope::from_str("something_new"),
            RestrictionScope::AllAccess
        );
        assert_eq!(AppealStatus::from_str("weird"), AppealStatus::None);
    }
}
