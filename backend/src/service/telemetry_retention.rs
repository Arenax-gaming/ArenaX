//! Telemetry retention sweep.
//!
//! Every recording carries the instant it may be purged (`retained_until`,
//! stamped at upload from the configured retention window). This service walks
//! those expiries on a timer, removes the object from S3/MinIO and marks the
//! match-record linkage as purged.
//!
//! A bucket lifecycle rule on the `telemetry/` prefix is the second line of
//! defence and catches anything this sweep never indexed, but the sweep is what
//! keeps PostgreSQL from accumulating references to objects that no longer
//! exist.
//!
//! Each recording is handled in isolation: one failure is logged and skipped,
//! never blocking the rest of the batch. Because a purge is idempotent (a
//! missing object deletes successfully), an interrupted sweep can simply be run
//! again.

use crate::api_error::ApiError;
use crate::service::evidence_storage::EvidenceStore;
use crate::service::telemetry_upload::{TelemetryIndex, PURGE_BATCH_LIMIT};
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, warn};

/// How often the sweeper wakes up, in seconds. Hourly: retention is measured in
/// days, so there is nothing to gain from checking more often.
pub const DEFAULT_CHECK_INTERVAL_SECS: u64 = 3600;

/// Outcome of one sweep, so a caller (or an admin endpoint) can report it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SweepReport {
    /// Recordings whose retention had elapsed and which were examined.
    pub examined: u64,
    /// Recordings whose object was removed and linkage marked purged.
    pub purged: u64,
    /// Recordings that could not be purged this pass; retried next sweep.
    pub failed: u64,
}

/// Purges telemetry recordings past their retention deadline.
pub struct TelemetryRetentionService {
    store: Arc<dyn EvidenceStore>,
    index: Arc<dyn TelemetryIndex>,
    check_interval_secs: u64,
}

impl TelemetryRetentionService {
    pub fn new(store: Arc<dyn EvidenceStore>, index: Arc<dyn TelemetryIndex>) -> Self {
        Self {
            store,
            index,
            check_interval_secs: DEFAULT_CHECK_INTERVAL_SECS,
        }
    }

    pub fn with_check_interval(mut self, secs: u64) -> Self {
        self.check_interval_secs = secs;
        self
    }

    /// Spawn the sweeper as a detached Tokio task.
    ///
    /// Mirrors [`crate::service::ReaperService::run`]: the first tick is
    /// skipped so the sweep does not run before the server has finished
    /// starting up.
    pub fn run(self: Arc<Self>) {
        let interval_secs = self.check_interval_secs;
        tokio::spawn(async move {
            info!(
                interval_secs,
                "Telemetry retention sweeper started — checking expiries every {}s", interval_secs
            );
            let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
            ticker.tick().await;

            loop {
                ticker.tick().await;
                match self.sweep().await {
                    Ok(report) if report.purged > 0 || report.failed > 0 => info!(
                        examined = report.examined,
                        purged = report.purged,
                        failed = report.failed,
                        "Telemetry retention sweep finished"
                    ),
                    Ok(_) => {}
                    Err(error) => error!(error = %error, "Telemetry retention sweep failed"),
                }
            }
        });
    }

    /// Purge everything whose retention has elapsed as of now.
    pub async fn sweep(&self) -> Result<SweepReport, ApiError> {
        self.sweep_at(Utc::now()).await
    }

    /// Purge as of an explicit instant. Separate from [`Self::sweep`] so tests
    /// can expire a recording without waiting out a real retention window.
    pub async fn sweep_at(&self, cutoff: chrono::DateTime<Utc>) -> Result<SweepReport, ApiError> {
        let expired = self.index.list_purgeable(cutoff, PURGE_BATCH_LIMIT).await?;
        let mut report = SweepReport {
            examined: expired.len() as u64,
            ..Default::default()
        };

        for reference in expired {
            if let Err(error) = self.purge_one(&reference).await {
                // One unreachable object must not stop the batch; it stays
                // unpurged and is retried on the next sweep.
                warn!(
                    match_id = %reference.match_id,
                    player_id = %reference.player_id,
                    object_key = %reference.object_key,
                    error = %error,
                    "Failed to purge telemetry recording"
                );
                report.failed += 1;
                continue;
            }
            report.purged += 1;
        }

        Ok(report)
    }

    /// Remove the object, then mark the linkage purged.
    ///
    /// Object first, metadata second: if the process dies in between, the
    /// recording is retried (the delete is idempotent) rather than being
    /// recorded as purged while the bytes are still in the bucket.
    async fn purge_one(
        &self,
        reference: &crate::models::telemetry::TelemetryReference,
    ) -> Result<(), ApiError> {
        self.store.delete(&reference.object_key).await?;
        self.index
            .mark_purged(reference.match_id, reference.player_id, Utc::now())
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::telemetry::retention_deadline;
    use crate::service::telemetry_upload::InMemoryTelemetryIndex;
    use std::sync::Mutex;

    /// Store that records deletions.
    struct DeletingStore {
        deleted: Mutex<Vec<String>>,
        fail: bool,
    }

    impl DeletingStore {
        fn new(fail: bool) -> Self {
            Self {
                deleted: Mutex::new(Vec::new()),
                fail,
            }
        }

        fn deleted(&self) -> Vec<String> {
            self.deleted.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl EvidenceStore for DeletingStore {
        async fn put(&self, _key: &str, _ct: &str, _bytes: &[u8]) -> Result<(), ApiError> {
            Ok(())
        }

        async fn get(&self, _key: &str) -> Result<Vec<u8>, ApiError> {
            Err(ApiError::not_found("not used"))
        }

        async fn delete(&self, key: &str) -> Result<(), ApiError> {
            self.deleted.lock().unwrap().push(key.to_string());
            if self.fail {
                return Err(ApiError::ServiceUnavailable("bucket unreachable".into()));
            }
            Ok(())
        }
    }

    fn reference(
        object_key: &str,
        uploaded_at: chrono::DateTime<Utc>,
        retention_days: i64,
    ) -> crate::models::telemetry::TelemetryReference {
        crate::models::telemetry::TelemetryReference {
            match_id: uuid::Uuid::new_v4(),
            player_id: uuid::Uuid::new_v4(),
            object_key: object_key.to_string(),
            content_hash: "hash".to_string(),
            byte_size: 128,
            event_count: 4,
            schema_version: 1,
            max_suspicion_score: 10,
            uploaded_at,
            retained_until: retention_deadline(uploaded_at, retention_days),
            purged_at: None,
        }
    }

    #[tokio::test]
    async fn expired_recordings_are_deleted_and_marked_purged() {
        let store = Arc::new(DeletingStore::new(false));
        let index = Arc::new(InMemoryTelemetryIndex::new());

        let expired = reference("telemetry/expired.json", Utc::now() - chrono::Duration::days(120), 90);
        let live = reference("telemetry/live.json", Utc::now() - chrono::Duration::days(10), 90);
        index.link(&expired).await.unwrap();
        index.link(&live).await.unwrap();

        let sweeper = TelemetryRetentionService::new(store.clone(), index.clone());
        let report = sweeper.sweep().await.unwrap();

        assert_eq!(report.examined, 1);
        assert_eq!(report.purged, 1);
        assert_eq!(report.failed, 0);
        assert_eq!(store.deleted(), vec!["telemetry/expired.json".to_string()]);

        // The live recording is untouched and still findable.
        let remaining = index.find(live.match_id, live.player_id).await.unwrap();
        assert!(remaining.is_some());
        let purged = index
            .find_for_match(expired.match_id)
            .await
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        assert!(purged.purged_at.is_some(), "linkage must be marked purged");
    }

    #[tokio::test]
    async fn a_failed_delete_is_reported_and_retried_next_sweep() {
        let store = Arc::new(DeletingStore::new(true));
        let index = Arc::new(InMemoryTelemetryIndex::new());
        let expired = reference("telemetry/expired.json", Utc::now() - chrono::Duration::days(200), 90);
        index.link(&expired).await.unwrap();

        let sweeper = TelemetryRetentionService::new(store, index.clone());
        let report = sweeper.sweep().await.unwrap();

        assert_eq!(report.purged, 0);
        assert_eq!(report.failed, 1);
        // Still purgeable, so the next sweep will try again.
        let again = index.list_purgeable(Utc::now(), 10).await.unwrap();
        assert_eq!(again.len(), 1);
    }

    #[tokio::test]
    async fn sweeping_nothing_is_a_no_op() {
        let store = Arc::new(DeletingStore::new(false));
        let index = Arc::new(InMemoryTelemetryIndex::new());
        let live = reference("telemetry/live.json", Utc::now(), 90);
        index.link(&live).await.unwrap();

        let sweeper = TelemetryRetentionService::new(store.clone(), index);
        let report = sweeper.sweep().await.unwrap();

        assert_eq!(report, SweepReport::default());
        assert!(store.deleted().is_empty());
    }
}
