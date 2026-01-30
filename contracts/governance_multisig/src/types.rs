//! Data types for the Governance Multisig contract

use soroban_sdk::{contracttype, Address, Bytes, BytesN, Symbol};

/// Status of a governance proposal
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProposalStatus {
    /// Proposal is pending approvals
    Pending = 0,
    /// Proposal has met threshold and is ready to execute
    Approved = 1,
    /// Proposal has been executed
    Executed = 2,
    /// Proposal was cancelled by proposer
    Cancelled = 3,
}

/// Information about a signer
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerInfo {
    /// Address of the signer
    pub address: Address,
    /// Timestamp when the signer was added
    pub added_at: u64,
    /// Whether the signer is currently active
    pub is_active: bool,
}

/// A governance proposal for executing contract calls
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    /// Unique identifier for the proposal (32 bytes)
    pub proposal_id: BytesN<32>,
    /// Target contract address to call
    pub target_contract: Address,
    /// Function name to invoke on the target
    pub function: Symbol,
    /// XDR-encoded arguments for the function call
    pub args: Bytes,
    /// Address of the signer who created the proposal
    pub proposer: Address,
    /// Current status (stored as u32 for storage compatibility)
    pub status: u32,
    /// Current number of approvals
    pub approval_count: u32,
    /// Timestamp when the proposal was created
    pub created_at: u64,
    /// Optional earliest time when the proposal can be executed
    pub execute_after: Option<u64>,
    /// Optional timestamp when the proposal was executed
    pub executed_at: Option<u64>,
    /// Optional expiry timestamp after which proposal cannot be executed
    pub expiry: Option<u64>,
}

/// Configuration for the governance contract
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovernanceConfig {
    /// M-of-N threshold requirement (number of approvals needed)
    pub threshold: u32,
    /// Maximum number of signers allowed (default: 20)
    pub max_signers: u32,
    /// Time-to-live for proposals before they expire (default: 7 days in seconds)
    pub proposal_ttl: u64,
    /// Minimum delay before execution after threshold is met (default: 0)
    pub min_delay: u64,
}

impl Default for GovernanceConfig {
    fn default() -> Self {
        Self {
            threshold: 1,
            max_signers: 20,
            proposal_ttl: 7 * 24 * 60 * 60, // 7 days
            min_delay: 0,
        }
    }
}
