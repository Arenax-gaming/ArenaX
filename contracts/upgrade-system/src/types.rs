use soroban_sdk::{contracttype, Address, BytesN, Env, String, Vec};

/// Status of an upgrade proposal
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum UpgradeStatus {
    Pending = 0,
    Validated = 1,
    Scheduled = 2,
    Executed = 3,
    RolledBack = 4,
    Cancelled = 5,
    Failed = 6,
}

/// Type of upgrade being performed
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum UpgradeType {
    BugFix = 0,
    Feature = 1,
    Security = 2,
    Performance = 3,
    Breaking = 4,
}

/// Parameters for proposing an upgrade
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposeUpgradeParams {
    pub contract_address: Address,
    pub new_wasm_hash: BytesN<32>,
    pub upgrade_type: u32,
    pub timelock_duration: u64,
    pub description: String,
}

/// Upgrade proposal containing all upgrade details
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeProposal {
    pub proposal_id: BytesN<32>,
    pub contract_address: Address,
    pub new_wasm_hash: BytesN<32>,
    pub upgrade_type: u32,
    pub proposer: Address,
    pub status: u32,
    pub created_at: u64,
    pub scheduled_at: Option<u64>,
    pub executed_at: Option<u64>,
    pub timelock_end: u64,
    pub approval_count: u32,
    pub description: String,
    pub compatibility_score: u32,
    pub simulation_passed: bool,
}

/// Validation result for an upgrade
#[contracttype]
#[derive(Clone, Debug)]
pub struct ValidationResult {
    pub proposal_id: BytesN<32>,
    pub is_valid: bool,
    pub compatibility_score: u32,
    pub breaking_changes: bool,
    pub security_issues: Vec<String>,
    pub validated_at: u64,
    pub validator: Address,
}

/// Rollback information for a contract
#[contracttype]
#[derive(Clone, Debug)]
pub struct RollbackInfo {
    pub contract_address: Address,
    pub previous_wasm_hash: BytesN<32>,
    pub rollback_at: u64,
    pub reason: String,
    pub initiated_by: Address,
}

/// Upgrade history entry
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeHistoryEntry {
    pub upgrade_id: BytesN<32>,
    pub contract_address: Address,
    pub old_wasm_hash: BytesN<32>,
    pub new_wasm_hash: BytesN<32>,
    pub upgrade_type: u32,
    pub executed_at: u64,
    pub executed_by: Address,
    pub success: bool,
}

/// Emergency pause state
#[contracttype]
#[derive(Clone, Debug)]
pub struct EmergencyState {
    pub is_paused: bool,
    pub paused_at: Option<u64>,
    pub paused_by: Option<Address>,
    pub reason: Option<String>,
}

/// System configuration
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeConfig {
    pub governance_address: Address,
    pub min_timelock_duration: u64,
    pub max_timelock_duration: u64,
    pub required_approvals: u32,
    pub simulation_required: bool,
    pub emergency_multisig_threshold: u32,
}

impl Default for UpgradeConfig {
    fn default() -> Self {
        // This will be overridden during initialization
        // Using placeholder values that will be replaced
        Self {
            governance_address: Address::from_string(&String::from_str(
                &Env::default(),
                "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
            )),
            min_timelock_duration: 24 * 60 * 60,      // 24 hours
            max_timelock_duration: 30 * 24 * 60 * 60, // 30 days
            required_approvals: 3,
            simulation_required: true,
            emergency_multisig_threshold: 2,
        }
    }
}

/// Approval record for an upgrade
#[contracttype]
#[derive(Clone, Debug)]
pub struct ApprovalRecord {
    pub approver: Address,
    pub approved_at: u64,
    pub signature_hash: BytesN<32>,
}
