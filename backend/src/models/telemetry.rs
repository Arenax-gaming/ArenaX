//! Gameplay telemetry schema for anti-cheat analysis.
//!
//! A client captures what the player actually did during a match (inputs,
//! actions, per-frame timings and client-side performance counters) and uploads
//! the whole recording as one document. The document is analysed, hashed and
//! stored in S3/MinIO; only a small [`TelemetryReference`] — the object key,
//! its hash and the retention deadline — is linked to the match record.
//!
//! The per-event metric fields deliberately mirror
//! [`crate::service::gameplay_analysis::TelemetryFrame`] so the same bounded
//! scorer used for the real-time path can be replayed over a stored recording
//! without a second, divergent definition of "suspicious".

use crate::api_error::ApiError;
use crate::service::gameplay_analysis::{self, ALERT_THRESHOLD, TelemetryFrame};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Version of the wire/log schema. Bump when a field's meaning changes so a
/// stored recording can still be interpreted correctly years later.
pub const TELEMETRY_SCHEMA_VERSION: u32 = 1;

/// Upper bound on the number of events accepted in a single recording. Bounds
/// both the body size and the cost of the replay analysis.
pub const MAX_TELEMETRY_EVENTS: usize = 100_000;

/// Hard cap on the serialized document size. Rejected before any upload is
/// attempted so an oversized body never reaches object storage.
pub const MAX_TELEMETRY_BYTES: usize = 8 * 1024 * 1024;

/// Object-storage prefix for every telemetry recording. Kept as its own prefix
/// so a bucket lifecycle rule can target telemetry independently of dispute
/// evidence.
pub const TELEMETRY_KEY_PREFIX: &str = "telemetry";

/// A single input sample: where the pointer moved and which inputs were held.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TelemetryInput {
    /// Pointer delta since the previous event, in thousandths of a pixel.
    /// Scaled integers keep the payload identical across IEEE-754 platforms.
    pub pointer_dx_milli: i32,
    pub pointer_dy_milli: i32,
    /// Keys held down for this sample.
    #[serde(default)]
    pub keys_down: Vec<String>,
    /// Mouse/controller button bitmask.
    #[serde(default)]
    pub button_mask: u32,
}

/// One player action together with the metrics used to score it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TelemetryEvent {
    /// Per-player monotonic sequence number; must strictly increase.
    pub seq: u64,
    /// Offset from the start of the match, in milliseconds.
    pub t_ms: u64,
    /// Action label, e.g. `move`, `fire`, `jump`.
    pub action: String,
    pub input: TelemetryInput,
    /// Time between the stimulus and the player's reaction.
    pub reaction_ms: u32,
    /// Aim accuracy in basis points (`0..=10_000`).
    pub accuracy_bps: u32,
    /// Peak turn rate, degrees per second.
    pub snap_deg_per_sec: u32,
    /// Observed speed, thousandths of a game unit per second.
    pub speed_milli: u32,
    /// Game's speed limit for the same unit, thousandths.
    pub speed_limit_milli: u32,
    /// Shannon entropy of the player's input distribution, basis points.
    pub entropy_bps: u32,
}

impl TelemetryEvent {
    /// Project this event onto the shared frame type so the real-time scorer
    /// ([`gameplay_analysis::infer`]) can be replayed against it.
    pub fn to_frame(&self, match_id: Uuid, player_id: Uuid) -> TelemetryFrame {
        TelemetryFrame {
            match_id,
            player_id,
            seq: self.seq,
            reaction_ms: self.reaction_ms,
            accuracy_bps: self.accuracy_bps,
            snap_deg_per_sec: self.snap_deg_per_sec,
            speed_milli: self.speed_milli,
            speed_limit_milli: self.speed_limit_milli,
            entropy_bps: self.entropy_bps,
        }
    }
}

/// Client-side performance and environment counters. An honest client reports
/// a plausible frame cadence; a scripted or replayed session tends to look
/// synthetic here (absurd FPS, zero jitter, no ping).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClientMetrics {
    pub client_build: String,
    /// `windows` / `macos` / `linux` / `android` / `ios` / `web`.
    pub platform: String,
    pub avg_fps: u32,
    /// 99th-percentile frame time in milliseconds.
    pub frame_time_p99_ms: u32,
    pub ping_ms: u32,
    /// e.g. `1920x1080`.
    pub resolution: String,
    /// Sample rate the client recorded inputs at.
    pub sample_rate_hz: u32,
}

/// Aggregate view of the recording, computed server-side at upload.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct TelemetrySummary {
    /// Total recording length, from the first to the last event.
    pub duration_ms: u64,
    pub event_count: u32,
    /// Events whose suspicion score crossed [`ALERT_THRESHOLD`].
    pub flagged_events: u32,
    pub max_suspicion_score: u8,
}

/// The document uploaded to object storage, and the thing replayed by an
/// analyst later. Serialized as JSON.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TelemetryEnvelope {
    pub schema_version: u32,
    pub match_id: Uuid,
    pub player_id: Uuid,
    pub recorded_at: DateTime<Utc>,
    pub client: ClientMetrics,
    pub events: Vec<TelemetryEvent>,
}

/// Request body for `POST /api/telemetry`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TelemetryUploadRequest {
    pub match_id: Uuid,
    pub player_id: Uuid,
    pub client: ClientMetrics,
    pub events: Vec<TelemetryEvent>,
}

impl From<TelemetryUploadRequest> for TelemetryEnvelope {
    fn from(request: TelemetryUploadRequest) -> Self {
        Self {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            match_id: request.match_id,
            player_id: request.player_id,
            recorded_at: Utc::now(),
            client: request.client,
            events: request.events,
        }
    }
}

impl TelemetryEnvelope {
    /// Reject a recording that is structurally wrong or out of range *before*
    /// it is hashed, uploaded or persisted.
    pub fn validate(&self) -> Result<(), ApiError> {
        if self.schema_version != TELEMETRY_SCHEMA_VERSION {
            return Err(ApiError::ValidationError(format!(
                "Unsupported telemetry schema version {}; this server accepts version {}",
                self.schema_version, TELEMETRY_SCHEMA_VERSION
            )));
        }
        if self.events.is_empty() {
            return Err(ApiError::ValidationError(
                "Telemetry recording contains no events".to_string(),
            ));
        }
        if self.events.len() > MAX_TELEMETRY_EVENTS {
            return Err(ApiError::ValidationError(format!(
                "Telemetry recording has {} events, which exceeds the {MAX_TELEMETRY_EVENTS}-event limit",
                self.events.len()
            )));
        }
        if self.client.sample_rate_hz == 0 {
            return Err(ApiError::ValidationError(
                "client.sample_rate_hz must be positive".to_string(),
            ));
        }
        if self.client.resolution.trim().is_empty() {
            return Err(ApiError::ValidationError(
                "client.resolution must not be empty".to_string(),
            ));
        }

        let mut previous_seq: Option<u64> = None;
        for (index, event) in self.events.iter().enumerate() {
            if let Some(previous) = previous_seq {
                if event.seq <= previous {
                    return Err(ApiError::ValidationError(format!(
                        "Telemetry event {} has sequence {} which is not greater than the previous {}",
                        index, event.seq, previous
                    )));
                }
            }
            previous_seq = Some(event.seq);

            if event.action.trim().is_empty() {
                return Err(ApiError::ValidationError(format!(
                    "Telemetry event {} has an empty action",
                    index
                )));
            }
            // Same bounds the real-time path enforces, so a stored recording is
            // always replayable by `gameplay_analysis::infer`.
            if event.accuracy_bps > 10_000 {
                return Err(ApiError::ValidationError(format!(
                    "Telemetry event {} has accuracy_bps {} outside 0-10000",
                    index, event.accuracy_bps
                )));
            }
            if event.entropy_bps > 10_000 {
                return Err(ApiError::ValidationError(format!(
                    "Telemetry event {} has entropy_bps {} outside 0-10000",
                    index, event.entropy_bps
                )));
            }
            if event.speed_limit_milli == 0 {
                return Err(ApiError::ValidationError(format!(
                    "Telemetry event {} has speed_limit_milli of 0",
                    index
                )));
            }
            if event.t_ms > self.max_event_time_ms() {
                return Err(ApiError::ValidationError(format!(
                    "Telemetry event {} has t_ms {} beyond the recording end",
                    index, event.t_ms
                )));
            }
        }

        Ok(())
    }

    /// Highest `t_ms` in the recording; the natural end of the session.
    fn max_event_time_ms(&self) -> u64 {
        self.events.iter().map(|event| event.t_ms).max().unwrap_or(0)
    }

    /// Serialize the document for upload.
    pub fn to_bytes(&self) -> Result<Vec<u8>, ApiError> {
        let bytes = serde_json::to_vec(self)
            .map_err(|error| ApiError::ValidationError(format!("Telemetry is not serializable: {error}")))?;
        if bytes.len() > MAX_TELEMETRY_BYTES {
            return Err(ApiError::ValidationError(format!(
                "Telemetry document is {} bytes, which exceeds the {MAX_TELEMETRY_BYTES}-byte limit",
                bytes.len()
            )));
        }
        Ok(bytes)
    }

    /// Replay the shared anti-cheat scorer over every event and roll the
    /// results up into a [`TelemetrySummary`].
    pub fn summarize(&self) -> TelemetrySummary {
        let mut max_score: u8 = 0;
        let mut flagged: u32 = 0;
        for event in &self.events {
            let frame = event.to_frame(self.match_id, self.player_id);
            if let Ok(inference) = gameplay_analysis::infer(&frame) {
                max_score = max_score.max(inference.score);
                if inference.score >= ALERT_THRESHOLD {
                    flagged += 1;
                }
            }
        }

        let duration_ms = match (self.events.first(), self.events.last()) {
            (Some(first), Some(last)) => last.t_ms.saturating_sub(first.t_ms),
            _ => 0,
        };

        TelemetrySummary {
            duration_ms,
            event_count: self.events.len() as u32,
            flagged_events: flagged,
            max_suspicion_score: max_score,
        }
    }
}

/// The match-record side of a completed upload: everything needed to find,
/// verify and eventually expire one stored recording, without holding the
/// recording itself in PostgreSQL.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, FromRow)]
pub struct TelemetryReference {
    pub match_id: Uuid,
    pub player_id: Uuid,
    /// S3 object key, prefixed [`TELEMETRY_KEY_PREFIX`].
    pub object_key: String,
    /// SHA-256 hex digest of the stored bytes, so tampering is detectable.
    pub content_hash: String,
    pub byte_size: i64,
    pub event_count: i32,
    pub schema_version: i32,
    /// Best (highest) suspicion score across the recording.
    pub max_suspicion_score: i16,
    pub uploaded_at: DateTime<Utc>,
    /// Earliest instant the sweeper may purge this recording.
    pub retained_until: DateTime<Utc>,
    /// When the object was purged from storage; `None` while it is live.
    pub purged_at: Option<DateTime<Utc>>,
}

impl TelemetryReference {
    /// Whether a sweep at `now` is due to purge this recording.
    pub fn is_purgeable_at(&self, now: DateTime<Utc>) -> bool {
        self.purged_at.is_none() && self.retained_until <= now
    }
}

/// Object key for a recording, namespaced `telemetry/{match}/{player}/{hash}.json`.
///
/// Scoping by match and player rules out traversal or one player overwriting
/// another's recording; keying by hash makes a retried upload of the same bytes
/// idempotent.
pub fn telemetry_object_key(match_id: Uuid, player_id: Uuid, hash_hex: &str) -> String {
    format!("{TELEMETRY_KEY_PREFIX}/{match_id}/{player_id}/{hash_hex}.json")
}

/// Compute the retention deadline for a recording uploaded at `uploaded_at`.
///
/// Kept as a pure function so the policy can be asserted directly in tests and
/// so the period lives in exactly one place.
pub fn retention_deadline(uploaded_at: DateTime<Utc>, retention_days: i64) -> DateTime<Utc> {
    uploaded_at + chrono::Duration::days(retention_days.max(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> ClientMetrics {
        ClientMetrics {
            client_build: "1.4.0+abc".to_string(),
            platform: "windows".to_string(),
            avg_fps: 144,
            frame_time_p99_ms: 12,
            ping_ms: 31,
            resolution: "1920x1080".to_string(),
            sample_rate_hz: 128,
        }
    }

    fn event(seq: u64, t_ms: u64) -> TelemetryEvent {
        TelemetryEvent {
            seq,
            t_ms,
            action: "move".to_string(),
            input: TelemetryInput {
                pointer_dx_milli: 120,
                pointer_dy_milli: -40,
                keys_down: vec!["W".to_string()],
                button_mask: 1,
            },
            reaction_ms: 180,
            accuracy_bps: 4_000,
            snap_deg_per_sec: 90,
            speed_milli: 500,
            speed_limit_milli: 1_000,
            entropy_bps: 7_000,
        }
    }

    fn envelope(events: Vec<TelemetryEvent>) -> TelemetryEnvelope {
        TelemetryEnvelope {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            match_id: Uuid::from_u128(1),
            player_id: Uuid::from_u128(2),
            recorded_at: Utc::now(),
            client: client(),
            events,
        }
    }

    #[test]
    fn a_well_formed_recording_validates_and_serializes() {
        let doc = envelope(vec![event(1, 0), event(2, 16), event(3, 32)]);
        doc.validate().expect("recording should be valid");
        let bytes = doc.to_bytes().expect("recording should serialize");
        let decoded: TelemetryEnvelope = serde_json::from_slice(&bytes).expect("round trip");
        assert_eq!(decoded, doc);
    }

    #[test]
    fn an_empty_recording_is_rejected() {
        let error = envelope(vec![]).validate().expect_err("empty recording");
        assert!(error.to_string().contains("no events"));
    }

    #[test]
    fn out_of_order_sequences_are_rejected() {
        let error = envelope(vec![event(2, 0), event(1, 16)])
            .validate()
            .expect_err("regressing sequence");
        assert!(error.to_string().contains("sequence"));
    }

    #[test]
    fn out_of_range_metrics_are_rejected() {
        let mut bad_accuracy = event(1, 0);
        bad_accuracy.accuracy_bps = 10_001;
        assert!(envelope(vec![bad_accuracy]).validate().is_err());

        let mut bad_entropy = event(1, 0);
        bad_entropy.entropy_bps = 10_001;
        assert!(envelope(vec![bad_entropy]).validate().is_err());

        let mut bad_speed = event(1, 0);
        bad_speed.speed_limit_milli = 0;
        assert!(envelope(vec![bad_speed]).validate().is_err());
    }

    #[test]
    fn an_unknown_schema_version_is_rejected() {
        let mut doc = envelope(vec![event(1, 0)]);
        doc.schema_version = TELEMETRY_SCHEMA_VERSION + 1;
        assert!(doc.validate().is_err());
    }

    #[test]
    fn summary_matches_the_shared_scorer() {
        let mut cheat = event(2, 16);
        cheat.reaction_ms = 20;
        cheat.speed_milli = 5_000;
        cheat.accuracy_bps = 9_900;
        cheat.entropy_bps = 100;
        let doc = envelope(vec![event(1, 0), cheat]);

        let summary = doc.summarize();
        assert_eq!(summary.event_count, 2);
        assert_eq!(summary.duration_ms, 16);
        assert_eq!(summary.flagged_events, 1);
        assert!(summary.max_suspicion_score >= ALERT_THRESHOLD);
    }

    #[test]
    fn object_key_is_namespaced_and_prefixed() {
        let key = telemetry_object_key(Uuid::from_u128(1), Uuid::from_u128(2), "abc123");
        assert_eq!(
            key,
            format!("telemetry/{}/{}/abc123.json", Uuid::from_u128(1), Uuid::from_u128(2))
        );
        assert!(key.starts_with(TELEMETRY_KEY_PREFIX));
    }

    #[test]
    fn retention_deadline_is_upload_time_plus_the_period() {
        let uploaded = Utc::now();
        let deadline = retention_deadline(uploaded, 90);
        assert_eq!(deadline, uploaded + chrono::Duration::days(90));
    }

    #[test]
    fn purge_due_only_after_retention_and_once() {
        let now = Utc::now();
        let mut reference = TelemetryReference {
            match_id: Uuid::from_u128(1),
            player_id: Uuid::from_u128(2),
            object_key: "telemetry/k".to_string(),
            content_hash: "hash".to_string(),
            byte_size: 10,
            event_count: 1,
            schema_version: 1,
            max_suspicion_score: 0,
            uploaded_at: now - chrono::Duration::days(91),
            retained_until: now - chrono::Duration::days(1),
            purged_at: None,
        };
        assert!(reference.is_purgeable_at(now));

        reference.purged_at = Some(now);
        assert!(!reference.is_purgeable_at(now), "already-purged rows are skipped");

        reference.purged_at = None;
        reference.retained_until = now + chrono::Duration::days(1);
        assert!(!reference.is_purgeable_at(now), "still inside retention");
    }
}
