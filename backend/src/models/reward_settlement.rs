use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Settlement status for tracking the lifecycle of a reward settlement
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SettlementStatus {
    Pending,
    Submitted,
    Confirmed,
    Failed,
}

impl std::fmt::Display for SettlementStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SettlementStatus::Pending => write!(f, "pending"),
            SettlementStatus::Submitted => write!(f, "submitted"),
            SettlementStatus::Confirmed => write!(f, "confirmed"),
            SettlementStatus::Failed => write!(f, "failed"),
        }
    }
}

/// Reward settlement record as specified in issue #46
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardSettlement {
    #[serde(rename = "matchId")]
    pub match_id: String,
    pub winner: String,
    pub amount: String,
    pub asset: String,
    #[serde(rename = "txHash", skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<SettlementStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settled_at: Option<DateTime<Utc>>,
}

impl RewardSettlement {
    pub fn new(match_id: String, winner: String, amount: String, asset: String) -> Self {
        Self {
            match_id,
            winner,
            amount,
            asset,
            tx_hash: None,
            status: Some(SettlementStatus::Pending),
            created_at: Some(Utc::now()),
            settled_at: None,
        }
    }

    /// Check if settlement is already confirmed on-chain
    pub fn is_settled(&self) -> bool {
        matches!(self.status, Some(SettlementStatus::Confirmed))
    }
}
