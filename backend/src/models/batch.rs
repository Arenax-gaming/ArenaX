use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Maximum number of items allowed in a single batch request.
pub const MAX_BATCH_ITEMS: usize = 1000;

// ─── Batch Request ───────────────────────────────────────────────────────────

/// Top-level batch request envelope.
#[derive(Debug, Clone, Deserialize)]
pub struct BatchRequest {
    /// One of: `"create"`, `"update"`, `"delete"`.
    pub operation: BatchOperation,
    /// The target entity (e.g. `"users"`, `"tournaments"`).
    pub entity: String,
    /// The items to operate on (max [`MAX_BATCH_ITEMS`]).
    pub items: Vec<BatchItem>,
    /// Execution semantics.
    #[serde(default)]
    pub semantics: BatchSemantics,
}

/// Supported batch operation types.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BatchOperation {
    Create,
    Update,
    Delete,
}

/// Execution semantics for the batch.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BatchSemantics {
    /// All items must succeed or none will be persisted (default).
    Atomic,
    /// Items are processed independently; failures don't block other items.
    Partial,
}

impl Default for BatchSemantics {
    fn default() -> Self {
        BatchSemantics::Atomic
    }
}

/// A single item inside a batch request.
#[derive(Debug, Clone, Deserialize)]
pub struct BatchItem {
    /// Client-supplied correlation id (returned in the result so callers can
    /// match responses to requests).  Optional — a server-generated UUID is
    /// used when omitted.
    #[serde(default = "Uuid::new_v4")]
    pub client_id: Uuid,
    /// Arbitrary JSON payload whose shape depends on the entity and operation.
    pub data: serde_json::Value,
}

// ─── Batch Response ──────────────────────────────────────────────────────────

/// Top-level response envelope for a batch operation.
#[derive(Debug, Clone, Serialize)]
pub struct BatchResponse {
    /// Server-assigned batch id (useful for progress tracking / rollback).
    pub batch_id: Uuid,
    /// The operation that was executed.
    pub operation: BatchOperation,
    /// Aggregate status.
    pub status: BatchStatus,
    /// Individual item results, in the same order as the request.
    pub results: Vec<BatchItemResult>,
    /// Progress tracking summary.
    pub progress: BatchProgress,
    /// If semantics were `Atomic` and the batch was rolled back, this is set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollback: Option<BatchRollbackInfo>,
}

/// Aggregate status for the batch.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BatchStatus {
    /// All items succeeded (atomic: committed, partial: no failures).
    Completed,
    /// Some items failed in partial mode.
    PartialFailure,
    /// The entire batch was rolled back (atomic mode).
    RolledBack,
}

/// Per-item result.
#[derive(Debug, Clone, Serialize)]
pub struct BatchItemResult {
    /// Echo of the client-supplied correlation id.
    pub client_id: Uuid,
    /// Per-item status.
    pub status: BatchItemStatus,
    /// The resulting entity (for create / update) or the id that was deleted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    /// Error details when `status` is `"failed"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<BatchItemError>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BatchItemStatus {
    Succeeded,
    Failed,
}

/// Error details for a single failed item.
#[derive(Debug, Clone, Serialize)]
pub struct BatchItemError {
    pub code: String,
    pub message: String,
}

/// Progress tracking information.
#[derive(Debug, Clone, Serialize)]
pub struct BatchProgress {
    /// Total number of items in the request.
    pub total: usize,
    /// Number of items that succeeded.
    pub succeeded: usize,
    /// Number of items that failed.
    pub failed: usize,
}

/// Information about a rollback.
#[derive(Debug, Clone, Serialize)]
pub struct BatchRollbackInfo {
    /// Reason for the rollback.
    pub reason: String,
    /// Number of items that had been processed before the rollback was triggered.
    pub processed_before_rollback: usize,
}

// ─── Progress Tracking ───────────────────────────────────────────────────────

/// Payload for `GET /api/batch/{batch_id}/progress`.
#[derive(Debug, Clone, Serialize)]
pub struct BatchProgressResponse {
    pub batch_id: Uuid,
    pub status: BatchStatus,
    pub progress: BatchProgress,
}

// ─── Validation ──────────────────────────────────────────────────────────────

impl BatchRequest {
    /// Validate the request and return a user-friendly error on failure.
    pub fn validate(&self) -> Result<(), String> {
        if self.items.is_empty() {
            return Err("Batch must contain at least one item".to_string());
        }
        if self.items.len() > MAX_BATCH_ITEMS {
            return Err(format!(
                "Batch contains {} items, maximum allowed is {}",
                self.items.len(),
                MAX_BATCH_ITEMS,
            ));
        }
        if self.entity.is_empty() {
            return Err("Entity type is required".to_string());
        }
        // Validate supported entities
        let supported = ["users", "tournaments", "notifications", "wallets"];
        if !supported.contains(&self.entity.as_str()) {
            return Err(format!(
                "Unsupported entity type '{}'. Supported: {}",
                self.entity,
                supported.join(", "),
            ));
        }
        Ok(())
    }
}
