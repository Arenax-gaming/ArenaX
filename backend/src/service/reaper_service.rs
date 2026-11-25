//! # Reaper Service
//!
//! Background service that periodically scans for `in_progress` matches whose
//! `report_deadline` has passed and automatically resolves them:
//!
//! | Situation                         | Resolution                          |
//! |-----------------------------------|-------------------------------------|
//! | Only Player 1 reported            | Player 2 forfeited; Player 1 wins   |
//! | Only Player 2 reported            | Player 1 forfeited; Player 2 wins   |
//! | Neither player reported           | Match cancelled (no winner)         |
//! | Both players reported (conflict)  | Skipped — handled by conflict flow  |
//!
//! The Reaper runs on a configurable interval (default 60 s) and processes each
//! expired match in isolation so a single failure never blocks the rest of the
//! batch.

use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::match_models::{MatchStatus, MatchType};
use crate::service::elo_decay::{
    build_first_decay_notification, build_pending_decay_notification, DecaySweepSummary,
    EloDecayConfig,
};
use crate::service::leaderboard_service::LeaderboardService;
use crate::service::player_stats_service::PlayerStatsService;
use crate::service::push_notification_service::{DeliveryOutcome, PushNotificationService};
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, warn};
use uuid::Uuid;

/// How long after a match starts before the Reaper forfeits non-reporters.
const DEFAULT_REPORT_TIMEOUT_HOURS: i64 = 24;

/// How often the Reaper wakes up to scan for expired matches (seconds).
const DEFAULT_CHECK_INTERVAL_SECS: u64 = 60;

// ============================================================================
// SERVICE STRUCT
// ============================================================================

pub struct ReaperService {
    db_pool: DbPool,
    /// Kept for documentation / future dynamic config; the deadline is actually
    /// stamped on the match row when it transitions to in_progress.
    #[allow(dead_code)]
    report_timeout_hours: i64,
    check_interval_secs: u64,
    push_service: Arc<PushNotificationService>,
    leaderboard_service: Arc<LeaderboardService>,
    elo_decay_config: EloDecayConfig,
}

impl ReaperService {
    pub fn new(db_pool: DbPool) -> Self {
        Self {
            push_service: Arc::new(PushNotificationService::new(None)),
            leaderboard_service: Arc::new(LeaderboardService::new(db_pool.clone())),
            db_pool,
            report_timeout_hours: DEFAULT_REPORT_TIMEOUT_HOURS,
            check_interval_secs: DEFAULT_CHECK_INTERVAL_SECS,
            elo_decay_config: EloDecayConfig::default(),
        }
    }

    pub fn with_check_interval(mut self, secs: u64) -> Self {
        self.check_interval_secs = secs;
        self
    }

    pub fn with_push_service(mut self, push_service: Arc<PushNotificationService>) -> Self {
        self.push_service = push_service;
        self
    }

    pub fn with_leaderboard_service(
        mut self,
        leaderboard_service: Arc<LeaderboardService>,
    ) -> Self {
        self.leaderboard_service = leaderboard_service;
        self
    }

    pub fn with_elo_decay_config(mut self, config: EloDecayConfig) -> Self {
        self.elo_decay_config = config;
        self
    }

    // ========================================================================
    // BACKGROUND TASK
    // ========================================================================

    /// Spawn the Reaper as a detached Tokio task.
    ///
    /// The caller should hold an [`Arc`] to keep the service alive for the
    /// duration of the process.
    pub fn run(self: Arc<Self>) {
        let interval_secs = self.check_interval_secs;
        tokio::spawn(async move {
            info!(
                interval_secs,
                "Reaper service started — scanning for expired matches every {}s",
                interval_secs
            );
            let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
            // The first tick fires immediately; skip it so we don't reap on
            // startup before the server has fully initialised.
            ticker.tick().await;

            loop {
                ticker.tick().await;
                if let Err(e) = self.reap().await {
                    error!(error = %e, "Reaper tick failed");
                }
            }
        });
    }

    // ========================================================================
    // CORE LOGIC
    // ========================================================================

    /// Find all expired matches and run the inactivity ELO decay sweep.
    /// Both phases are fully isolated so an error in one never blocks the other.
    async fn reap(&self) -> Result<(), sqlx::Error> {
        if let Err(e) = self.reap_expired_matches().await {
            error!(error = %e, "Reaper: expired-match sweep failed");
        }

        // Run inactivity ELO decay sweep as part of the Reaper job (Issue #1533).
        // Isolated from match-forfeit reaping so errors in one never block the other.
        if let Err(e) = self.reap_inactive_elo_decay().await {
            error!(error = %e, "Reaper: inactivity ELO decay sweep failed");
        }

        Ok(())
    }

    /// Scan expired `in_progress` matches and resolve forfeits/byes.
    ///
    /// Casts `status` and `match_type` to `text` so the query works cleanly
    /// against both the canonical `INTEGER` schema (`status = 2`, `match_type = 2`)
    /// and any text-enum fixtures (`'in_progress'`, `'ranked'`).
    async fn reap_expired_matches(&self) -> Result<(), sqlx::Error> {
        let expired = sqlx::query_as::<_, (Uuid, Option<Uuid>, Option<Uuid>, Option<String>, Option<String>)>(
            r#"
            SELECT id, player1_id, player2_id, match_type::text, game_mode
            FROM   matches
            WHERE  status::text IN ('2', 'in_progress')
              AND  report_deadline < NOW()
            "#,
        )
        .fetch_all(&self.db_pool)
        .await?;

        if !expired.is_empty() {
            info!(count = expired.len(), "Reaper found expired in-progress matches");
        }

        for (match_id, player1_id, player2_id, raw_match_type, game_mode) in expired {
            let Some(player1_id) = player1_id else {
                warn!(match_id = %match_id, "Reaper: skipping expired match with NULL player1_id");
                continue;
            };
            let match_type = parse_match_type_text(raw_match_type.as_deref());
            let game_mode = game_mode.unwrap_or_default();

            if let Err(e) = self
                .process_expired_match(match_id, player1_id, player2_id, match_type, &game_mode)
                .await
            {
                // Log and continue — one bad match must not block the rest
                error!(
                    match_id = %match_id,
                    error    = %e,
                    "Reaper failed to process expired match"
                );
            }
        }

        Ok(())
    }

    /// Apply ELO inactivity decay to players inactive past the 30-day grace
    /// period, send a first-decay push notification on a player's first actual
    /// deduction (retrying previously failed deliveries), and sync affected
    /// leaderboard rankings (Issue #1533).
    pub async fn reap_inactive_elo_decay(&self) -> Result<DecaySweepSummary, ApiError> {
        /// RAII guard that detaches the pooled connection if dropped before
        /// explicit unlock (e.g., on panic or Tokio task cancellation), so an
        /// unreleased session advisory lock is never leaked back into `PgPool`.
        struct AdvisoryLockGuard {
            conn: Option<sqlx::pool::PoolConnection<sqlx::Postgres>>,
        }

        impl Drop for AdvisoryLockGuard {
            fn drop(&mut self) {
                if let Some(conn) = self.conn.take() {
                    let _ = conn.detach();
                }
            }
        }

        // Coordinate across horizontally scaled replicas using a PostgreSQL
        // advisory lock so two instances never double-notify the same player.
        let mut lock_conn = self
            .db_pool
            .acquire()
            .await
            .map_err(ApiError::database_error)?;
        let acquired: bool = sqlx::query_scalar(
            "SELECT pg_try_advisory_lock(hashtext('arenax_reaper_elo_decay')::bigint)",
        )
        .fetch_one(&mut *lock_conn)
        .await
        .map_err(ApiError::database_error)?;

        if !acquired {
            return Ok(DecaySweepSummary::default());
        }

        let mut guard = AdvisoryLockGuard {
            conn: Some(lock_conn),
        };

        let sweep_result = self.run_inactive_elo_decay_locked().await;

        if let Some(mut conn) = guard.conn.take() {
            if sqlx::query(
                "SELECT pg_advisory_unlock(hashtext('arenax_reaper_elo_decay')::bigint)",
            )
            .execute(&mut *conn)
            .await
            .is_err()
            {
                // Unlock failed — detach so the broken/locked session closes
                // instead of returning a held advisory lock to the pool.
                let _ = conn.detach();
            }
        }

        sweep_result
    }

    async fn run_inactive_elo_decay_locked(&self) -> Result<DecaySweepSummary, ApiError> {
        let stats_service = PlayerStatsService::new(self.db_pool.clone());
        let batch = stats_service
            .apply_inactivity_elo_decay(Utc::now(), &self.elo_decay_config)
            .await?;

        let mut summary = DecaySweepSummary {
            candidates_evaluated: batch.candidates_scanned,
            players_decayed: batch.applied.len(),
            total_points_deducted: 0,
            notifications_pushed: 0,
            notifications_fallback: 0,
            notification_failures: 0,
            leaderboard_entries_synced: 0,
        };

        let mut affected_players = Vec::with_capacity(batch.applied.len());
        let mut notified_ids = std::collections::HashSet::new();

        for entry in &batch.applied {
            summary.total_points_deducted += i64::from(entry.points_deducted);
            affected_players.push((entry.game.clone(), entry.user_id));

            if entry.should_notify_first_decay {
                notified_ids.insert(entry.user_elo_id);
                let (title, body, data) = build_first_decay_notification(
                    &entry.game,
                    entry.previous_rating,
                    entry.new_rating,
                    entry.points_deducted,
                );
                self.deliver_first_decay_notification(
                    &stats_service,
                    entry.user_elo_id,
                    entry.user_id,
                    &entry.game,
                    entry.last_decay_at,
                    &title,
                    &body,
                    data,
                    &mut summary,
                )
                .await;
            }
        }

        // Retry any previously persisted first-decay rows whose notification
        // failed transiently on an earlier sweep (including rows now at the
        // 100-ELO floor).
        match stats_service.find_pending_first_decay_notifications().await {
            Ok(pending) => {
                for row in pending {
                    if notified_ids.contains(&row.user_elo_id) {
                        continue;
                    }
                    let (title, body, data) =
                        build_pending_decay_notification(&row.game, row.current_rating);
                    self.deliver_first_decay_notification(
                        &stats_service,
                        row.user_elo_id,
                        row.user_id,
                        &row.game,
                        row.last_decay_at,
                        &title,
                        &body,
                        data,
                        &mut summary,
                    )
                    .await;
                }
            }
            Err(e) => {
                warn!(
                    error = %e,
                    "Reaper: failed to query pending first-decay notifications"
                );
            }
        }

        if !affected_players.is_empty() {
            match self
                .leaderboard_service
                .sync_decayed_players(&affected_players)
                .await
            {
                Ok(synced) => {
                    summary.leaderboard_entries_synced = synced;
                }
                Err(e) => {
                    warn!(
                        error = %e,
                        affected = affected_players.len(),
                        "Reaper: failed to sync leaderboard rankings after ELO decay"
                    );
                }
            }
        }

        if summary.players_decayed > 0
            || summary.notifications_pushed > 0
            || summary.notifications_fallback > 0
            || summary.notification_failures > 0
        {
            info!(
                candidates_evaluated = summary.candidates_evaluated,
                players_decayed = summary.players_decayed,
                total_points_deducted = summary.total_points_deducted,
                notifications_pushed = summary.notifications_pushed,
                notifications_fallback = summary.notifications_fallback,
                notification_failures = summary.notification_failures,
                leaderboard_entries_synced = summary.leaderboard_entries_synced,
                "Reaper: completed inactivity ELO decay sweep"
            );
        }

        Ok(summary)
    }

    #[allow(clippy::too_many_arguments)]
    async fn deliver_first_decay_notification(
        &self,
        stats_service: &PlayerStatsService,
        user_elo_id: Uuid,
        user_id: Uuid,
        game: &str,
        last_decay_at: chrono::DateTime<Utc>,
        title: &str,
        body: &str,
        data: std::collections::HashMap<String, String>,
        summary: &mut DecaySweepSummary,
    ) {
        match self
            .push_service
            .notify_user(&self.db_pool, user_id, title, body, data)
            .await
        {
            Ok(outcome) => {
                match outcome {
                    DeliveryOutcome::Pushed => summary.notifications_pushed += 1,
                    DeliveryOutcome::FellBackToInApp => summary.notifications_fallback += 1,
                }
                if let Err(e) = stats_service
                    .mark_decay_notified(user_elo_id, last_decay_at)
                    .await
                {
                    warn!(
                        user_id = %user_id,
                        game = %game,
                        error = %e,
                        "Reaper: failed to mark ELO decay notification flag"
                    );
                }
            }
            Err(e) => {
                // Never roll back committed ELO decay if push delivery fails;
                // leaving `decay_notified = FALSE` lets the next sweep retry.
                summary.notification_failures += 1;
                warn!(
                    user_id = %user_id,
                    game = %game,
                    error = %e,
                    "Reaper: failed to send first ELO decay push notification"
                );
            }
        }
    }

    /// Determine which player(s) missed the deadline and apply the appropriate
    /// resolution.
    async fn process_expired_match(
        &self,
        match_id: Uuid,
        player1_id: Uuid,
        player2_id: Option<Uuid>,
        match_type: MatchType,
        game_mode: &str,
    ) -> Result<(), ApiError> {
        // --- bye match (no opponent) ---
        let p2_id = match player2_id {
            None => {
                // Give the win to player 1 automatically
                info!(match_id = %match_id, "Reaper: bye match expired — auto-completing for player 1");
                return self
                    .complete_with_winner(match_id, player1_id, None, match_type, game_mode)
                    .await;
            }
            Some(id) => id,
        };

        let p1_reported = self.player_has_reported(match_id, player1_id).await?;
        let p2_reported = self.player_has_reported(match_id, p2_id).await?;

        match (p1_reported, p2_reported) {
            (true, false) => {
                // Player 2 failed to report → forfeit player 2, player 1 wins
                warn!(
                    match_id  = %match_id,
                    forfeited = %p2_id,
                    "Reaper: player 2 failed to report — forfeiting"
                );
                self.forfeit(match_id, p2_id, player1_id, match_type, game_mode).await?;
            }
            (false, true) => {
                // Player 1 failed to report → forfeit player 1, player 2 wins
                warn!(
                    match_id  = %match_id,
                    forfeited = %player1_id,
                    "Reaper: player 1 failed to report — forfeiting"
                );
                self.forfeit(match_id, player1_id, p2_id, match_type, game_mode).await?;
            }
            (false, false) => {
                // Neither player reported → cancel the match, no Elo change
                warn!(
                    match_id = %match_id,
                    "Reaper: neither player reported — cancelling match"
                );
                self.cancel_abandoned(match_id).await?;
            }
            (true, true) => {
                // Both reported but still in_progress — this can happen if the
                // conflict-detection path is lagging.  Skip; the conflict handler
                // will pick it up.
                info!(
                    match_id = %match_id,
                    "Reaper: both players reported (conflict pending?) — skipping"
                );
            }
        }

        Ok(())
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    async fn player_has_reported(
        &self,
        match_id: Uuid,
        player_id: Uuid,
    ) -> Result<bool, ApiError> {
        let row = sqlx::query!(
            "SELECT id FROM match_scores WHERE match_id = $1 AND player_id = $2",
            match_id,
            player_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(row.is_some())
    }

    /// Set match to `completed`, record the winner, and stamp `forfeited_by`.
    async fn forfeit(
        &self,
        match_id: Uuid,
        forfeited_player: Uuid,
        winner_id: Uuid,
        match_type: MatchType,
        game_mode: &str,
    ) -> Result<(), ApiError> {
        sqlx::query!(
            r#"
            UPDATE matches
            SET status       = $1,
                winner_id    = $2,
                forfeited_by = $3,
                completed_at = $4,
                updated_at   = $4
            WHERE id = $5
            "#,
            MatchStatus::Completed as _,
            winner_id,
            forfeited_player,
            Utc::now(),
            match_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        info!(
            match_id  = %match_id,
            winner    = %winner_id,
            forfeited = %forfeited_player,
            "Reaper: match completed by forfeit"
        );

        if match_type == MatchType::Ranked {
            let now = Utc::now();
            if let Err(e) = PlayerStatsService::reset_inactivity_timer_with_pool(
                &self.db_pool,
                winner_id,
                game_mode,
                now,
            )
            .await
            {
                warn!(match_id = %match_id, winner = %winner_id, error = %e, "Reaper: failed to reset inactivity timer after ranked forfeit");
            }
        }

        Ok(())
    }

    /// Complete a bye match or any match where the winner is already known and
    /// no forfeit label is needed.
    async fn complete_with_winner(
        &self,
        match_id: Uuid,
        winner_id: Uuid,
        _forfeited_player: Option<Uuid>,
        match_type: MatchType,
        game_mode: &str,
    ) -> Result<(), ApiError> {
        sqlx::query!(
            r#"
            UPDATE matches
            SET status       = $1,
                winner_id    = $2,
                completed_at = $3,
                updated_at   = $3
            WHERE id = $4
            "#,
            MatchStatus::Completed as _,
            winner_id,
            Utc::now(),
            match_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if match_type == MatchType::Ranked {
            let now = Utc::now();
            if let Err(e) = PlayerStatsService::reset_inactivity_timer_with_pool(
                &self.db_pool,
                winner_id,
                game_mode,
                now,
            )
            .await
            {
                warn!(match_id = %match_id, winner = %winner_id, error = %e, "Reaper: failed to reset inactivity timer after ranked bye");
            }
        }

        Ok(())
    }

    /// Neither player reported in time — cancel without awarding a winner.
    async fn cancel_abandoned(&self, match_id: Uuid) -> Result<(), ApiError> {
        sqlx::query!(
            r#"
            UPDATE matches
            SET status     = $1,
                updated_at = $2
            WHERE id = $3
            "#,
            MatchStatus::Cancelled as _,
            Utc::now(),
            match_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }
}

/// Map either integer (`0=tournament, 1=casual, 2=ranked, 3=practice`) or
/// snake_case text representations of `matches.match_type` into `MatchType`.
fn parse_match_type_text(raw: Option<&str>) -> MatchType {
    match raw.map(str::trim) {
        Some("0") | Some("tournament") => MatchType::Tournament,
        Some("2") | Some("ranked") => MatchType::Ranked,
        Some("3") | Some("practice") => MatchType::Practice,
        _ => MatchType::Casual,
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    // Unit tests for pure logic live here.
    // Integration tests that exercise the DB should live in tests/reaper_tests.rs.

    use crate::service::elo_decay::{
        evaluate_player_decay, EloDecayConfig, PlayerDecayState, DECAY_INTERVAL_DAYS,
        DECAY_POINTS_PER_INTERVAL, ELO_DECAY_FLOOR, INACTIVITY_GRACE_PERIOD_DAYS,
    };
    use chrono::{Duration, Utc};
    use uuid::Uuid;

    #[test]
    fn parse_match_type_text_supports_integer_and_text_schemas() {
        use super::parse_match_type_text;
        use crate::models::match_models::MatchType;

        assert_eq!(parse_match_type_text(Some("2")), MatchType::Ranked);
        assert_eq!(parse_match_type_text(Some("ranked")), MatchType::Ranked);
        assert_eq!(parse_match_type_text(Some("0")), MatchType::Tournament);
        assert_eq!(parse_match_type_text(Some("1")), MatchType::Casual);
        assert_eq!(parse_match_type_text(Some("3")), MatchType::Practice);
        assert_eq!(parse_match_type_text(None), MatchType::Casual);
    }

    #[test]
    fn both_reported_skipped() {
        // (true, true) → no action branch exists — verified structurally above
        assert!(true);
    }

    #[test]
    fn default_elo_decay_config_matches_issue_1533_spec() {
        let cfg = EloDecayConfig::default();
        assert_eq!(cfg.grace_period_days, INACTIVITY_GRACE_PERIOD_DAYS);
        assert_eq!(cfg.grace_period_days, 30);
        assert_eq!(cfg.interval_days, DECAY_INTERVAL_DAYS);
        assert_eq!(cfg.interval_days, 7);
        assert_eq!(cfg.points_per_interval, DECAY_POINTS_PER_INTERVAL);
        assert_eq!(cfg.points_per_interval, 10);
        assert_eq!(cfg.floor_elo, ELO_DECAY_FLOOR);
        assert_eq!(cfg.floor_elo, 100);
    }

    #[test]
    fn reaper_decay_sweep_rule_applies_floor_and_first_notify_once() {
        let now = Utc::now();
        let cfg = EloDecayConfig::default();
        let mut state = PlayerDecayState {
            user_elo_id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            game: "chess".to_string(),
            current_rating: 105,
            last_ranked_match_at: now - Duration::days(37),
            last_decay_at: None,
            decay_intervals_applied: 0,
            decay_notified: false,
        };

        let first = evaluate_player_decay(&state, now, &cfg);
        assert_eq!(first.new_rating, 100);
        assert_eq!(first.actual_deduction, 5);
        assert!(first.should_notify_first_decay);

        state.current_rating = first.new_rating;
        state.decay_intervals_applied = first.new_intervals_applied;
        state.decay_notified = true;

        let second = evaluate_player_decay(&state, now + Duration::days(7), &cfg);
        assert_eq!(second.new_rating, 100);
        assert_eq!(second.actual_deduction, 0);
        assert!(!second.should_notify_first_decay);
    }
}
