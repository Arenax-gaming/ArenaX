//! End-to-end gameplay telemetry pipeline for anti-cheat.
//!
//! Exercises all four acceptance criteria against a *mocked* S3/MinIO store and
//! an in-memory linkage index, so it runs without a live object store or
//! PostgreSQL:
//!
//! 1. the recording is serialized into the versioned telemetry schema,
//! 2. it is uploaded through the retrying upload path — including a transient
//!    network failure that must be retried rather than surfaced,
//! 3. the match record ends up pointing at the stored object,
//! 4. the retention sweep removes the object once its window elapses, and
//!    leaves recordings still inside their window alone.

use arenax_backend::api_error::ApiError;
use arenax_backend::models::telemetry::{
    ClientMetrics, TelemetryEnvelope, TelemetryEvent, TelemetryInput, TelemetryUploadRequest,
    TELEMETRY_KEY_PREFIX, TELEMETRY_SCHEMA_VERSION,
};
use arenax_backend::service::evidence_storage::{hash_evidence, EvidenceStore, RetryPolicy};
use arenax_backend::service::telemetry_retention::TelemetryRetentionService;
use arenax_backend::service::telemetry_upload::{
    InMemoryTelemetryIndex, TelemetryUploadService,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use uuid::Uuid;

/// Mocked S3/MinIO bucket. Objects live in a map; the first `fail_puts` `PUT`s
/// fail with a *transient* error, which is what a network blip or a briefly
/// unavailable bucket looks like to the upload path.
struct MockS3 {
    objects: Mutex<HashMap<String, Vec<u8>>>,
    fail_puts: AtomicU32,
    puts: AtomicU32,
    deleted: Mutex<Vec<String>>,
}

impl MockS3 {
    fn new(fail_puts: u32) -> Self {
        Self {
            objects: Mutex::new(HashMap::new()),
            fail_puts: AtomicU32::new(fail_puts),
            puts: AtomicU32::new(0),
            deleted: Mutex::new(Vec::new()),
        }
    }

    fn object(&self, key: &str) -> Option<Vec<u8>> {
        self.objects.lock().unwrap().get(key).cloned()
    }

    fn put_count(&self) -> u32 {
        self.puts.load(Ordering::SeqCst)
    }

    fn deleted(&self) -> Vec<String> {
        self.deleted.lock().unwrap().clone()
    }
}

#[async_trait::async_trait]
impl EvidenceStore for MockS3 {
    async fn put(&self, key: &str, _content_type: &str, bytes: &[u8]) -> Result<(), ApiError> {
        self.puts.fetch_add(1, Ordering::SeqCst);
        if self.fail_puts.load(Ordering::SeqCst) > 0 {
            self.fail_puts.fetch_sub(1, Ordering::SeqCst);
            return Err(ApiError::ServiceUnavailable(
                "connection reset by peer".to_string(),
            ));
        }
        self.objects
            .lock()
            .unwrap()
            .insert(key.to_string(), bytes.to_vec());
        Ok(())
    }

    async fn get(&self, key: &str) -> Result<Vec<u8>, ApiError> {
        self.object(key)
            .ok_or_else(|| ApiError::not_found("no such object"))
    }

    async fn delete(&self, key: &str) -> Result<(), ApiError> {
        self.deleted.lock().unwrap().push(key.to_string());
        self.objects.lock().unwrap().remove(key);
        // Deleting a missing key succeeds, mirroring S3.
        Ok(())
    }
}

fn client() -> ClientMetrics {
    ClientMetrics {
        client_build: "1.4.0+abc".to_string(),
        platform: "windows".to_string(),
        avg_fps: 144,
        frame_time_p99_ms: 12,
        ping_ms: 28,
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
            button_mask: 0,
        },
        reaction_ms: 190,
        accuracy_bps: 4_100,
        snap_deg_per_sec: 95,
        speed_milli: 600,
        speed_limit_milli: 1_000,
        entropy_bps: 7_200,
    }
}

fn request(match_id: Uuid, player_id: Uuid) -> TelemetryUploadRequest {
    TelemetryUploadRequest {
        match_id,
        player_id,
        client: client(),
        events: vec![event(1, 0), event(2, 16), event(3, 32)],
    }
}

/// The same recording as [`request`], with a pinned `recorded_at` so two builds
/// of it serialize to identical bytes (and therefore hash to the same object
/// key) — which is what makes an upload retry idempotent.
fn pinned_envelope(match_id: Uuid, player_id: Uuid) -> TelemetryEnvelope {
    TelemetryEnvelope {
        schema_version: TELEMETRY_SCHEMA_VERSION,
        match_id,
        player_id,
        recorded_at: "2026-01-01T00:00:00Z".parse().expect("fixed timestamp"),
        client: client(),
        events: vec![event(1, 0), event(2, 16), event(3, 32)],
    }
}

/// No-sleep retry policy so the tests exercise the backoff path instantly.
fn instant_retries() -> RetryPolicy {
    RetryPolicy::new(3, Duration::from_millis(0))
}

fn service(
    store: Arc<MockS3>,
    index: Arc<InMemoryTelemetryIndex>,
    retention_days: i64,
) -> TelemetryUploadService {
    TelemetryUploadService::new(store, index, retention_days).with_retry_policy(instant_retries())
}

#[tokio::test]
async fn a_recording_is_uploaded_linked_to_the_match_and_later_purged() {
    let store = Arc::new(MockS3::new(0));
    let index = Arc::new(InMemoryTelemetryIndex::new());
    let upload = service(store.clone(), index.clone(), 30);

    let match_id = Uuid::from_u128(0xA11CE);
    let player_id = Uuid::from_u128(0xB0B);

    // 1 + 2. The recording is serialized and uploaded.
    let outcome = upload.upload(request(match_id, player_id)).await.unwrap();
    let stored = store
        .object(&outcome.reference.object_key)
        .expect("the recording must be in the bucket");

    // 1. Telemetry format is the versioned schema, and it round-trips.
    let decoded: TelemetryEnvelope = serde_json::from_slice(&stored).unwrap();
    assert_eq!(decoded.schema_version, TELEMETRY_SCHEMA_VERSION);
    assert_eq!(decoded.match_id, match_id);
    assert_eq!(decoded.player_id, player_id);
    assert_eq!(decoded.events.len(), 3);
    assert_eq!(decoded.events[0].input.keys_down, vec!["W".to_string()]);
    assert_eq!(decoded.events[2].t_ms, 32);
    assert!(outcome.reference.object_key.starts_with(TELEMETRY_KEY_PREFIX));

    // 3. The match record points at the stored object, and its hash matches the
    //    bytes actually stored.
    assert_eq!(hash_evidence(&stored), outcome.reference.content_hash);
    let linked = upload.metadata(match_id, player_id).await.unwrap();
    assert_eq!(linked.object_key, outcome.reference.object_key);
    assert_eq!(linked.content_hash, outcome.reference.content_hash);
    assert_eq!(linked.event_count, 3);
    assert_eq!(linked.purged_at, None);

    // 4. The retention deadline sits inside the 30–90 day policy band.
    let window = linked.retained_until - linked.uploaded_at;
    assert!(window >= chrono::Duration::days(30), "window was {window}");
    assert!(window <= chrono::Duration::days(90), "window was {window}");

    // 4. Sweeping at the deadline removes the object and retires the linkage —
    //    without waiting out a real retention window.
    let sweeper = TelemetryRetentionService::new(store.clone(), index.clone());
    let report = sweeper
        .sweep_at(linked.retained_until + chrono::Duration::seconds(1))
        .await
        .unwrap();
    assert_eq!(report.purged, 1);
    assert_eq!(report.failed, 0);
    assert!(store.object(&linked.object_key).is_none(), "object must be gone");
    assert_eq!(store.deleted(), vec![linked.object_key.clone()]);

    // The purged recording no longer resolves.
    let error = upload
        .metadata(match_id, player_id)
        .await
        .expect_err("a purged recording must not resolve");
    assert!(matches!(error, ApiError::NotFound), "got {error:?}");
}

#[tokio::test]
async fn a_transient_storage_failure_is_retried_and_the_recording_is_still_linked() {
    // The first two PUT attempts fail with a transient error.
    let store = Arc::new(MockS3::new(2));
    let index = Arc::new(InMemoryTelemetryIndex::new());
    let upload = service(store.clone(), index.clone(), 90);

    let match_id = Uuid::from_u128(7);
    let player_id = Uuid::from_u128(8);
    let outcome = upload.upload(request(match_id, player_id)).await.unwrap();

    assert_eq!(store.put_count(), 3, "two failures then a success");
    assert!(store.object(&outcome.reference.object_key).is_some());

    // The match record was written even though the first attempts failed.
    let linked = upload.metadata(match_id, player_id).await.unwrap();
    assert_eq!(linked.object_key, outcome.reference.object_key);
}

#[tokio::test]
async fn an_upload_that_never_succeeds_is_reported_and_links_nothing() {
    // More failures than the retry budget allows.
    let store = Arc::new(MockS3::new(99));
    let index = Arc::new(InMemoryTelemetryIndex::new());
    let upload = service(store.clone(), index.clone(), 90);

    let error = upload
        .upload(request(Uuid::from_u128(1), Uuid::from_u128(2)))
        .await
        .expect_err("the upload must fail once the retry budget is spent");

    assert!(matches!(error, ApiError::ServiceUnavailable(_)), "got {error:?}");
    assert_eq!(store.put_count(), 3, "the attempt budget is honoured");
    assert!(
        index.all().is_empty(),
        "a failed upload must not link a match to a recording that does not exist"
    );
}

#[tokio::test]
async fn a_recording_inside_its_retention_window_is_not_purged() {
    let store = Arc::new(MockS3::new(0));
    let index = Arc::new(InMemoryTelemetryIndex::new());
    let upload = service(store.clone(), index.clone(), 90);

    let match_id = Uuid::from_u128(11);
    let player_id = Uuid::from_u128(12);
    // A pinned envelope so the retried upload below is byte-identical.
    let envelope = pinned_envelope(match_id, player_id);
    let outcome = upload.upload_envelope(envelope.clone()).await.unwrap();

    // Sweeping "now" examines nothing: the recording is still inside its window.
    let sweeper = TelemetryRetentionService::new(store.clone(), index);
    let report = sweeper.sweep().await.unwrap();
    assert_eq!(report.purged, 0);
    assert!(store.deleted().is_empty());
    assert!(store.object(&outcome.reference.object_key).is_some());

    // And a re-upload of identical bytes stays idempotent: one live linkage.
    upload.upload_envelope(envelope.clone()).await.unwrap();
    upload.upload_envelope(envelope).await.unwrap();
    let linked = upload.metadata_for_match(match_id).await.unwrap();
    assert_eq!(linked.len(), 1, "identical re-uploads collapse onto one linkage");
    assert_eq!(linked[0].content_hash, outcome.reference.content_hash);
}
