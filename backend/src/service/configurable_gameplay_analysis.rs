//! Configurable gameplay analysis — Issue #1358.
//!
//! Wraps the existing `GameplayAnalysis` scoring engine with runtime-configurable
//! thresholds loaded from `AntiCheatConfigStore`. The composite suspicion score
//! is recomputed from weighted rule hits against the live config; the inner
//! engine is still invoked for state tracking (sequence ordering, sample
//! counts, alert history).

use crate::service::anti_cheat_config::{AntiCheatConfig, AntiCheatConfigStore};
use crate::service::gameplay_analysis::{AnalysisError, GameplayAnalysis, IngestResult, TelemetryFrame};
use std::sync::Arc;
use uuid::Uuid;

/// One rule that fired for a frame, with the threshold it crossed.
///
/// Carried alongside the score so the caller can log *which* rule flagged a
/// session and at what threshold (Issue #1525), not just the total score.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleHit {
    pub name: String,
    pub weight: u8,
    pub threshold: u32,
    pub reason: String,
}

fn hit(rule: &crate::service::anti_cheat_config::RuleConfig, reason: &str) -> RuleHit {
    RuleHit {
        name: rule.name.clone(),
        weight: rule.weight,
        threshold: rule.threshold,
        reason: reason.to_string(),
    }
}

/// Score one frame using the provided [`AntiCheatConfig`], returning every rule
/// that fired with its threshold.
pub fn score_frame_with_config_detailed(
    frame: &TelemetryFrame,
    config: &AntiCheatConfig,
) -> (u8, Vec<RuleHit>) {
    let mut score: u32 = 0;
    let mut hits: Vec<RuleHit> = Vec::new();

    // --- Reaction rules (mutually exclusive: inhuman takes priority) ----------
    if let Some(rule) = config.rules.get("reaction_inhuman") {
        if rule.enabled && frame.reaction_ms < rule.threshold {
            score += rule.weight as u32;
            hits.push(hit(rule, "reaction below human floor"));
        } else if let Some(fast_rule) = config.rules.get("reaction_fast") {
            if fast_rule.enabled && frame.reaction_ms < fast_rule.threshold {
                score += fast_rule.weight as u32;
                hits.push(hit(fast_rule, "reaction faster than expected"));
            }
        }
    } else if let Some(fast_rule) = config.rules.get("reaction_fast") {
        // inhuman rule absent — still check fast rule independently
        if fast_rule.enabled && frame.reaction_ms < fast_rule.threshold {
            score += fast_rule.weight as u32;
            hits.push(hit(fast_rule, "reaction faster than expected"));
        }
    }

    // --- Accuracy rules (mutually exclusive: extreme takes priority) ----------
    if let Some(rule) = config.rules.get("accuracy_extreme") {
        if rule.enabled && frame.accuracy_bps > rule.threshold {
            score += rule.weight as u32;
            hits.push(hit(rule, "accuracy above 95%"));
        } else if let Some(high_rule) = config.rules.get("accuracy_high") {
            if high_rule.enabled && frame.accuracy_bps > high_rule.threshold {
                score += high_rule.weight as u32;
                hits.push(hit(high_rule, "accuracy above 85%"));
            }
        }
    } else if let Some(high_rule) = config.rules.get("accuracy_high") {
        if high_rule.enabled && frame.accuracy_bps > high_rule.threshold {
            score += high_rule.weight as u32;
            hits.push(hit(high_rule, "accuracy above 85%"));
        }
    }

    // --- Snap / aim-assist rules (mutually exclusive: extreme takes priority) -
    if let Some(rule) = config.rules.get("snap_extreme") {
        if rule.enabled && frame.snap_deg_per_sec > rule.threshold {
            score += rule.weight as u32;
            hits.push(hit(rule, "snap faster than 1440 deg/s"));
        } else if let Some(fast_rule) = config.rules.get("snap_fast") {
            if fast_rule.enabled && frame.snap_deg_per_sec > fast_rule.threshold {
                score += fast_rule.weight as u32;
                hits.push(hit(fast_rule, "snap faster than 720 deg/s"));
            }
        }
    } else if let Some(fast_rule) = config.rules.get("snap_fast") {
        if fast_rule.enabled && frame.snap_deg_per_sec > fast_rule.threshold {
            score += fast_rule.weight as u32;
            hits.push(hit(fast_rule, "snap faster than 720 deg/s"));
        }
    }

    // --- Speed hack (independent) --------------------------------------------
    if let Some(rule) = config.rules.get("speed_hack") {
        if rule.enabled && frame.speed_milli > frame.speed_limit_milli {
            score += rule.weight as u32;
            hits.push(hit(rule, "speed above the game limit"));
        }
    }

    // --- Scripted input / entropy (independent) ------------------------------
    if let Some(rule) = config.rules.get("input_scripted") {
        if rule.enabled && frame.entropy_bps < rule.threshold {
            score += rule.weight as u32;
            hits.push(hit(rule, "input entropy looks scripted"));
        }
    }

    ((score.min(100)) as u8, hits)
}

/// Score one frame using the provided [`AntiCheatConfig`] instead of the
/// hardcoded constants in `gameplay_analysis::infer()`.
///
/// Returns `(score, reasons)` where `score` is capped at 100 and `reasons`
/// lists the human-readable labels of every rule that fired.
pub fn score_frame_with_config(
    frame: &TelemetryFrame,
    config: &AntiCheatConfig,
) -> (u8, Vec<String>) {
    let (score, hits) = score_frame_with_config_detailed(frame, config);
    (score, hits.into_iter().map(|hit| hit.reason).collect())
}

/// Wrapper around [`GameplayAnalysis`] that uses [`AntiCheatConfigStore`] for
/// scoring thresholds instead of the hardcoded constants in the inner engine.
///
/// The inner engine is still invoked on every frame so that sequence-ordering
/// checks, per-match sample counts, and alert history remain accurate.
/// The returned [`IngestResult`] carries the *configurable* score and alert
/// flag, overriding whatever the inner engine computed.
pub struct ConfigurableGameplayAnalysis {
    inner: Arc<GameplayAnalysis>,
    config_store: Arc<AntiCheatConfigStore>,
}

impl ConfigurableGameplayAnalysis {
    pub fn new(inner: Arc<GameplayAnalysis>, config_store: Arc<AntiCheatConfigStore>) -> Self {
        Self {
            inner,
            config_store,
        }
    }

    /// Ingest a frame using runtime-configurable thresholds.
    ///
    /// The configurable scorer runs first to produce `(score, reasons, alert)`.
    /// The inner engine runs second for state bookkeeping. The returned
    /// [`IngestResult`] uses the configurable values.
    pub async fn ingest_configured(
        &self,
        frame: TelemetryFrame,
    ) -> Result<IngestResult, AnalysisError> {
        let config = self.config_store.get();
        let (score, hits) = score_frame_with_config_detailed(&frame, &config);
        let alert = score >= config.flag_threshold;

        if alert {
            for hit in &hits {
                tracing::warn!(
                    match_id = %frame.match_id,
                    player_id = %frame.player_id,
                    rule = %hit.name,
                    threshold = hit.threshold,
                    weight = hit.weight,
                    score,
                    flag_threshold = config.flag_threshold,
                    "gameplay session flagged by anti-cheat rule"
                );
            }
        }

        let reasons: Vec<String> = hits.into_iter().map(|hit| hit.reason).collect();

        // Run the inner engine for sequence / sample / alert bookkeeping.
        // We discard its IngestResult fields and substitute our own.
        let inner_result = self.inner.ingest(frame).await;

        match inner_result {
            Ok(mut result) => {
                result.score = score;
                result.alert = alert;
                result.reasons = reasons;
                Ok(result)
            }
            Err(e) => Err(e),
        }
    }

    /// Access the underlying config store (e.g. to adjust thresholds at runtime).
    pub fn config_store(&self) -> &Arc<AntiCheatConfigStore> {
        &self.config_store
    }

    /// Retrieve the per-match monitoring snapshot from the inner engine.
    pub async fn monitor(
        &self,
        match_id: Uuid,
    ) -> crate::service::gameplay_analysis::MatchMonitor {
        self.inner.monitor(match_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::anti_cheat_config::{
        AntiCheatConfig, AntiCheatConfigStore, DefaultConfigProvider, StaticConfigProvider,
    };
    use crate::service::gameplay_analysis::TelemetryFrame;
    use std::sync::Arc;
    use std::time::Duration;

    fn make_frame(seq: u64, reaction_ms: u32) -> TelemetryFrame {
        TelemetryFrame {
            match_id: uuid::Uuid::from_u128(1),
            player_id: uuid::Uuid::from_u128(2),
            seq,
            reaction_ms,
            accuracy_bps: 5_000,
            snap_deg_per_sec: 90,
            speed_milli: 500,
            speed_limit_milli: 1_000,
            entropy_bps: 7_000,
        }
    }

    // -------------------------------------------------------------------------
    // Issue #1358 key requirement: low threshold flags borderline telemetry
    // -------------------------------------------------------------------------

    /// Sets flag_threshold to 1 so that any single rule hit triggers a flag.
    /// A frame with reaction_ms=85 hits "reaction_fast" (weight 30), which
    /// exceeds a threshold of 1, so the match must be flagged.
    #[test]
    fn low_threshold_flags_borderline_telemetry() {
        let mut config = AntiCheatConfig::default();
        config.flag_threshold = 1;

        let store = AntiCheatConfigStore::new(
            Duration::from_secs(60),
            Arc::new(StaticConfigProvider::new(config)),
        );
        store.refresh();

        // reaction_ms=85 is below the reaction_fast threshold of 90 → weight 30
        let frame = make_frame(1, 85);
        let current = store.get();
        let (score, reasons) = score_frame_with_config(&frame, &current);

        assert!(score > 0, "expected non-zero score for fast reaction (got 0)");
        assert!(
            score >= current.flag_threshold,
            "borderline frame must be flagged with low threshold (score={score}, threshold={})",
            current.flag_threshold
        );
        assert!(!reasons.is_empty(), "at least one reason must be reported");
    }

    // -------------------------------------------------------------------------
    // Default config does not flag normal play
    // -------------------------------------------------------------------------

    #[test]
    fn default_config_does_not_flag_normal_play() {
        let store = AntiCheatConfigStore::new(
            Duration::from_secs(60),
            Arc::new(DefaultConfigProvider),
        );
        // reaction_ms=180 is well above both reaction thresholds
        let frame = make_frame(1, 180);
        let config = store.get();
        let (score, _) = score_frame_with_config(&frame, &config);
        assert!(
            score < config.flag_threshold,
            "normal play should not be flagged (score={score}, threshold={})",
            config.flag_threshold
        );
    }

    // -------------------------------------------------------------------------
    // Individual rule assertions
    // -------------------------------------------------------------------------

    #[test]
    fn speed_hack_always_fires_when_speed_exceeds_limit() {
        let config = AntiCheatConfig::default();
        let mut frame = make_frame(1, 180);
        frame.speed_milli = 5_000;
        frame.speed_limit_milli = 1_000;

        let (score, reasons) = score_frame_with_config(&frame, &config);

        assert!(
            reasons.iter().any(|r| r.contains("speed")),
            "expected speed reason, got: {reasons:?}"
        );
        assert!(score > 0);
    }

    #[test]
    fn disabled_rule_does_not_contribute_to_score() {
        let mut config = AntiCheatConfig::default();
        if let Some(rule) = config.rules.get_mut("speed_hack") {
            rule.enabled = false;
        }
        let mut frame = make_frame(1, 180);
        frame.speed_milli = 5_000;
        frame.speed_limit_milli = 1_000;

        let (score, reasons) = score_frame_with_config(&frame, &config);

        assert!(
            !reasons.iter().any(|r| r.contains("speed")),
            "disabled speed_hack rule must not contribute (reasons: {reasons:?})"
        );
        // score may still be 0 for a normal frame with speed hack disabled
        let _ = score;
    }

    #[test]
    fn reaction_inhuman_takes_priority_over_reaction_fast() {
        let config = AntiCheatConfig::default();
        // reaction_ms=20 is below both thresholds; inhuman (weight 50) should fire,
        // not fast (weight 30).
        let frame = make_frame(1, 20);
        let (score, reasons) = score_frame_with_config(&frame, &config);

        assert!(
            reasons.iter().any(|r| r.contains("human floor")),
            "expected inhuman floor reason, got: {reasons:?}"
        );
        assert!(
            !reasons.iter().any(|r| r.contains("faster than expected")),
            "fast rule must not fire when inhuman rule fires"
        );
        assert_eq!(score, 50, "only inhuman weight should be counted");
    }

    #[test]
    fn reaction_fast_fires_when_inhuman_does_not() {
        let config = AntiCheatConfig::default();
        // reaction_ms=85: above inhuman threshold (50), below fast threshold (90)
        let frame = make_frame(1, 85);
        let (score, reasons) = score_frame_with_config(&frame, &config);

        assert!(
            reasons.iter().any(|r| r.contains("faster than expected")),
            "expected fast reaction reason, got: {reasons:?}"
        );
        assert_eq!(score, 30, "only fast weight should be counted");
    }

    #[test]
    fn multiple_independent_rules_accumulate_score() {
        let config = AntiCheatConfig::default();
        let mut frame = make_frame(1, 20); // inhuman reaction → +50
        frame.speed_milli = 5_000; // speed hack → +40
        frame.speed_limit_milli = 1_000;
        frame.entropy_bps = 100; // scripted input → +15

        let (score, reasons) = score_frame_with_config(&frame, &config);

        // 50 + 40 + 15 = 105, capped at 100
        assert_eq!(score, 100);
        assert_eq!(
            reasons.len(),
            3,
            "expected three distinct reasons, got: {reasons:?}"
        );
    }

    #[test]
    fn all_rules_disabled_yields_zero_score() {
        let mut config = AntiCheatConfig::default();
        for rule in config.rules.values_mut() {
            rule.enabled = false;
        }
        let mut frame = make_frame(1, 10);
        frame.speed_milli = 9_999;
        frame.speed_limit_milli = 1;
        frame.accuracy_bps = 10_000;
        frame.snap_deg_per_sec = 9_999;
        frame.entropy_bps = 0;

        let (score, reasons) = score_frame_with_config(&frame, &config);
        assert_eq!(score, 0, "all rules disabled must yield score 0");
        assert!(reasons.is_empty());
    }

    // -------------------------------------------------------------------------
    // Runtime config update via store helpers
    // -------------------------------------------------------------------------

    #[test]
    fn set_flag_threshold_takes_effect_immediately() {
        let store = AntiCheatConfigStore::new(
            Duration::from_secs(60),
            Arc::new(DefaultConfigProvider),
        );
        store.refresh();
        store.set_flag_threshold(1);
        assert_eq!(store.get().flag_threshold, 1);
    }

    #[test]
    fn set_rule_weight_takes_effect_immediately() {
        let store = AntiCheatConfigStore::new(
            Duration::from_secs(60),
            Arc::new(DefaultConfigProvider),
        );
        store.refresh();
        store.set_rule_weight("reaction_fast", 99);
        let frame = make_frame(1, 85);
        let (score, _) = score_frame_with_config(&frame, &store.get());
        assert_eq!(score, 99, "updated weight must be reflected in scoring");
    }

    // -------------------------------------------------------------------------
    // Integration: ConfigurableGameplayAnalysis end-to-end
    // -------------------------------------------------------------------------

    #[tokio::test]
    async fn configurable_analysis_flags_match_with_low_threshold() {
        let mut config = AntiCheatConfig::default();
        config.flag_threshold = 1; // any rule hit → flagged

        let store = Arc::new(AntiCheatConfigStore::new(
            Duration::from_secs(60),
            Arc::new(StaticConfigProvider::new(config)),
        ));
        store.refresh();

        let inner = Arc::new(GameplayAnalysis::new(None));
        let analysis = ConfigurableGameplayAnalysis::new(inner, store);

        // reaction_ms=85 → reaction_fast fires (weight 30) → score=30 ≥ threshold=1
        let result = analysis.ingest_configured(make_frame(1, 85)).await.unwrap();
        assert!(result.alert, "frame must be flagged with threshold=1 and score={}", result.score);
        assert!(result.score > 0);
    }

    #[tokio::test]
    async fn configurable_analysis_does_not_flag_normal_play_at_default_threshold() {
        let store = Arc::new(AntiCheatConfigStore::new(
            Duration::from_secs(60),
            Arc::new(DefaultConfigProvider),
        ));

        let inner = Arc::new(GameplayAnalysis::new(None));
        let analysis = ConfigurableGameplayAnalysis::new(inner, store);

        let result = analysis.ingest_configured(make_frame(1, 180)).await.unwrap();
        assert!(!result.alert, "normal play must not be flagged");
        assert_eq!(result.score, 0);
    }

    #[tokio::test]
    async fn replay_sequence_is_rejected_by_inner_engine() {
        let store = Arc::new(AntiCheatConfigStore::new(
            Duration::from_secs(60),
            Arc::new(DefaultConfigProvider),
        ));
        let inner = Arc::new(GameplayAnalysis::new(None));
        let analysis = ConfigurableGameplayAnalysis::new(inner, store);

        analysis.ingest_configured(make_frame(1, 180)).await.unwrap();
        let err = analysis.ingest_configured(make_frame(1, 180)).await;
        assert!(
            matches!(err, Err(AnalysisError::Replay)),
            "duplicate sequence must be rejected"
        );
    }

    // -------------------------------------------------------------------------
    // Issue #1525: the flag log needs the matched rule and its threshold
    // -------------------------------------------------------------------------

    #[test]
    fn detailed_scoring_reports_the_matched_rule_and_threshold() {
        let config = AntiCheatConfig::default();
        let frame = make_frame(1, 85);

        let (score, hits) = score_frame_with_config_detailed(&frame, &config);

        assert_eq!(score, 30, "reaction_fast carries weight 30");
        let hit = hits
            .iter()
            .find(|hit| hit.name == "reaction_fast")
            .expect("reaction_fast must be reported");
        assert_eq!(hit.threshold, 90);
        assert_eq!(hit.weight, 30);
    }

    #[test]
    fn disabling_a_rule_removes_its_weight() {
        let mut config = AntiCheatConfig::default();
        config.rules.get_mut("reaction_fast").unwrap().enabled = false;

        let frame = make_frame(1, 85);
        let (score, hits) = score_frame_with_config_detailed(&frame, &config);

        assert_eq!(score, 0);
        assert!(hits.is_empty());
    }

    #[test]
    fn a_custom_threshold_changes_when_the_rule_fires() {
        let mut config = AntiCheatConfig::default();
        config.rules.get_mut("reaction_fast").unwrap().threshold = 80;

        // 85ms is no longer "fast" once the admin lowers the threshold to 80ms.
        let (score, _) = score_frame_with_config_detailed(&make_frame(1, 85), &config);
        assert_eq!(score, 0);
    }
}
