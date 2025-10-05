//! Data types and structures for the ArenaX Staking Contract

use soroban_sdk::{contracttype, Address, String, Vec};

/// Staking pool configuration and state
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakingPool {
    /// Unique pool identifier
    pub pool_id: u64,
    /// Pool name/description
    pub name: String,
    /// Minimum stake amount required
    pub min_stake: i128,
    /// Maximum stake amount allowed (0 = unlimited)
    pub max_stake: i128,
    /// Annual percentage yield (in basis points, e.g., 1000 = 10%)
    pub apy: u64,
    /// Lock period in seconds
    pub lock_period: u64,
    /// Total tokens staked in this pool
    pub total_staked: i128,
    /// Total rewards distributed from this pool
    pub total_rewards_distributed: i128,
    /// Pool creation timestamp
    pub created_at: u64,
    /// Whether pool is active
    pub is_active: bool,
    /// Pool admin address
    pub admin: Address,
    /// Reward distribution frequency in seconds
    pub reward_frequency: u64,
    /// Last reward distribution timestamp
    pub last_reward_distribution: u64,
    /// Maximum total stake for the pool (0 = unlimited)
    pub max_total_stake: i128,
    /// Slash rate for early withdrawal (in basis points)
    pub early_withdrawal_penalty: u64,
    /// Governance voting multiplier for this pool
    pub governance_multiplier: u64,
}

/// Individual user stake information
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserStake {
    /// Staker address
    pub staker: Address,
    /// Pool ID where tokens are staked
    pub pool_id: u64,
    /// Amount of tokens staked
    pub amount: i128,
    /// Timestamp when tokens were staked
    pub staked_at: u64,
    /// Last reward claim timestamp
    pub last_reward_claim: u64,
    /// Accumulated rewards (not yet claimed)
    pub pending_rewards: i128,
    /// Total rewards claimed by user from this stake
    pub total_rewards_claimed: i128,
    /// Whether compound rewards are enabled
    pub compound_enabled: bool,
    /// Unstaking request timestamp (0 if not requested)
    pub unstake_requested_at: u64,
    /// Amount requested for unstaking
    pub unstake_amount: i128,
    /// User's reputation score affecting rewards
    pub reputation_multiplier: u64,
}

/// Governance proposal structure
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    /// Unique proposal ID
    pub proposal_id: u64,
    /// Proposer address
    pub proposer: Address,
    /// Proposal title
    pub title: String,
    /// Proposal description
    pub description: String,
    /// Proposal creation timestamp
    pub created_at: u64,
    /// Voting deadline timestamp
    pub voting_deadline: u64,
    /// Execution deadline timestamp
    pub execution_deadline: u64,
    /// Total votes for
    pub votes_for: i128,
    /// Total votes against
    pub votes_against: i128,
    /// Minimum voting power required to pass
    pub quorum_required: i128,
    /// Proposal status
    pub status: ProposalStatus,
    /// Proposal type
    pub proposal_type: ProposalType,
    /// Execution data (for automated execution)
    pub execution_data: String,
}

/// Governance vote record
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Vote {
    /// Voter address
    pub voter: Address,
    /// Proposal ID
    pub proposal_id: u64,
    /// Vote direction (true = for, false = against)
    pub vote_for: bool,
    /// Voting power used
    pub voting_power: i128,
    /// Vote timestamp
    pub voted_at: u64,
}

/// Slashing record
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlashRecord {
    /// Slashed user address
    pub user: Address,
    /// Slash amount
    pub amount: i128,
    /// Slash reason
    pub reason: String,
    /// Timestamp of slash
    pub slashed_at: u64,
    /// Admin who initiated the slash
    pub slashed_by: Address,
    /// Pool ID affected
    pub pool_id: u64,
}

/// Reward distribution record
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardDistribution {
    /// Pool ID
    pub pool_id: u64,
    /// Distribution timestamp
    pub distributed_at: u64,
    /// Total reward amount distributed
    pub total_amount: i128,
    /// Number of stakers who received rewards
    pub recipient_count: u32,
    /// Average reward per staker
    pub average_reward: i128,
    /// Distribution trigger (automatic/manual)
    pub trigger_type: String,
}

/// Proposal status enumeration
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    /// Proposal is active and accepting votes
    Active,
    /// Proposal passed and can be executed
    Passed,
    /// Proposal failed to meet requirements
    Failed,
    /// Proposal has been executed
    Executed,
    /// Proposal was cancelled
    Cancelled,
    /// Proposal expired without execution
    Expired,
}

/// Types of governance proposals
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalType {
    /// Update staking pool parameters
    PoolUpdate,
    /// Create new staking pool
    PoolCreation,
    /// Emergency actions (pause/unpause)
    Emergency,
    /// Update contract parameters
    ParameterUpdate,
    /// Treasury management
    Treasury,
    /// General governance decision
    General,
}

// Simple event types for Soroban compatibility

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakedEvent {
    pub user: Address,
    pub pool_id: u64,
    pub amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnstakedEvent {
    pub user: Address,
    pub pool_id: u64,
    pub amount: i128,
    pub penalty: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardsClaimedEvent {
    pub user: Address,
    pub pool_id: u64,
    pub amount: i128,
    pub timestamp: u64,
}

/// Contract errors
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum StakingError {
    /// Unauthorized access
    Unauthorized,
    /// Invalid pool ID
    InvalidPool,
    /// Insufficient balance
    InsufficientBalance,
    /// Stake amount too low
    StakeTooLow,
    /// Stake amount too high
    StakeTooHigh,
    /// Pool is inactive
    PoolInactive,
    /// Pool is at maximum capacity
    PoolMaxCapacity,
    /// Unstaking not allowed yet (locked period)
    StillLocked,
    /// No rewards available
    NoRewards,
    /// Invalid proposal
    InvalidProposal,
    /// Voting period ended
    VotingEnded,
    /// Insufficient voting power
    InsufficientVotingPower,
    /// Already voted
    AlreadyVoted,
    /// Proposal not found
    ProposalNotFound,
    /// Invalid parameters
    InvalidParameters,
    /// Contract is paused
    ContractPaused,
    /// Mathematical overflow
    Overflow,
    /// Division by zero
    DivisionByZero,
}

/// Contract configuration
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractConfig {
    /// Contract admin address
    pub admin: Address,
    /// ArenaX token contract address
    pub token_address: Address,
    /// Minimum proposal voting period
    pub min_voting_period: u64,
    /// Maximum proposal voting period
    pub max_voting_period: u64,
    /// Default quorum requirement (in basis points)
    pub default_quorum: u64,
    /// Minimum proposal stake required
    pub min_proposal_stake: i128,
    /// Contract pause status
    pub is_paused: bool,
    /// Total unique pools created
    pub total_pools_created: u64,
    /// Total unique proposals created
    pub total_proposals_created: u64,
    /// Emergency withdrawal enabled
    pub emergency_withdrawal_enabled: bool,
    /// Protocol fee rate (in basis points)
    pub protocol_fee_rate: u64,
    /// Fee collection address
    pub fee_collector: Address,
    /// Maximum pools per user
    pub max_pools_per_user: u32,
}

/// Storage keys for efficient data access
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageKey {
    /// Contract configuration
    Config,
    /// Staking pool by ID
    Pool(u64),
    /// User stake by (user, pool_id)
    UserStake(Address, u64),
    /// Governance proposal by ID
    Proposal(u64),
    /// Vote by (proposal_id, voter)
    Vote(u64, Address),
    /// Slash record by (user, timestamp)
    SlashRecord(Address, u64),
    /// Reward distribution by (pool_id, timestamp)
    RewardDistribution(u64, u64),
    /// User's total staked amount
    UserTotalStaked(Address),
    /// User's voting power
    UserVotingPower(Address),
    /// Pool statistics
    PoolStats(u64),
}