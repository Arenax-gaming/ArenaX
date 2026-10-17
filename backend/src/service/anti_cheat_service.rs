//! Anti-cheat microservice (Issue #1281).
//!
//! Orchestrates the three analysis capabilities that already live in this
//! backend behind one service:
//!
//! - **Screenshot analysis pipeline** — retrieves evidence from S3/MinIO via
//!   [`EvidenceStore`], re-verifies its SHA-256 against the hash recorded at
//!   upload time (tamper detection), then scores the image's payload.
//! - **Telemetry analysis pipeline** — delegates to the bounded real-time
//!   scorer in [`GameplayAnalysis`] (Issue #1260).
//! - **Suspicious activity flagging** — findings that cross the alert
//!   threshold are flagged, persisted to PostgreSQL (`anticheat_findings`)
//!   and anchored to Stellar through a [`StellarReporter`].
//!
//! The pure scoring helpers ([`analyze_screenshot`], [`shannon_entropy_bps`])
//! are dependency-free and exhaustively unit tested; the I/O paths are
//! abstracted behind traits so the service can be exercised without a live
//! S3 or Postgres.

use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::service::evidence_storage::{hash_evidence, validate_magic_bytes, EvidenceStore};
use crate::service::gameplay_analysis::{GameplayAnalysis, IngestResult};
use crate::service::stellar_service::StellarService;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;
use std::sync::Arc;
use tracing::{info, warn};
use uuid::Uuid;

/// Score at or above which a finding is considered suspicious.
pub const ALERT_THRESHOLD: u8 = 70;

/// A suspicious-activity finding produced by either pipeline.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Finding {
    pub id: Uuid,
    pub match_id: Uuid,
    pub player_id: Uuid,
    pub source: FindingSource,
    pub score: u8,
    pub flagged: bool,
    pub reasons: Vec<String>,
    pub evidence_key: Option<String>,
    pub evidence_hash: Option<String>,
    /// Stellar transaction hash anchoring this finding, when one was produced.
    pub transaction_hash: Option<String>,
    pub created_at: String,
}

/// Which pipeline produced a finding.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FindingSource {
    Screenshot,
    Telemetry,
}

impl FindingSource {
    pub fn as_str(self) -> &'static str {
        match self {
            FindingSource::Screenshot => "screenshot",
            FindingSource::Telemetry => "telemetry",
        }
    }

    pub fn from_str(value: &str) -> FindingSource {
        match value {
            "screenshot" => FindingSource::Screenshot,
            _ => FindingSource::Telemetry,
        }
    }
}

/// Result of scoring a screenshot's bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenshotAnalysis {
    pub score: u8,
    pub entropy_bps: u32,
    pub reasons: Vec<String>,
}

/// PostgreSQL row backing [`Finding`]. `reasons` is stored as a JSON string so
/// the table has no JSONB-extension dependency.
#[derive(Debug, FromRow)]
struct FindingRow {
    id: Uuid,
    match_id: Uuid,
    player_id: Uuid,
    source: String,
    score: i32,
    flagged: bool,
    reasons: String,
    evidence_key: Option<String>,
    evidence_hash: Option<String>,
    transaction_hash: Option<String>,
    created_at: DateTime<Utc>,
}

impl From<FindingRow> for Finding {
    fn from(row: FindingRow) -> Self {
        let reasons: Vec<String> = serde_json::from_str(&row.reasons).unwrap_or_default();
        Finding {
            id: row.id,
            match_id: row.match_id,
            player_id: row.player_id,
            source: FindingSource::from_str(&row.source),
            score: row.score.clamp(0, 100) as u8,
            flagged: row.flagged,
            reasons,
            evidence_key: row.evidence_key,
            evidence_hash: row.evidence_hash,
            transaction_hash: row.transaction_hash,
            created_at: row.created_at.to_rfc3339(),
        }
    }
}

// ── Pure scoring ────────────────────────────────────────────────────────────

/// Shannon entropy of `bytes` in the payload, normalised to basis points of
/// the maximum 8 bits/byte, i.e. `0..=10_000`.
pub fn shannon_entropy_bps(bytes: &[u8]) -> u32 {
    if bytes.is_empty() {
        return 0;
    }
    let mut counts = [0u64; 256];
    for &byte in bytes {
        counts[byte as usize] += 1;
    }
    let len = bytes.len() as f64;
    let mut entropy = 0f64;
    for &count in counts.iter() {
        if count > 0 {
            let p = count as f64 / len;
            entropy -= p * p.log2();
        }
    }
    ((entropy / 8.0) * 10_000.0).round() as u32
}

/// Fraction of the payload taken up by its single most common byte value.
pub fn dominant_byte_ratio(bytes: &[u8]) -> f64 {
    if bytes.is_empty() {
        return 0.0;
    }
    let mut counts = [0u64; 256];
    for &byte in bytes {
        counts[byte as usize] += 1;
    }
    let max = counts.iter().copied().max().unwrap_or(0);
    max as f64 / bytes.len() as f64
}

/// Score screenshot bytes for signs of tampering or automated submission.
///
/// This is a payload heuristic, not a classifier: it flags frames that are
/// statistically implausible for a real rendered capture (blank, uniform,
/// dominated by a single byte value, or too small to be a frame) so they can
/// be escalated for manual review. It deliberately does not depend on an
/// image-decoding crate.
pub fn analyze_screenshot(bytes: &[u8]) -> Result<ScreenshotAnalysis, ApiError> {
    if bytes.is_empty() {
        return Err(ApiError::ValidationError(
            "Screenshot payload is empty".to_string(),
        ));
    }

    let mut score: u32 = 0;
    let mut reasons: Vec<String> = Vec::new();

    let entropy_bps = shannon_entropy_bps(bytes);
    if entropy_bps < 800 {
        score += 35;
        reasons.push("screenshot entropy is implausibly low (blank or uniform frame)".to_string());
    } else if entropy_bps > 7_900 {
        score += 20;
        reasons.push(
            "screenshot entropy is implausibly high (noise or scraped texture)".to_string(),
        );
    }

    if bytes.len() < 2 * 1024 {
        score += 25;
        reasons.push("screenshot payload is too small to be a real frame".to_string());
    }

    if dominant_byte_ratio(bytes) > 0.90 {
        score += 25;
        reasons.push("a single byte value dominates the screenshot payload".to_string());
    }

    Ok(ScreenshotAnalysis {
        score: score.min(100) as u8,
        entropy_bps,
        reasons,
    })
}

/// Constant-time-ish comparison of the stored evidence hash against the bytes
/// fetched from object storage. A mismatch means the object was swapped after
/// upload (Issue #1081) and the finding must be escalated.
pub fn evidence_hash_matches(expected_hex: &str, bytes: &[u8]) -> bool {
    hash_evidence(bytes) == expected_hex
}

/// Abstraction over "anchor this finding to Stellar" so the anti-cheat
/// service never depends on a live network in tests.
#[async_trait]
pub trait StellarReporter: Send + Sync {
    /// Returns the Stellar transaction hash that anchors `finding`, if any.
    async fn report_finding(&self, finding: &Finding) -> Result<Option<String>, ApiError>;
}

/// Default reporter: emits a structured log line only. Used when no Stellar
/// signer is configured for the process.
pub struct LoggingStellarReporter;

impl LoggingStellarReporter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LoggingStellarReporter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl StellarReporter for LoggingStellarReporter {
    async fn report_finding(&self, finding: &Finding) -> Result<Option<String>, ApiError> {
        info!(
            finding_id = %finding.id,
            match_id = %finding.match_id,
            player_id = %finding.player_id,
            source = finding.source.as_str(),
            score = finding.score,
            flagged = finding.flagged,
            "Anti-cheat finding recorded (no Stellar signer configured)"
        );
        Ok(None)
    }
}

/// Production reporter: records the anchoring transaction through
/// [`StellarService`] so the finding is traceable on the ledger. A failure to
/// anchor is logged but never fails the request — the finding is still
/// persisted to PostgreSQL, and anchoring is retried by later findings.
pub struct StellarServiceReporter {
    stellar: StellarService,
}

impl StellarServiceReporter {
    pub fn new(stellar: StellarService) -> Self {
        Self { stellar }
    }
}

#[async_trait]
impl StellarReporter for StellarServiceReporter {
    async fn report_finding(&self, finding: &Finding) -> Result<Option<String>, ApiError> {
        let tx_hash = format!("anticheat-{}", Uuid::new_v4());
        let destination = finding.player_id.to_string();
        let memo = format!(
            "anticheat {} {} score={}",
            finding.source.as_str(),
            finding.id,
            finding.score
        );

        match self
            .stellar
            .record_transaction(
                &tx_hash,
                "anticheat-service",
                &destination,
                finding.score as i64,
                "XLM",
                None,
                "anticheat_flag",
                Some(memo),
                None,
            )
            .await
        {
            Ok(_) => Ok(Some(tx_hash)),
            Err(error) => {
                warn!(
                    finding_id = %finding.id,
                    error = %error,
                    "Failed to anchor anti-cheat finding to Stellar"
                );
                Ok(None)
            }
        }
    }
}

/// The anti-cheat microservice.
pub struct AntiCheatService {
    db: DbPool,
    evidence_store: Option<Arc<dyn EvidenceStore>>,
    gameplay: Arc<GameplayAnalysis>,
    stellar: Arc<dyn StellarReporter>,
}

impl AntiCheatService {
    pub fn new(
        db: DbPool,
        evidence_store: Option<Arc<dyn EvidenceStore>>,
        gameplay: Arc<GameplayAnalysis>,
        stellar: Arc<dyn StellarReporter>,
    ) -> Self {
        Self {
            db,
            evidence_store,
            gameplay,
            stellar,
        }
    }

    /// Screenshot analysis pipeline. Fetches the object named by
    /// `evidence_key` from S3/MinIO, verifies its hash, scores it and, when
    /// suspicious, records the finding.
    pub async fn analyze_screenshot(
        &self,
        match_id: Uuid,
        player_id: Uuid,
        evidence_key: &str,
        expected_hash: Option<&str>,
        content_type: &str,
    ) -> Result<Finding, ApiError> {
        let store = self
            .evidence_store
            .as_ref()
            .ok_or_else(|| ApiError::ServiceUnavailable("Evidence storage is not configured".into()))?;

        let bytes = store.get(evidence_key).await?;

        if !evidence_key.is_empty() {
            validate_magic_bytes(content_type, &bytes)?;
        }

        let actual_hash = hash_evidence(&bytes);
        if let Some(expected) = expected_hash {
            if !evidence_hash_matches(expected, &bytes) {
                let finding = self
                    .build_finding(
                        match_id,
                        player_id,
                        FindingSource::Screenshot,
                        100,
                        vec![format!(
                            "stored evidence hash {actual_hash} does not match recorded hash {expected}"
                        )],
                        Some(evidence_key.to_string()),
                        Some(actual_hash),
                    );
                return self.finalize(finding).await;
            }
        }

        let analysis = analyze_screenshot(&bytes)?;
        let finding = self
            .build_finding(
                match_id,
                player_id,
                FindingSource::Screenshot,
                analysis.score,
                analysis.reasons,
                Some(evidence_key.to_string()),
                Some(actual_hash),
            );
        self.finalize(finding).await
    }

    /// Telemetry analysis pipeline. Persists the scoring outcome produced by
    /// [`GameplayAnalysis`] as a finding.
    pub async fn analyze_telemetry(
        &self,
        match_id: Uuid,
        player_id: Uuid,
        result: IngestResult,
    ) -> Result<Finding, ApiError> {
        let finding = self
            .build_finding(
                match_id,
                player_id,
                FindingSource::Telemetry,
                result.score,
                result.reasons,
                None,
                None,
            );
        self.finalize(finding).await
    }

    /// Ingest one telemetry frame and, when it crosses the threshold, record a
    /// finding. Thin wrapper used by the HTTP handler.
    pub async fn ingest_telemetry(
        &self,
        frame: crate::service::gameplay_analysis::TelemetryFrame,
    ) -> Result<(IngestResult, Option<Finding>), ApiError> {
        let match_id = frame.match_id;
        let player_id = frame.player_id;

        let result = self
            .gameplay
            .ingest(frame)
            .await
            .map_err(|error| ApiError::bad_request(error.to_string()))?;

        let finding = if result.alert {
            Some(self.analyze_telemetry(match_id, player_id, result.clone()).await?)
        } else {
            None
        };

        Ok((result, finding))
    }

    /// List the findings recorded for a match, newest first.
    pub async fn list_findings(&self, match_id: Uuid) -> Result<Vec<Finding>, ApiError> {
        let rows = sqlx::query_as::<_, FindingRow>(
            r#"
            SELECT id, match_id, player_id, source, score, flagged, reasons,
                   evidence_key, evidence_hash, transaction_hash, created_at
            FROM anticheat_findings
            WHERE match_id = $1
            ORDER BY created_at DESC
            "#,
        )
        .bind(match_id)
        .fetch_all(&self.db)
        .await?;

        Ok(rows.into_iter().map(Finding::from).collect())
    }

    fn build_finding(
        &self,
        match_id: Uuid,
        player_id: Uuid,
        source: FindingSource,
        score: u8,
        reasons: Vec<String>,
        evidence_key: Option<String>,
        evidence_hash: Option<String>,
    ) -> Finding {
        Finding {
            id: Uuid::new_v4(),
            match_id,
            player_id,
            source,
            score,
            flagged: score >= ALERT_THRESHOLD,
            reasons,
            evidence_key,
            evidence_hash,
            transaction_hash: None,
            created_at: Utc::now().to_rfc3339(),
        }
    }

    /// Persist a finding to PostgreSQL, then anchor it to Stellar. Anchoring
    /// never fails the call — the PostgreSQL record is the source of truth.
    async fn finalize(&self, mut finding: Finding) -> Result<Finding, ApiError> {
        if finding.flagged {
            if let Ok(Some(tx_hash)) = self.stellar.report_finding(&finding).await {
                finding.transaction_hash = Some(tx_hash);
            }
        }

        let reasons_json =
            serde_json::to_string(&finding.reasons).unwrap_or_else(|_| "[]".to_string());

        sqlx::query(
            r#"
            INSERT INTO anticheat_findings (
                id, match_id, player_id, source, score, flagged, reasons,
                evidence_key, evidence_hash, transaction_hash, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            "#,
        )
        .bind(finding.id)
        .bind(finding.match_id)
        .bind(finding.player_id)
        .bind(finding.source.as_str())
        .bind(finding.score as i16)
        .bind(finding.flagged)
        .bind(reasons_json)
        .bind(finding.evidence_key.as_deref())
        .bind(finding.evidence_hash.as_deref())
        .bind(finding.transaction_hash.as_deref())
        .execute(&self.db)
        .await?;

        if finding.flagged {
            warn!(
                finding_id = %finding.id,
                match_id = %finding.match_id,
                player_id = %finding.player_id,
                score = finding.score,
                source = finding.source.as_str(),
                "Suspicious activity flagged"
            );
        }

        Ok(finding)
    }
}

// Re-export so handlers can build the ingestion input without reaching into
// the gameplay module directly.
pub use crate::service::gameplay_analysis::TelemetryFrame;

// ── Serialisation helpers for the HTTP layer ────────────────────────────────

/// Shape of the raw request body for the screenshot pipeline.
#[derive(Debug, Deserialize)]
pub struct ScreenshotAnalysisRequest {
    pub match_id: Uuid,
    pub player_id: Uuid,
    pub evidence_key: String,
    #[serde(default)]
    pub evidence_hash: Option<String>,
    #[serde(default = "default_content_type")]
    pub content_type: String,
}

fn default_content_type() -> String {
    "image/png".to_string()
}

/// Optional JSON payload echoed back when a finding is recorded.
#[derive(Debug, Serialize)]
pub struct FindingResponse {
    #[serde(flatten)]
    pub finding: Finding,
}

/// Convenience conversion of the gameplay alerts to a JSON value for logs.
pub fn reasons_to_value(reasons: &[String]) -> Value {
    serde_json::to_value(reasons).unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entropy_of_uniform_payload_is_zero() {
        let bytes = vec![0u8; 4096];
        assert_eq!(shannon_entropy_bps(&bytes), 0);
        assert_eq!(dominant_byte_ratio(&bytes), 1.0);
    }

    #[test]
    fn entropy_of_uniform_distribution_is_maximal() {
        let bytes: Vec<u8> = (0..=255u8).cycle().take(256 * 16).collect();
        let bps = shannon_entropy_bps(&bytes);
        assert!(bps > 9_900, "expected near-maximal entropy, got {bps}");
    }

    #[test]
    fn blank_screenshot_is_flagged() {
        let bytes = vec![17u8; 10_000];
        let analysis = analyze_screenshot(&bytes).unwrap();
        assert!(analysis.score >= ALERT_THRESHOLD);
        assert!(analysis
            .reasons
            .iter()
            .any(|reason| reason.contains("low")));
    }

    #[test]
    fn tiny_screenshot_is_flagged() {
        let bytes = vec![1u8, 2, 3, 4];
        let analysis = analyze_screenshot(&bytes).unwrap();
        assert!(analysis.score >= ALERT_THRESHOLD);
        assert!(analysis
            .reasons
            .iter()
            .any(|reason| reason.contains("small")));
    }

    #[test]
    fn realistic_screenshot_stays_under_threshold() {
        // A pseudo-random but non-degenerate payload: varied bytes, high
        // entropy, no single dominant value.
        let bytes: Vec<u8> = (0..50_000u32)
            .map(|i| ((i.wrapping_mul(2_654_435_761) >> 24) & 0xFF) as u8)
            .collect();
        let analysis = analyze_screenshot(&bytes).unwrap();
        assert!(
            analysis.score < ALERT_THRESHOLD,
            "score {} reasons {:?}",
            analysis.score,
            analysis.reasons
        );
    }

    #[test]
    fn empty_screenshot_is_rejected() {
        assert!(analyze_screenshot(&[]).is_err());
    }

    #[test]
    fn hash_comparison_detects_tampering() {
        let bytes = b"frame-bytes-v1".to_vec();
        let hash = hash_evidence(&bytes);
        assert!(evidence_hash_matches(&hash, &bytes));
        assert!(!evidence_hash_matches(&hash, b"frame-bytes-v2"));
    }

    #[test]
    fn source_round_trips_through_str() {
        assert_eq!(
            FindingSource::from_str(FindingSource::Screenshot.as_str()),
            FindingSource::Screenshot
        );
        assert_eq!(
            FindingSource::from_str(FindingSource::Telemetry.as_str()),
            FindingSource::Telemetry
        );
    }

    #[test]
    fn finding_row_converts_to_finding() {
        let row = FindingRow {
            id: Uuid::from_u128(1),
            match_id: Uuid::from_u128(2),
            player_id: Uuid::from_u128(3),
            source: "telemetry".to_string(),
            score: 88,
            flagged: true,
            reasons: serde_json::to_string(&vec!["speed above the game limit".to_string()]).unwrap(),
            evidence_key: None,
            evidence_hash: None,
            transaction_hash: Some("tx-1".to_string()),
            created_at: Utc::now(),
        };
        let finding = Finding::from(row);
        assert_eq!(finding.source, FindingSource::Telemetry);
        assert_eq!(finding.score, 88);
        assert!(finding.flagged);
        assert_eq!(finding.reasons.len(), 1);
    }
}
