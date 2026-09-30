//! Dispute resolution system models (Issue #909).
//!
//! Kept independent of `match_models::MatchDispute`: that model and the
//! `match_disputes` table it maps to have unrelated, pre-existing schema
//! drift (the Rust struct expects columns the table doesn't have), and this
//! is a broader admin/support-facing ticket system, not limited to match
//! results. See the migration for the full rationale.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Lifecycle state of a dispute ticket.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TicketStatus {
    Open,
    UnderReview,
    Escalated,
    Resolved,
    Rejected,
    Closed,
}

impl TicketStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TicketStatus::Open => "open",
            TicketStatus::UnderReview => "under_review",
            TicketStatus::Escalated => "escalated",
            TicketStatus::Resolved => "resolved",
            TicketStatus::Rejected => "rejected",
            TicketStatus::Closed => "closed",
        }
    }

    /// A dispute is done once it's resolved, rejected, or closed -- no
    /// further status change or escalation is meaningful after that.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            TicketStatus::Resolved | TicketStatus::Rejected | TicketStatus::Closed
        )
    }
}

impl std::str::FromStr for TicketStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "open" => Ok(TicketStatus::Open),
            "under_review" => Ok(TicketStatus::UnderReview),
            "escalated" => Ok(TicketStatus::Escalated),
            "resolved" => Ok(TicketStatus::Resolved),
            "rejected" => Ok(TicketStatus::Rejected),
            "closed" => Ok(TicketStatus::Closed),
            other => Err(format!("unknown dispute status `{other}`")),
        }
    }
}

impl std::fmt::Display for TicketStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Escalation tier a dispute currently sits at.
///
/// 1 (front-line support) is where every ticket starts; 3 (admin/final say)
/// is the ceiling -- escalating past it is a no-op rather than an error, so
/// callers don't need to special-case "already at the top".
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(i16)]
pub enum EscalationLevel {
    FrontLine = 1,
    Senior = 2,
    Admin = 3,
}

impl EscalationLevel {
    pub fn as_i16(&self) -> i16 {
        *self as i16
    }

    pub fn next(&self) -> EscalationLevel {
        match self {
            EscalationLevel::FrontLine => EscalationLevel::Senior,
            EscalationLevel::Senior | EscalationLevel::Admin => EscalationLevel::Admin,
        }
    }
}

impl TryFrom<i16> for EscalationLevel {
    type Error = String;

    fn try_from(value: i16) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(EscalationLevel::FrontLine),
            2 => Ok(EscalationLevel::Senior),
            3 => Ok(EscalationLevel::Admin),
            other => Err(format!("invalid escalation level `{other}`")),
        }
    }
}

/// A dispute resolution ticket.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Dispute {
    pub id: Uuid,
    pub ticket_number: i64,
    pub opened_by: Uuid,
    pub match_id: Option<Uuid>,
    pub category: String,
    pub subject: String,
    pub description: String,
    /// Stored as text in the database; use `.status()` for the typed value.
    pub status: String,
    pub escalation_level: i16,
    pub assigned_to: Option<Uuid>,
    pub resolution: Option<String>,
    pub resolved_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

impl Dispute {
    /// Ticket number formatted the way a support agent would read it out:
    /// `DSP-000123`.
    pub fn ticket_id(&self) -> String {
        format!("DSP-{:06}", self.ticket_number)
    }

    pub fn status(&self) -> TicketStatus {
        // The column is constrained by a CHECK to only ever hold one of
        // these values, so this only fails if the schema and this enum have
        // drifted apart -- treated as a bug, not a runtime input error.
        self.status
            .parse()
            .unwrap_or_else(|e| panic!("dispute {} has invalid status: {e}", self.id))
    }

    pub fn escalation(&self) -> EscalationLevel {
        EscalationLevel::try_from(self.escalation_level)
            .unwrap_or_else(|e| panic!("dispute {} has invalid escalation level: {e}", self.id))
    }
}

/// One entry in a dispute's append-only resolution history.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DisputeHistoryEntry {
    pub id: Uuid,
    pub dispute_id: Uuid,
    pub actor_id: Option<Uuid>,
    pub action: String,
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub from_escalation_level: Option<i16>,
    pub to_escalation_level: Option<i16>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Evidence attached to a dispute.
///
/// This records metadata for a file the caller already uploaded elsewhere
/// (object storage, a CDN) -- there is no S3 client wired into the backend
/// yet, so this PR does not add binary upload/storage handling itself.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DisputeEvidence {
    pub id: Uuid,
    pub dispute_id: Uuid,
    pub uploaded_by: Option<Uuid>,
    pub file_url: String,
    pub file_name: String,
    pub content_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ─── Request/response DTOs ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateTicketRequest {
    pub category: String,
    pub subject: String,
    pub description: String,
    pub match_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct AddEvidenceRequest {
    pub file_url: String,
    pub file_name: String,
    pub content_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AssignDisputeRequest {
    pub assigned_to: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct EscalateDisputeRequest {
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ResolveDisputeRequest {
    pub resolution: String,
}

#[derive(Debug, Deserialize)]
pub struct RejectDisputeRequest {
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct ListDisputesQuery {
    pub status: Option<String>,
    pub category: Option<String>,
    pub assigned_to: Option<Uuid>,
    pub opened_by: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct DisputeDetail {
    #[serde(flatten)]
    pub dispute: Dispute,
    pub ticket_id: String,
    pub history: Vec<DisputeHistoryEntry>,
    pub evidence: Vec<DisputeEvidence>,
}
