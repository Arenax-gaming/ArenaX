//! Gameplay telemetry upload pipeline (anti-cheat).
//!
//! A client's recorded session is validated, hashed, uploaded to S3/MinIO and
//! then linked to its match record. Only the resulting reference — object key,
//! hash, event count, suspicion score and retention deadline — is persisted to
//! PostgreSQL; the recording itself never lives in the database.
//!
//! The two dependencies are abstracted behind traits:
//!
//! - [`EvidenceStore`] — the object-storage PUT/GET/DELETE surface, already
//!   used by dispute evidence, so no second S3 client exists.
//! - [`TelemetryIndex`] — the match-record linkage, so the upload path can be
//!   exercised end to end without a live PostgreSQL.

use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::telemetry::{
    retention_deadline, telemetry_object_key, TelemetryEnvelope, TelemetryReference,
    TelemetrySummary, TelemetryUploadRequest,
};
use crate::service::evidence_storage::{
    hash_evidence, put_encoded_with_retry, EvidenceStore, RetryPolicy,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use flate2::write::GzEncoder;
use flate2::Compression;
use std::io::Write;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

/// Content type every recording is stored under.
pub const TELEMETRY_CONTENT_TYPE: &str = "application/json";

/// Content coding recordings are stored under (#1529).
///
/// Input recordings are long runs of near-identical samples, so gzip typically
/// removes an order of magnitude of storage and transfer.
pub const TELEMETRY_CONTENT_ENCODING: &str = "gzip";

/// Consecutive failed uploads that open the circuit breaker (#1529).
pub const DEFAULT_BREAKER_THRESHOLD: u32 = 3;

/// How long the breaker stays open before a single probe is allowed through.
pub const DEFAULT_BREAKER_COOLDOWN: Duration = Duration::from_secs(30);

/// Default retention window for stored recordings, in days.
///
/// 90 days covers an entire ranked season, so a dispute or ban appeal raised at
/// the end of a season can still be settled against the original recording.
pub const DEFAULT_RETENTION_DAYS: i64 = 90;

/// Shortest window the policy allows. Below this a dispute can plausibly be
/// raised *after* the recording it concerns has already been purged.
pub const MIN_RETENTION_DAYS: i64 = 30;

/// Longest window the policy allows: keeping a player's input recording beyond
/// this is no longer justified by anti-cheat review.
pub const MAX_RETENTION_DAYS: i64 = 90;

/// Clamp a configured retention window into the 30–90 day policy band.
pub fn clamp_retention_days(days: i64) -> i64 {
    days.clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS)
}

/// Upper bound on one batch of the retention sweep.
pub const PURGE_BATCH_LIMIT: i64 = 500;

/// Links a stored recording to its match record and answers retention queries.
#[async_trait]
pub trait TelemetryIndex: Send + Sync {
    /// Persist the reference for an upload. Re-running with identical content
    /// refreshes the row rather than duplicating it.
    async fn link(&self, reference: &TelemetryReference) -> Result<(), ApiError>;

    /// The live recording for one player in one match, if any.
    async fn find(
        &self,
        match_id: Uuid,
        player_id: Uuid,
    ) -> Result<Option<TelemetryReference>, ApiError>;

    /// Every recording linked to a match, newest first.
    async fn find_for_match(&self, match_id: Uuid) -> Result<Vec<TelemetryReference>, ApiError>;

    /// Mark a recording as purged once its object has been removed.
    async fn mark_purged(
        &self,
        match_id: Uuid,
        player_id: Uuid,
        purged_at: DateTime<Utc>,
    ) -> Result<(), ApiError>;

    /// Recordings whose retention has elapsed and which have not yet been
    /// purged, oldest first.
    async fn list_purgeable(
        &self,
        cutoff: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<TelemetryReference>, ApiError>;
}

/// What a successful upload produced.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TelemetryUploadOutcome {
    pub reference: TelemetryReference,
    pub summary: TelemetrySummary,
}

/// Whether uploads are being attempted right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    /// Uploads are attempted normally.
    Closed,
    /// Too many consecutive failures: uploads fail fast without touching storage.
    Open,
}

#[derive(Debug)]
struct BreakerState {
    consecutive_failures: u32,
    open_until: Option<Instant>,
}

/// Stops hammering a storage backend that is known to be down (#1529).
///
/// The upload path is driven by a processing loop that has to keep running. If
/// every batch waits out the retry policy against a dead backend, that loop
/// stalls behind the failures. After [`threshold`](Self::new) consecutive
/// failures the breaker opens and uploads are refused immediately with
/// [`ApiError::DependencyUnavailable`], which the loop can treat as "skip this
/// batch" without waiting.
///
/// Once the cooldown elapses one probe is let through: success closes the
/// breaker, failure re-opens it. Several callers can therefore probe at once
/// after a cooldown; that is bounded by the number of in-flight uploads and
/// keeps the state machine free of a half-open flag to leak.
pub struct CircuitBreaker {
    threshold: u32,
    cooldown: Duration,
    state: Mutex<BreakerState>,
    trips: AtomicU64,
}

impl Default for CircuitBreaker {
    fn default() -> Self {
        Self::new(DEFAULT_BREAKER_THRESHOLD, DEFAULT_BREAKER_COOLDOWN)
    }
}

impl CircuitBreaker {
    /// `threshold` is clamped to at least one failure, so a breaker can never
    /// open before anything has actually failed.
    pub fn new(threshold: u32, cooldown: Duration) -> Self {
        Self {
            threshold: threshold.max(1),
            cooldown,
            state: Mutex::new(BreakerState {
                consecutive_failures: 0,
                open_until: None,
            }),
            trips: AtomicU64::new(0),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, BreakerState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Whether an upload may be attempted.
    pub fn allows(&self) -> bool {
        let mut state = self.lock();
        match state.open_until {
            Some(until) if Instant::now() < until => false,
            Some(_) => {
                // Cooldown elapsed: let a probe through. A failure re-opens the
                // breaker because the failure count is still at the threshold.
                state.open_until = None;
                true
            }
            None => true,
        }
    }

    /// Current state, for metrics and logs.
    pub fn state(&self) -> CircuitState {
        match self.lock().open_until {
            Some(until) if Instant::now() < until => CircuitState::Open,
            _ => CircuitState::Closed,
        }
    }

    /// How long a caller should wait before retrying, for `Retry-After`.
    pub fn retry_after_secs(&self) -> u64 {
        self.cooldown.as_secs().max(1)
    }

    /// How many times the breaker has opened since it was created.
    pub fn trips(&self) -> u64 {
        self.trips.load(Ordering::Relaxed)
    }

    pub fn record_success(&self) {
        let mut state = self.lock();
        state.consecutive_failures = 0;
        state.open_until = None;
    }

    pub fn record_failure(&self) {
        let mut state = self.lock();
        let was_closed = state.open_until.is_none();
        state.consecutive_failures = state.consecutive_failures.saturating_add(1);

        if state.consecutive_failures >= self.threshold {
            state.open_until = Some(Instant::now() + self.cooldown);
            if was_closed {
                self.trips.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

/// Deflate a serialized recording.
fn gzip_bytes(bytes: &[u8]) -> Result<Vec<u8>, ApiError> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).map_err(|error| {
        ApiError::internal_error(format!("Failed to compress telemetry: {error}"))
    })?;
    encoder
        .finish()
        .map_err(|error| ApiError::internal_error(format!("Failed to compress telemetry: {error}")))
}

/// The upload service itself.
pub struct TelemetryUploadService {
    store: Arc<dyn EvidenceStore>,
    index: Arc<dyn TelemetryIndex>,
    retention_days: i64,
    retry: RetryPolicy,
    breaker: Arc<CircuitBreaker>,
}

impl TelemetryUploadService {
    pub fn new(
        store: Arc<dyn EvidenceStore>,
        index: Arc<dyn TelemetryIndex>,
        retention_days: i64,
    ) -> Self {
        Self {
            store,
            index,
            retention_days,
            retry: RetryPolicy::default(),
            breaker: Arc::new(CircuitBreaker::default()),
        }
    }

    /// Override the upload retry policy (tests use a no-sleep policy).
    pub fn with_retry_policy(mut self, retry: RetryPolicy) -> Self {
        self.retry = retry;
        self
    }

    /// Share a breaker with another component (tests use a short cooldown).
    pub fn with_breaker(mut self, breaker: Arc<CircuitBreaker>) -> Self {
        self.breaker = breaker;
        self
    }

    /// The breaker guarding this service's storage writes.
    pub fn breaker(&self) -> &Arc<CircuitBreaker> {
        &self.breaker
    }

    /// Validate, upload and link one recording.
    ///
    /// Ordering matters: the object is stored *before* the match record points
    /// at it, so a match can never reference a recording that does not exist.
    /// If the linkage itself fails, the just-uploaded object is removed again
    /// rather than left orphaned with nothing pointing at it.
    pub async fn upload(
        &self,
        request: TelemetryUploadRequest,
    ) -> Result<TelemetryUploadOutcome, ApiError> {
        self.upload_envelope(TelemetryEnvelope::from(request)).await
    }

    /// Same as [`Self::upload`] but for a caller that already holds an
    /// envelope (e.g. a replay of a stored recording).
    pub async fn upload_envelope(
        &self,
        envelope: TelemetryEnvelope,
    ) -> Result<TelemetryUploadOutcome, ApiError> {
        envelope.validate()?;

        // Fail fast while storage is known to be down, so the caller's
        // processing loop is never parked behind retries (#1529).
        if !self.breaker.allows() {
            tracing::warn!(
                match_id = %envelope.match_id,
                player_id = %envelope.player_id,
                retry_after = self.breaker.retry_after_secs(),
                "Telemetry storage circuit breaker is open; upload skipped"
            );
            return Err(ApiError::DependencyUnavailable {
                message: "Telemetry storage is unavailable; upload skipped".to_string(),
                retry_after: self.breaker.retry_after_secs(),
            });
        }

        let bytes = envelope.to_bytes()?;
        // Hash the document, not its compressed form: the object key must not
        // depend on the compressor's output for identical recordings (#1529).
        let content_hash = hash_evidence(&bytes);
        let object_key = telemetry_object_key(envelope.match_id, envelope.player_id, &content_hash);

        let compressed = gzip_bytes(&bytes)?;
        let ratio = bytes.len() as f64 / compressed.len().max(1) as f64;
        tracing::info!(
            match_id = %envelope.match_id,
            player_id = %envelope.player_id,
            uncompressed_bytes = bytes.len(),
            compressed_bytes = compressed.len(),
            compression_ratio = %format!("{ratio:.2}"),
            "Telemetry batch compressed"
        );

        let uploaded = put_encoded_with_retry(
            self.store.as_ref(),
            &object_key,
            TELEMETRY_CONTENT_TYPE,
            Some(TELEMETRY_CONTENT_ENCODING),
            &compressed,
            self.retry,
        )
        .await;

        match uploaded {
            Ok(()) => self.breaker.record_success(),
            Err(error) => {
                self.breaker.record_failure();
                return Err(error);
            }
        }

        let summary = envelope.summarize();
        let uploaded_at = Utc::now();
        let reference = TelemetryReference {
            match_id: envelope.match_id,
            player_id: envelope.player_id,
            object_key,
            content_hash,
            // The recording's own size, not the stored object's: retention and
            // suspicion reporting reason about the document (#1529).
            byte_size: bytes.len() as i64,
            event_count: summary.event_count as i32,
            schema_version: envelope.schema_version as i32,
            max_suspicion_score: summary.max_suspicion_score as i16,
            uploaded_at,
            retained_until: retention_deadline(uploaded_at, self.retention_days),
            purged_at: None,
        };

        if let Err(error) = self.index.link(&reference).await {
            // Best effort: the recording is unreferenced, so removing it keeps
            // the bucket from accumulating objects nothing can ever find again.
            let _ = self.store.delete(&reference.object_key).await;
            return Err(error);
        }

        tracing::info!(
            match_id = %reference.match_id,
            player_id = %reference.player_id,
            object_key = %reference.object_key,
            event_count = reference.event_count,
            max_suspicion_score = reference.max_suspicion_score,
            "Gameplay telemetry uploaded"
        );

        Ok(TelemetryUploadOutcome { reference, summary })
    }

    /// Metadata for one player's recording, or 404 when none is stored.
    pub async fn metadata(
        &self,
        match_id: Uuid,
        player_id: Uuid,
    ) -> Result<TelemetryReference, ApiError> {
        self.index
            .find(match_id, player_id)
            .await?
            .ok_or_else(|| ApiError::not_found("No telemetry is stored for that match"))
    }

    /// Every recording linked to a match.
    pub async fn metadata_for_match(
        &self,
        match_id: Uuid,
    ) -> Result<Vec<TelemetryReference>, ApiError> {
        self.index.find_for_match(match_id).await
    }

    /// Retention window this service stamps onto uploads.
    pub fn retention_days(&self) -> i64 {
        self.retention_days
    }
}

// ── PostgreSQL linkage ─────────────────────────────────────────────────────

/// The production [`TelemetryIndex`]: one `match_telemetry` row per upload,
/// foreign-keyed to `matches`.
pub struct PostgresTelemetryIndex {
    db: DbPool,
}

impl PostgresTelemetryIndex {
    pub fn new(db: DbPool) -> Self {
        Self { db }
    }
}

#[async_trait]
impl TelemetryIndex for PostgresTelemetryIndex {
    async fn link(&self, reference: &TelemetryReference) -> Result<(), ApiError> {
        // Idempotent by content hash: a client that re-sends an identical
        // recording refreshes the existing row (and its retention clock)
        // instead of creating a second one.
        sqlx::query(
            r#"
            INSERT INTO match_telemetry (
                id, match_id, player_id, object_key, content_hash, byte_size,
                event_count, schema_version, max_suspicion_score,
                uploaded_at, retained_until
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (match_id, player_id, content_hash) DO UPDATE SET
                object_key          = EXCLUDED.object_key,
                uploaded_at         = EXCLUDED.uploaded_at,
                retained_until      = EXCLUDED.retained_until,
                purged_at           = NULL
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(reference.match_id)
        .bind(reference.player_id)
        .bind(&reference.object_key)
        .bind(&reference.content_hash)
        .bind(reference.byte_size)
        .bind(reference.event_count)
        .bind(reference.schema_version)
        .bind(reference.max_suspicion_score)
        .bind(reference.uploaded_at)
        .bind(reference.retained_until)
        .execute(&self.db)
        .await?;

        Ok(())
    }

    async fn find(
        &self,
        match_id: Uuid,
        player_id: Uuid,
    ) -> Result<Option<TelemetryReference>, ApiError> {
        let row = sqlx::query_as::<_, TelemetryReference>(
            r#"
            SELECT match_id, player_id, object_key, content_hash, byte_size,
                   event_count, schema_version, max_suspicion_score,
                   uploaded_at, retained_until, purged_at
            FROM match_telemetry
            WHERE match_id = $1 AND player_id = $2 AND purged_at IS NULL
            ORDER BY uploaded_at DESC
            LIMIT 1
            "#,
        )
        .bind(match_id)
        .bind(player_id)
        .fetch_optional(&self.db)
        .await?;

        Ok(row)
    }

    async fn find_for_match(&self, match_id: Uuid) -> Result<Vec<TelemetryReference>, ApiError> {
        let rows = sqlx::query_as::<_, TelemetryReference>(
            r#"
            SELECT match_id, player_id, object_key, content_hash, byte_size,
                   event_count, schema_version, max_suspicion_score,
                   uploaded_at, retained_until, purged_at
            FROM match_telemetry
            WHERE match_id = $1
            ORDER BY uploaded_at DESC
            "#,
        )
        .bind(match_id)
        .fetch_all(&self.db)
        .await?;

        Ok(rows)
    }

    async fn mark_purged(
        &self,
        match_id: Uuid,
        player_id: Uuid,
        purged_at: DateTime<Utc>,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE match_telemetry
            SET purged_at = $3
            WHERE match_id = $1 AND player_id = $2 AND purged_at IS NULL
            "#,
        )
        .bind(match_id)
        .bind(player_id)
        .bind(purged_at)
        .execute(&self.db)
        .await?;

        Ok(())
    }

    async fn list_purgeable(
        &self,
        cutoff: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<TelemetryReference>, ApiError> {
        let rows = sqlx::query_as::<_, TelemetryReference>(
            r#"
            SELECT match_id, player_id, object_key, content_hash, byte_size,
                   event_count, schema_version, max_suspicion_score,
                   uploaded_at, retained_until, purged_at
            FROM match_telemetry
            WHERE purged_at IS NULL AND retained_until <= $1
            ORDER BY retained_until ASC
            LIMIT $2
            "#,
        )
        .bind(cutoff)
        .bind(limit.max(1))
        .fetch_all(&self.db)
        .await?;

        Ok(rows)
    }
}

// ── In-memory linkage (tests / offline runs) ───────────────────────────────

/// Non-persistent [`TelemetryIndex`] backed by a vector.
///
/// Lets the upload and retention paths be tested — and demonstrated — without a
/// PostgreSQL instance, and gives integration tests a way to assert exactly
/// what was linked to which match.
#[derive(Default)]
pub struct InMemoryTelemetryIndex {
    references: Mutex<Vec<TelemetryReference>>,
}

impl InMemoryTelemetryIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every reference currently held, newest first.
    pub fn all(&self) -> Vec<TelemetryReference> {
        let mut references = self.references.lock().expect("telemetry index").clone();
        references.sort_by(|a, b| b.uploaded_at.cmp(&a.uploaded_at));
        references
    }
}

#[async_trait]
impl TelemetryIndex for InMemoryTelemetryIndex {
    async fn link(&self, reference: &TelemetryReference) -> Result<(), ApiError> {
        let mut references = self.references.lock().expect("telemetry index");
        // Same conflict target as the SQL implementation.
        references.retain(|existing| {
            !(existing.match_id == reference.match_id
                && existing.player_id == reference.player_id
                && existing.content_hash == reference.content_hash)
        });
        references.push(reference.clone());
        Ok(())
    }

    async fn find(
        &self,
        match_id: Uuid,
        player_id: Uuid,
    ) -> Result<Option<TelemetryReference>, ApiError> {
        let references = self.references.lock().expect("telemetry index");
        let found = references
            .iter()
            .filter(|reference| {
                reference.match_id == match_id
                    && reference.player_id == player_id
                    && reference.purged_at.is_none()
            })
            .max_by_key(|reference| reference.uploaded_at)
            .cloned();
        Ok(found)
    }

    async fn find_for_match(&self, match_id: Uuid) -> Result<Vec<TelemetryReference>, ApiError> {
        let mut rows: Vec<TelemetryReference> = self
            .references
            .lock()
            .expect("telemetry index")
            .iter()
            .filter(|reference| reference.match_id == match_id)
            .cloned()
            .collect();
        rows.sort_by(|a, b| b.uploaded_at.cmp(&a.uploaded_at));
        Ok(rows)
    }

    async fn mark_purged(
        &self,
        match_id: Uuid,
        player_id: Uuid,
        purged_at: DateTime<Utc>,
    ) -> Result<(), ApiError> {
        let mut references = self.references.lock().expect("telemetry index");
        for reference in references.iter_mut() {
            if reference.match_id == match_id
                && reference.player_id == player_id
                && reference.purged_at.is_none()
            {
                reference.purged_at = Some(purged_at);
            }
        }
        Ok(())
    }

    async fn list_purgeable(
        &self,
        cutoff: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<TelemetryReference>, ApiError> {
        let mut rows: Vec<TelemetryReference> = self
            .references
            .lock()
            .expect("telemetry index")
            .iter()
            .filter(|reference| reference.is_purgeable_at(cutoff))
            .cloned()
            .collect();
        rows.sort_by(|a, b| a.retained_until.cmp(&b.retained_until));
        rows.truncate(limit.max(1) as usize);
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::telemetry::{
        ClientMetrics, TelemetryEvent, TelemetryInput, TELEMETRY_SCHEMA_VERSION,
    };
    use std::io::Read;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// One object as the store received it.
    struct StoredObject {
        key: String,
        encoding: Option<String>,
        bytes: Vec<u8>,
    }

    /// Object store that records what was written and how many times.
    struct RecordingStore {
        objects: Mutex<Vec<StoredObject>>,
        deletes: Mutex<Vec<String>>,
        puts: AtomicU32,
        failing: std::sync::atomic::AtomicBool,
    }

    impl RecordingStore {
        fn new() -> Self {
            Self {
                objects: Mutex::new(Vec::new()),
                deletes: Mutex::new(Vec::new()),
                puts: AtomicU32::new(0),
                failing: std::sync::atomic::AtomicBool::new(false),
            }
        }

        /// Make every subsequent write fail the way a dead backend would.
        fn start_failing(&self) {
            self.failing.store(true, Ordering::SeqCst);
        }

        fn stop_failing(&self) {
            self.failing.store(false, Ordering::SeqCst);
        }

        fn put_count(&self) -> u32 {
            self.puts.load(Ordering::SeqCst)
        }

        fn keys(&self) -> Vec<String> {
            self.objects
                .lock()
                .unwrap()
                .iter()
                .map(|object| object.key.clone())
                .collect()
        }

        fn encodings(&self) -> Vec<Option<String>> {
            self.objects
                .lock()
                .unwrap()
                .iter()
                .map(|object| object.encoding.clone())
                .collect()
        }
    }

    #[async_trait]
    impl EvidenceStore for RecordingStore {
        async fn put(&self, key: &str, _content_type: &str, bytes: &[u8]) -> Result<(), ApiError> {
            self.put_encoded(key, _content_type, None, bytes).await
        }

        async fn put_encoded(
            &self,
            key: &str,
            _content_type: &str,
            encoding: Option<&str>,
            bytes: &[u8],
        ) -> Result<(), ApiError> {
            self.puts.fetch_add(1, Ordering::SeqCst);
            if self.failing.load(Ordering::SeqCst) {
                return Err(ApiError::ServiceUnavailable(
                    "object store is down".to_string(),
                ));
            }
            self.objects.lock().unwrap().push(StoredObject {
                key: key.to_string(),
                encoding: encoding.map(str::to_string),
                bytes: bytes.to_vec(),
            });
            Ok(())
        }

        async fn get(&self, key: &str) -> Result<Vec<u8>, ApiError> {
            self.objects
                .lock()
                .unwrap()
                .iter()
                .find(|object| object.key == key)
                .map(|object| object.bytes.clone())
                .ok_or_else(|| ApiError::not_found("no such object"))
        }

        async fn delete(&self, key: &str) -> Result<(), ApiError> {
            self.deletes.lock().unwrap().push(key.to_string());
            self.objects
                .lock()
                .unwrap()
                .retain(|object| object.key != key);
            Ok(())
        }
    }

    /// Inflate an object as a reader would, using the coding the store recorded.
    fn gunzip(data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(data)
            .read_to_end(&mut out)
            .expect("stored object must be valid gzip");
        out
    }

    fn client() -> ClientMetrics {
        ClientMetrics {
            client_build: "1.4.0".to_string(),
            platform: "windows".to_string(),
            avg_fps: 144,
            frame_time_p99_ms: 12,
            ping_ms: 30,
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
                pointer_dx_milli: 10,
                pointer_dy_milli: -5,
                keys_down: vec!["W".to_string()],
                button_mask: 0,
            },
            reaction_ms: 180,
            accuracy_bps: 4_000,
            snap_deg_per_sec: 90,
            speed_milli: 500,
            speed_limit_milli: 1_000,
            entropy_bps: 7_000,
        }
    }

    fn request(match_id: Uuid, player_id: Uuid) -> TelemetryUploadRequest {
        TelemetryUploadRequest {
            match_id,
            player_id,
            client: client(),
            events: vec![event(1, 0), event(2, 16)],
        }
    }

    fn no_sleep() -> RetryPolicy {
        RetryPolicy::new(3, std::time::Duration::from_millis(0))
    }

    fn service(
        store: Arc<RecordingStore>,
        index: Arc<InMemoryTelemetryIndex>,
    ) -> TelemetryUploadService {
        TelemetryUploadService::new(store, index, DEFAULT_RETENTION_DAYS)
            .with_retry_policy(no_sleep())
    }

    #[tokio::test]
    async fn upload_stores_the_recording_and_links_it_to_the_match() {
        let store = Arc::new(RecordingStore::new());
        let index = Arc::new(InMemoryTelemetryIndex::new());
        let svc = service(store.clone(), index.clone());

        let match_id = Uuid::from_u128(1);
        let player_id = Uuid::from_u128(2);
        let outcome = svc.upload(request(match_id, player_id)).await.unwrap();

        // 1. The bytes are in object storage under a name derived from content.
        assert_eq!(store.keys(), vec![outcome.reference.object_key.clone()]);
        // 2. They were stored gzipped and labelled as such (#1529).
        assert_eq!(store.encodings(), vec![Some("gzip".to_string())]);
        let stored = store.get(&outcome.reference.object_key).await.unwrap();
        let document = gunzip(&stored);
        assert!(
            stored.len() < document.len(),
            "gzip must shrink the recording"
        );
        assert_eq!(hash_evidence(&document), outcome.reference.content_hash);
        let decoded: TelemetryEnvelope = serde_json::from_slice(&document).unwrap();
        assert_eq!(decoded.events.len(), 2);
        assert_eq!(decoded.schema_version, TELEMETRY_SCHEMA_VERSION);

        // 3. The match record points at the stored object and describes the
        //    recording itself, not its compressed form.
        let linked = svc.metadata(match_id, player_id).await.unwrap();
        assert_eq!(linked.object_key, outcome.reference.object_key);
        assert_eq!(linked.byte_size, document.len() as i64);
        assert_eq!(linked.event_count, 2);
        assert_eq!(linked.purged_at, None);
        assert_eq!(index.all().len(), 1);
    }

    #[tokio::test]
    async fn retention_deadline_is_stamped_from_the_configured_window() {
        let store = Arc::new(RecordingStore::new());
        let index = Arc::new(InMemoryTelemetryIndex::new());
        let svc = TelemetryUploadService::new(store, index, 30).with_retry_policy(no_sleep());

        let outcome = svc
            .upload(request(Uuid::from_u128(1), Uuid::from_u128(2)))
            .await
            .unwrap();

        assert_eq!(
            outcome.reference.retained_until,
            outcome.reference.uploaded_at + chrono::Duration::days(30)
        );
    }

    #[tokio::test]
    async fn an_invalid_recording_is_rejected_before_touching_storage() {
        let store = Arc::new(RecordingStore::new());
        let index = Arc::new(InMemoryTelemetryIndex::new());
        let svc = service(store.clone(), index.clone());

        let mut bad = request(Uuid::from_u128(1), Uuid::from_u128(2));
        bad.events.clear();

        assert!(svc.upload(bad).await.is_err());
        assert!(store.keys().is_empty(), "nothing must be uploaded");
        assert!(index.all().is_empty(), "nothing must be linked");
    }

    #[tokio::test]
    async fn identical_re_uploads_are_idempotent() {
        let store = Arc::new(RecordingStore::new());
        let index = Arc::new(InMemoryTelemetryIndex::new());
        let svc = service(store.clone(), index.clone());

        let match_id = Uuid::from_u128(1);
        let player_id = Uuid::from_u128(2);
        // One fixed envelope uploaded twice, so the bytes really are identical:
        // a re-upload derived from `Utc::now()` would differ in `recorded_at`
        // and hash to a different key.
        let envelope = TelemetryEnvelope {
            recorded_at: "2026-01-01T00:00:00Z".parse().expect("fixed timestamp"),
            ..TelemetryEnvelope::from(request(match_id, player_id))
        };
        svc.upload_envelope(envelope.clone()).await.unwrap();
        svc.upload_envelope(envelope).await.unwrap();

        // Same bytes -> same key, and the linkage collapses onto one row.
        assert_eq!(store.keys().len(), 2);
        assert_eq!(store.keys()[0], store.keys()[1]);
        assert_eq!(index.all().len(), 1);
    }

    #[tokio::test]
    async fn a_metadata_lookup_for_an_unknown_match_is_not_found() {
        let store = Arc::new(RecordingStore::new());
        let index = Arc::new(InMemoryTelemetryIndex::new());
        let svc = service(store, index);

        let error = svc
            .metadata(Uuid::from_u128(9), Uuid::from_u128(9))
            .await
            .expect_err("no telemetry for an unknown match");
        assert!(matches!(error, ApiError::NotFound));
    }

    #[test]
    fn the_retention_window_is_held_inside_the_policy_band() {
        assert_eq!(clamp_retention_days(90), MAX_RETENTION_DAYS);
        assert_eq!(clamp_retention_days(30), MIN_RETENTION_DAYS);
        assert_eq!(clamp_retention_days(60), 60);
        // A mishandled config can neither expire evidence early nor keep it
        // beyond the policy.
        assert_eq!(clamp_retention_days(1), MIN_RETENTION_DAYS);
        assert_eq!(clamp_retention_days(3_650), MAX_RETENTION_DAYS);
        assert_eq!(clamp_retention_days(DEFAULT_RETENTION_DAYS), DEFAULT_RETENTION_DAYS);
    }

    // ── Compression and circuit breaker (#1529) ──────────────────────────────

    #[test]
    fn the_breaker_opens_on_the_third_consecutive_failure() {
        let breaker = CircuitBreaker::new(DEFAULT_BREAKER_THRESHOLD, Duration::from_secs(60));

        breaker.record_failure();
        breaker.record_failure();
        assert_eq!(
            breaker.state(),
            CircuitState::Closed,
            "two failures are below the threshold"
        );

        breaker.record_failure();
        assert_eq!(breaker.state(), CircuitState::Open);
        assert!(!breaker.allows());
        assert_eq!(breaker.trips(), 1);
    }

    #[test]
    fn a_success_resets_the_failure_run() {
        let breaker = CircuitBreaker::new(DEFAULT_BREAKER_THRESHOLD, Duration::from_secs(60));

        breaker.record_failure();
        breaker.record_failure();
        breaker.record_success();
        breaker.record_failure();
        breaker.record_failure();

        assert_eq!(
            breaker.state(),
            CircuitState::Closed,
            "failures must be *consecutive* to open the breaker"
        );
    }

    #[tokio::test]
    async fn failed_uploads_open_the_breaker_and_skip_storage_while_open() {
        let store = Arc::new(RecordingStore::new());
        let index = Arc::new(InMemoryTelemetryIndex::new());
        let breaker = Arc::new(CircuitBreaker::new(
            DEFAULT_BREAKER_THRESHOLD,
            Duration::from_secs(60),
        ));
        // One attempt per upload, so each upload is exactly one failed write.
        let svc = TelemetryUploadService::new(store.clone(), index.clone(), DEFAULT_RETENTION_DAYS)
            .with_retry_policy(RetryPolicy::new(1, Duration::from_millis(0)))
            .with_breaker(breaker.clone());

        store.start_failing();
        for _ in 0..DEFAULT_BREAKER_THRESHOLD {
            assert!(svc
                .upload(request(Uuid::from_u128(1), Uuid::from_u128(2)))
                .await
                .is_err());
        }

        assert_eq!(breaker.state(), CircuitState::Open);
        assert_eq!(store.put_count(), DEFAULT_BREAKER_THRESHOLD);

        // The next upload is refused immediately: no write, no retry backoff,
        // so a processing loop calling this cannot be blocked by the outage.
        let error = svc
            .upload(request(Uuid::from_u128(1), Uuid::from_u128(2)))
            .await
            .expect_err("an open breaker must refuse the upload");

        assert!(matches!(error, ApiError::DependencyUnavailable { .. }));
        assert_eq!(
            store.put_count(),
            DEFAULT_BREAKER_THRESHOLD,
            "an open breaker must not attempt a write"
        );
        assert!(index.all().is_empty(), "nothing may be linked");
    }

    #[tokio::test]
    async fn a_probe_after_the_cooldown_closes_the_breaker() {
        let store = Arc::new(RecordingStore::new());
        let index = Arc::new(InMemoryTelemetryIndex::new());
        let breaker = Arc::new(CircuitBreaker::new(1, Duration::from_millis(50)));
        let svc = TelemetryUploadService::new(store.clone(), index.clone(), DEFAULT_RETENTION_DAYS)
            .with_retry_policy(RetryPolicy::new(1, Duration::from_millis(0)))
            .with_breaker(breaker.clone());

        store.start_failing();
        assert!(svc
            .upload(request(Uuid::from_u128(1), Uuid::from_u128(2)))
            .await
            .is_err());
        assert_eq!(breaker.state(), CircuitState::Open);

        // Storage comes back: once the cooldown elapses the probe goes through
        // and its success closes the breaker again.
        store.stop_failing();
        tokio::time::sleep(Duration::from_millis(80)).await;

        let outcome = svc
            .upload(request(Uuid::from_u128(1), Uuid::from_u128(2)))
            .await
            .unwrap();

        assert_eq!(breaker.state(), CircuitState::Closed);
        assert_eq!(outcome.summary.event_count, 2);
        assert_eq!(store.encodings(), vec![Some("gzip".to_string())]);
    }
}
