//! Pure ELO inactivity decay calculation and state machine — Issue #1533.
//!
//! Rules:
//! - **Grace period**: 30 days of inactivity after the player's last ranked match.
//! - **Decay rate**: 10 ELO points deducted per full 7-day period elapsed after
//!   the 30-day grace period (`floor((elapsed_days - 30) / 7) * 10`).
//! - **Floor**: 100 ELO. Decay stops at 100 and never reduces a player below
//!   100 (and leaves players already at `<= 100` unchanged with 0 deduction).
//! - **Idempotency**: Tracks `decay_intervals_applied` so repeated Reaper sweeps
//!   never double-deduct for the same 7-day interval.
//! - **First-decay push notification**: Triggered strictly once per inactivity
//!   spell when a player experiences their first actual ELO deduction (`> 0`).
//!   Pending notifications that fail transiently are retried on subsequent
//!   sweeps independently of whether another decay interval has elapsed.
//! - **Reset**: Playing any ranked match resets `last_ranked_match_at`,
//!   `decay_intervals_applied = 0`, `decay_notified = false`, and
//!   `last_decay_at = None`.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Number of inactive days before ELO decay starts counting.
pub const INACTIVITY_GRACE_PERIOD_DAYS: i64 = 30;

/// Length of each decay interval after the grace period (in days).
pub const DECAY_INTERVAL_DAYS: i64 = 7;

/// ELO points subtracted per full decay interval.
pub const DECAY_POINTS_PER_INTERVAL: i32 = 10;

/// Minimum ELO rating; inactivity decay cannot drop a player below this floor.
pub const ELO_DECAY_FLOOR: i32 = 100;

/// Maximum rows processed per 60s Reaper decay sweep to bound DB and HTTP work.
pub const DEFAULT_DECAY_SWEEP_BATCH_SIZE: i64 = 500;

const SECS_PER_DAY: i64 = 86_400;

/// Tunable parameters for inactivity ELO decay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EloDecayConfig {
    pub grace_period_days: i64,
    pub interval_days: i64,
    pub points_per_interval: i32,
    pub floor_elo: i32,
}

impl Default for EloDecayConfig {
    fn default() -> Self {
        Self {
            grace_period_days: INACTIVITY_GRACE_PERIOD_DAYS,
            interval_days: DECAY_INTERVAL_DAYS,
            points_per_interval: DECAY_POINTS_PER_INTERVAL,
            floor_elo: ELO_DECAY_FLOOR,
        }
    }
}

impl EloDecayConfig {
    /// Returns `true` if the configuration can legally produce decay intervals.
    pub fn is_valid(&self) -> bool {
        self.grace_period_days >= 0
            && self.interval_days > 0
            && self.points_per_interval > 0
            && self
                .grace_period_days
                .checked_add(self.interval_days)
                .and_then(Duration::try_days)
                .is_some()
    }
}

/// Snapshot of a player's per-game ELO inactivity state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerDecayState {
    pub user_elo_id: Uuid,
    pub user_id: Uuid,
    pub game: String,
    pub current_rating: i32,
    pub last_ranked_match_at: DateTime<Utc>,
    pub last_decay_at: Option<DateTime<Utc>>,
    pub decay_intervals_applied: i32,
    pub decay_notified: bool,
}

/// Pure result of evaluating a player's inactivity decay at a point in time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecayEvaluation {
    pub previous_rating: i32,
    pub new_rating: i32,
    pub actual_deduction: i32,
    pub total_intervals_elapsed: i32,
    pub new_intervals_applied: i32,
    pub should_notify_first_decay: bool,
    pub state_changed: bool,
}

/// Persisted decay event returned by `PlayerStatsService::apply_inactivity_elo_decay`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppliedEloDecay {
    pub user_elo_id: Uuid,
    pub user_id: Uuid,
    pub game: String,
    pub previous_rating: i32,
    pub new_rating: i32,
    pub points_deducted: i32,
    pub intervals_applied: i32,
    pub last_decay_at: DateTime<Utc>,
    pub should_notify_first_decay: bool,
}

/// Batch output from `PlayerStatsService::apply_inactivity_elo_decay`,
/// distinguishing total rows scanned from rows actually decayed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecaySweepBatch {
    pub candidates_scanned: usize,
    pub applied: Vec<AppliedEloDecay>,
}

/// A decayed `user_elo` row whose first-decay push notification has not yet
/// been delivered (e.g., after a transient failure on a prior Reaper sweep).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingDecayNotification {
    pub user_elo_id: Uuid,
    pub user_id: Uuid,
    pub game: String,
    pub current_rating: i32,
    pub last_decay_at: DateTime<Utc>,
}

/// Aggregate telemetry returned by a single Reaper inactivity decay sweep.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecaySweepSummary {
    pub candidates_evaluated: usize,
    pub players_decayed: usize,
    pub total_points_deducted: i64,
    pub notifications_pushed: usize,
    pub notifications_fallback: usize,
    pub notification_failures: usize,
    pub leaderboard_entries_synced: usize,
}

/// Compute the total number of complete `interval_days` periods elapsed past
/// `grace_period_days` since `last_ranked_match_at`.
///
/// Returns `0` if `now <= last_ranked_match_at`, if the player is still within
/// the grace period (inclusive of exact `grace_period_days`), or if `config`
/// has invalid/out-of-range day values.
pub fn compute_total_decay_intervals(
    last_ranked_match_at: DateTime<Utc>,
    now: DateTime<Utc>,
    config: &EloDecayConfig,
) -> i32 {
    if !config.is_valid() || now <= last_ranked_match_at {
        return 0;
    }

    let Some(grace) = Duration::try_days(config.grace_period_days) else {
        return 0;
    };

    let elapsed = now.signed_duration_since(last_ranked_match_at);
    if elapsed <= grace {
        return 0;
    }

    let past_grace_secs = (elapsed - grace).num_seconds();
    let interval_secs = match config.interval_days.checked_mul(SECS_PER_DAY) {
        Some(secs) if secs > 0 => secs,
        _ => return 0,
    };

    let intervals = past_grace_secs / interval_secs;
    intervals.clamp(0, i32::MAX as i64) as i32
}

/// Evaluate inactivity ELO decay for a single player record at timestamp `now`.
///
/// Guarantees:
/// - Never deducts during the 30-day grace period or before a full 7-day
///   interval past the grace period completes.
/// - Never double-deducts across repeated calls when `decay_intervals_applied`
///   is persisted.
/// - Never lowers rating below `config.floor_elo` (100), and never modifies a
///   player already at `<= config.floor_elo`.
/// - Sets `should_notify_first_decay = true` strictly when `actual_deduction > 0`
///   and `!state.decay_notified`.
pub fn evaluate_player_decay(
    state: &PlayerDecayState,
    now: DateTime<Utc>,
    config: &EloDecayConfig,
) -> DecayEvaluation {
    let total_intervals = compute_total_decay_intervals(state.last_ranked_match_at, now, config);
    let already_applied = state.decay_intervals_applied.max(0);
    let pending_intervals = total_intervals.saturating_sub(already_applied);

    if pending_intervals == 0 || !config.is_valid() {
        return DecayEvaluation {
            previous_rating: state.current_rating,
            new_rating: state.current_rating,
            actual_deduction: 0,
            total_intervals_elapsed: total_intervals,
            new_intervals_applied: already_applied,
            should_notify_first_decay: false,
            state_changed: false,
        };
    }

    // Players already at or below the floor lose 0 ELO and are never bumped up
    // or sent a decay notification.
    if state.current_rating <= config.floor_elo {
        return DecayEvaluation {
            previous_rating: state.current_rating,
            new_rating: state.current_rating,
            actual_deduction: 0,
            total_intervals_elapsed: total_intervals,
            new_intervals_applied: total_intervals,
            should_notify_first_decay: false,
            state_changed: total_intervals != state.decay_intervals_applied,
        };
    }

    let raw_deduction = pending_intervals.saturating_mul(config.points_per_interval);
    let new_rating = state
        .current_rating
        .saturating_sub(raw_deduction)
        .max(config.floor_elo);
    let actual_deduction = state.current_rating.saturating_sub(new_rating);
    let should_notify_first_decay = actual_deduction > 0 && !state.decay_notified;

    DecayEvaluation {
        previous_rating: state.current_rating,
        new_rating,
        actual_deduction,
        total_intervals_elapsed: total_intervals,
        new_intervals_applied: total_intervals,
        should_notify_first_decay,
        state_changed: actual_deduction > 0 || total_intervals != state.decay_intervals_applied,
    }
}

/// Apply a match completion to an in-memory `PlayerDecayState`.
///
/// Only ranked matches reset the inactivity clock and first-decay notification
/// flag; casual/practice matches leave decay tracking untouched.
pub fn reset_inactivity_on_match(
    state: &mut PlayerDecayState,
    match_completed_at: DateTime<Utc>,
    is_ranked: bool,
) -> bool {
    if !is_ranked {
        return false;
    }

    state.last_ranked_match_at = match_completed_at;
    state.last_decay_at = None;
    state.decay_intervals_applied = 0;
    state.decay_notified = false;
    true
}

/// Build the title, body, and structured FCM data payload for a player's first
/// ELO inactivity decay push notification.
pub fn build_first_decay_notification(
    game: &str,
    previous_rating: i32,
    new_rating: i32,
    points_deducted: i32,
) -> (String, String, HashMap<String, String>) {
    let title = "ELO Rating Decay Notice".to_string();
    let body = format!(
        "Your {game} ELO decayed by {points_deducted} points due to inactivity ({previous_rating} -> {new_rating}). Play a ranked match to stop further decay."
    );

    let mut data = HashMap::new();
    data.insert("type".to_string(), "elo_decay".to_string());
    data.insert("game".to_string(), game.to_string());
    data.insert("previous_elo".to_string(), previous_rating.to_string());
    data.insert("new_elo".to_string(), new_rating.to_string());
    data.insert("elo_lost".to_string(), points_deducted.to_string());
    data.insert("floor_elo".to_string(), ELO_DECAY_FLOOR.to_string());

    (title, body, data)
}

/// Build a retry notification payload for a player whose first ELO decay was
/// already persisted on an earlier sweep whose push delivery failed transiently.
pub fn build_pending_decay_notification(
    game: &str,
    current_rating: i32,
) -> (String, String, HashMap<String, String>) {
    let title = "ELO Rating Decay Notice".to_string();
    let body = format!(
        "Your {game} ELO has started decaying due to inactivity (current rating: {current_rating}). Play a ranked match to stop further decay."
    );

    let mut data = HashMap::new();
    data.insert("type".to_string(), "elo_decay".to_string());
    data.insert("game".to_string(), game.to_string());
    data.insert("new_elo".to_string(), current_rating.to_string());
    data.insert("floor_elo".to_string(), ELO_DECAY_FLOOR.to_string());

    (title, body, data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn make_state(rating: i32, last_match: DateTime<Utc>) -> PlayerDecayState {
        PlayerDecayState {
            user_elo_id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            game: "chess".to_string(),
            current_rating: rating,
            last_ranked_match_at: last_match,
            last_decay_at: None,
            decay_intervals_applied: 0,
            decay_notified: false,
        }
    }

    #[test]
    fn no_decay_within_and_at_exact_30_day_grace_period() {
        let t0 = base_time();
        let cfg = EloDecayConfig::default();
        let state = make_state(1500, t0);

        for days in [0, 1, 15, 29, 30] {
            let eval = evaluate_player_decay(&state, t0 + Duration::days(days), &cfg);
            assert_eq!(eval.actual_deduction, 0, "day {days} must not decay");
            assert_eq!(eval.new_rating, 1500);
            assert!(!eval.should_notify_first_decay);
            assert!(!eval.state_changed);
        }
    }

    #[test]
    fn no_decay_before_first_full_7_day_interval_after_grace() {
        let t0 = base_time();
        let cfg = EloDecayConfig::default();
        let state = make_state(1500, t0);

        let just_past_grace = t0 + Duration::days(30) + Duration::seconds(1);
        let eval1 = evaluate_player_decay(&state, just_past_grace, &cfg);
        assert_eq!(eval1.actual_deduction, 0);
        assert_eq!(eval1.total_intervals_elapsed, 0);
        assert!(!eval1.should_notify_first_decay);

        let one_sec_before_37d = t0 + Duration::days(37) - Duration::seconds(1);
        let eval2 = evaluate_player_decay(&state, one_sec_before_37d, &cfg);
        assert_eq!(eval2.actual_deduction, 0);
        assert_eq!(eval2.total_intervals_elapsed, 0);
        assert!(!eval2.should_notify_first_decay);
    }

    #[test]
    fn exact_37_days_deducts_10_elo_and_triggers_first_notification() {
        let t0 = base_time();
        let cfg = EloDecayConfig::default();
        let state = make_state(1500, t0);

        let eval = evaluate_player_decay(&state, t0 + Duration::days(37), &cfg);
        assert_eq!(eval.total_intervals_elapsed, 1);
        assert_eq!(eval.new_intervals_applied, 1);
        assert_eq!(eval.actual_deduction, 10);
        assert_eq!(eval.new_rating, 1490);
        assert!(eval.should_notify_first_decay);
        assert!(eval.state_changed);
    }

    #[test]
    fn repeated_reaper_runs_are_idempotent_and_do_not_double_deduct_or_renotify() {
        let t0 = base_time();
        let cfg = EloDecayConfig::default();
        let mut state = make_state(1500, t0);

        // First sweep at day 37
        let first = evaluate_player_decay(&state, t0 + Duration::days(37), &cfg);
        assert_eq!(first.actual_deduction, 10);
        assert!(first.should_notify_first_decay);

        // Persist first sweep outcome
        state.current_rating = first.new_rating;
        state.decay_intervals_applied = first.new_intervals_applied;
        state.last_decay_at = Some(t0 + Duration::days(37));
        state.decay_notified = true;

        // Second sweep 60 seconds later -> strict no-op
        let second = evaluate_player_decay(
            &state,
            t0 + Duration::days(37) + Duration::seconds(60),
            &cfg,
        );
        assert_eq!(second.actual_deduction, 0);
        assert_eq!(second.new_rating, 1490);
        assert!(!second.should_notify_first_decay);
        assert!(!second.state_changed);

        // Third sweep at day 44 -> second interval deducts 10 more, NO duplicate notification
        let third = evaluate_player_decay(&state, t0 + Duration::days(44), &cfg);
        assert_eq!(third.actual_deduction, 10);
        assert_eq!(third.new_rating, 1480);
        assert_eq!(third.new_intervals_applied, 2);
        assert!(!third.should_notify_first_decay);
        assert!(third.state_changed);
    }

    #[test]
    fn multi_interval_catchup_sweep_deducts_all_missed_intervals() {
        let t0 = base_time();
        let cfg = EloDecayConfig::default();
        let state = make_state(1500, t0);

        // 51 days = 30 grace + 3 full 7-day intervals -> 30 ELO
        let eval = evaluate_player_decay(&state, t0 + Duration::days(51), &cfg);
        assert_eq!(eval.total_intervals_elapsed, 3);
        assert_eq!(eval.actual_deduction, 30);
        assert_eq!(eval.new_rating, 1470);
        assert!(eval.should_notify_first_decay);
    }

    #[test]
    fn clamps_to_100_elo_floor_and_never_notifies_when_already_at_or_below_floor() {
        let t0 = base_time();
        let cfg = EloDecayConfig::default();

        // 105 ELO -> clamps to 100, actual deduction 5, notifies once
        let near_floor = make_state(105, t0);
        let eval_near = evaluate_player_decay(&near_floor, t0 + Duration::days(37), &cfg);
        assert_eq!(eval_near.new_rating, 100);
        assert_eq!(eval_near.actual_deduction, 5);
        assert!(eval_near.should_notify_first_decay);

        // Exactly 100 ELO -> 0 deduction, NO notification
        let at_floor = make_state(100, t0);
        let eval_at = evaluate_player_decay(&at_floor, t0 + Duration::days(44), &cfg);
        assert_eq!(eval_at.new_rating, 100);
        assert_eq!(eval_at.actual_deduction, 0);
        assert!(!eval_at.should_notify_first_decay);

        // Below floor (80 and -50 ELO) -> untouched, no underflow, no upward clamp, no notification
        for rating in [80, 0, -50] {
            let below_floor = make_state(rating, t0);
            let eval_below = evaluate_player_decay(&below_floor, t0 + Duration::days(60), &cfg);
            assert_eq!(eval_below.new_rating, rating);
            assert_eq!(eval_below.actual_deduction, 0);
            assert!(!eval_below.should_notify_first_decay);
        }
    }

    #[test]
    fn extreme_inactivity_saturates_cleanly_at_floor() {
        let t0 = base_time();
        let cfg = EloDecayConfig::default();
        let state = make_state(2400, t0);

        let eval = evaluate_player_decay(&state, t0 + Duration::days(36_500), &cfg);
        assert_eq!(eval.new_rating, ELO_DECAY_FLOOR);
        assert_eq!(eval.actual_deduction, 2300);
        assert!(eval.should_notify_first_decay);
    }

    #[test]
    fn invalid_config_and_negative_applied_intervals_are_handled_safely() {
        let t0 = base_time();
        let state = make_state(1500, t0);

        for invalid in [
            EloDecayConfig {
                interval_days: 0,
                ..Default::default()
            },
            EloDecayConfig {
                points_per_interval: 0,
                ..Default::default()
            },
            EloDecayConfig {
                grace_period_days: -1,
                ..Default::default()
            },
            EloDecayConfig {
                grace_period_days: i64::MAX,
                ..Default::default()
            },
        ] {
            assert!(!invalid.is_valid());
            let eval = evaluate_player_decay(&state, t0 + Duration::days(60), &invalid);
            assert_eq!(eval.actual_deduction, 0);
            assert!(!eval.should_notify_first_decay);
        }

        // Negative persisted `decay_intervals_applied` clamps safely to 0
        let mut corrupt = make_state(1500, t0);
        corrupt.decay_intervals_applied = -5;
        let eval = evaluate_player_decay(
            &corrupt,
            t0 + Duration::days(37),
            &EloDecayConfig::default(),
        );
        assert_eq!(eval.actual_deduction, 10);
        assert_eq!(eval.new_intervals_applied, 1);
    }

    #[test]
    fn clock_skew_in_future_is_safe_noop() {
        let t0 = base_time();
        let cfg = EloDecayConfig::default();
        let state = make_state(1400, t0);

        let eval = evaluate_player_decay(&state, t0 - Duration::days(5), &cfg);
        assert_eq!(eval.actual_deduction, 0);
        assert_eq!(eval.new_rating, 1400);
        assert!(!eval.should_notify_first_decay);
        assert!(!eval.state_changed);
    }

    #[test]
    fn ranked_match_resets_inactivity_timer_and_notification_flag() {
        let t0 = base_time();
        let cfg = EloDecayConfig::default();
        let mut state = make_state(105, t0);

        // Decay once at day 37 (105 -> 100 floor)
        let first = evaluate_player_decay(&state, t0 + Duration::days(37), &cfg);
        assert_eq!(first.new_rating, 100);
        assert_eq!(first.actual_deduction, 5);
        assert!(first.should_notify_first_decay);

        state.current_rating = first.new_rating;
        state.decay_intervals_applied = first.new_intervals_applied;
        state.last_decay_at = Some(t0 + Duration::days(37));
        state.decay_notified = true;

        // Casual match at day 40 must NOT reset inactivity
        assert!(!reset_inactivity_on_match(
            &mut state,
            t0 + Duration::days(40),
            false
        ));
        assert_eq!(state.last_ranked_match_at, t0);
        assert_eq!(state.decay_intervals_applied, 1);
        assert!(state.decay_notified);

        // Ranked match at day 40 raises ELO to 120 and resets everything
        let t_ranked = t0 + Duration::days(40);
        state.current_rating = 120;
        assert!(reset_inactivity_on_match(&mut state, t_ranked, true));
        assert_eq!(state.last_ranked_match_at, t_ranked);
        assert_eq!(state.decay_intervals_applied, 0);
        assert!(!state.decay_notified);
        assert!(state.last_decay_at.is_none());

        // 30 days after ranked match -> still in fresh grace period
        let eval_grace = evaluate_player_decay(&state, t_ranked + Duration::days(30), &cfg);
        assert_eq!(eval_grace.actual_deduction, 0);

        // 37 days after ranked match -> decays again and sends first-decay push for new spell
        let eval_new_spell = evaluate_player_decay(&state, t_ranked + Duration::days(37), &cfg);
        assert_eq!(eval_new_spell.actual_deduction, 10);
        assert_eq!(eval_new_spell.new_rating, 110);
        assert!(eval_new_spell.should_notify_first_decay);
    }

    #[test]
    fn builds_structured_first_and_pending_decay_notifications() {
        let (title, body, data) = build_first_decay_notification("chess", 1500, 1490, 10);
        assert_eq!(title, "ELO Rating Decay Notice");
        assert!(body.contains("chess"));
        assert!(body.contains("10"));
        assert!(body.contains("1500 -> 1490"));
        assert_eq!(data.get("type").map(String::as_str), Some("elo_decay"));
        assert_eq!(data.get("game").map(String::as_str), Some("chess"));
        assert_eq!(data.get("previous_elo").map(String::as_str), Some("1500"));
        assert_eq!(data.get("new_elo").map(String::as_str), Some("1490"));
        assert_eq!(data.get("elo_lost").map(String::as_str), Some("10"));
        assert_eq!(data.get("floor_elo").map(String::as_str), Some("100"));

        let (r_title, r_body, r_data) = build_pending_decay_notification("chess", 100);
        assert_eq!(r_title, "ELO Rating Decay Notice");
        assert!(r_body.contains("100"));
        assert_eq!(r_data.get("new_elo").map(String::as_str), Some("100"));
    }
}
