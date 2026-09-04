use soroban_sdk::{contractevent, Address, BytesN, Env};

pub const NAMESPACE: &str = "ArenaXStaking";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXStake_v1", "INIT"])]
pub struct Initialized {
    pub admin: Address,
    pub ax_token: Address,
}

#[contractevent(topics = ["ArenaXStake_v1", "TOKEN_SET"])]
pub struct TokenSet {
    pub token: Address,
}

#[contractevent(topics = ["ArenaXStake_v1", "TOURN_SET"])]
pub struct TournamentContractSet {
    pub contract: Address,
}

#[contractevent(topics = ["ArenaXStake_v1", "DISP_SET"])]
pub struct DisputeContractSet {
    pub contract: Address,
}

#[contractevent(topics = ["ArenaXStake_v1", "STAKED"])]
pub struct Staked {
    pub user: Address,
    pub tournament_id: BytesN<32>,
    pub amount: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "WITHDRAWN"])]
pub struct Withdrawn {
    pub user: Address,
    pub tournament_id: BytesN<32>,
    pub amount: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "SLASHED"])]
pub struct Slashed {
    pub user: Address,
    pub tournament_id: BytesN<32>,
    pub amount: i128,
    pub slashed_by: Address,
}

#[contractevent(topics = ["ArenaXStake_v1", "TOURN_NEW"])]
pub struct TournamentCreated {
    pub tournament_id: BytesN<32>,
    pub stake_requirement: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "TOURN_UPD"])]
pub struct TournamentUpdated {
    pub tournament_id: BytesN<32>,
    pub state: u32,
}

#[contractevent(topics = ["ArenaXStake_v1", "PAUSED"])]
pub struct ContractPaused {
    pub paused: bool,
    pub paused_by: Address,
}

pub fn emit_initialized(env: &Env, admin: &Address, ax_token: &Address) {
    Initialized {
        admin: admin.clone(),
        ax_token: ax_token.clone(),
    }
    .publish(env);
}

pub fn emit_token_set(env: &Env, token: &Address) {
    TokenSet {
        token: token.clone(),
    }
    .publish(env);
}

pub fn emit_tournament_contract_set(env: &Env, contract: &Address) {
    TournamentContractSet {
        contract: contract.clone(),
    }
    .publish(env);
}

pub fn emit_dispute_contract_set(env: &Env, contract: &Address) {
    DisputeContractSet {
        contract: contract.clone(),
    }
    .publish(env);
}

pub fn emit_staked(env: &Env, user: &Address, tournament_id: &BytesN<32>, amount: i128) {
    Staked {
        user: user.clone(),
        tournament_id: tournament_id.clone(),
        amount,
    }
    .publish(env);
}

pub fn emit_withdrawn(env: &Env, user: &Address, tournament_id: &BytesN<32>, amount: i128) {
    Withdrawn {
        user: user.clone(),
        tournament_id: tournament_id.clone(),
        amount,
    }
    .publish(env);
}

pub fn emit_slashed(
    env: &Env,
    user: &Address,
    tournament_id: &BytesN<32>,
    amount: i128,
    slashed_by: &Address,
) {
    Slashed {
        user: user.clone(),
        tournament_id: tournament_id.clone(),
        amount,
        slashed_by: slashed_by.clone(),
    }
    .publish(env);
}

pub fn emit_tournament_created(env: &Env, tournament_id: &BytesN<32>, stake_requirement: i128) {
    TournamentCreated {
        tournament_id: tournament_id.clone(),
        stake_requirement,
    }
    .publish(env);
}

pub fn emit_tournament_updated(env: &Env, tournament_id: &BytesN<32>, state: u32) {
    TournamentUpdated {
        tournament_id: tournament_id.clone(),
        state,
    }
    .publish(env);
}

pub fn emit_contract_paused(env: &Env, paused: bool, paused_by: &Address) {
    ContractPaused {
        paused,
        paused_by: paused_by.clone(),
    }
    .publish(env);
}

// ─── Flexible Reward Pools ───────────────────────────────────────────────────

#[contractevent(topics = ["ArenaXStake_v1", "POOL_CREATED"])]
pub struct RewardPoolCreated {
    pub pool_id: u32,
    pub apy_bps: u32,
    pub lock_duration: u64,
}

#[contractevent(topics = ["ArenaXStake_v1", "POOL_UPDATED"])]
pub struct RewardPoolUpdated {
    pub pool_id: u32,
    pub apy_bps: u32,
    pub active: bool,
}

#[contractevent(topics = ["ArenaXStake_v1", "FLEX_STAKED"])]
pub struct FlexibleStaked {
    pub user: Address,
    pub pool_id: u32,
    pub amount: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "FLEX_CLAIMED"])]
pub struct FlexibleClaimed {
    pub user: Address,
    pub pool_id: u32,
    pub amount: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "FLEX_UNSTAKED"])]
pub struct FlexibleUnstaked {
    pub user: Address,
    pub pool_id: u32,
    pub amount: i128,
    pub penalty: i128,
}

pub fn emit_reward_pool_created(env: &Env, pool_id: u32, apy_bps: u32, lock_duration: u64) {
    RewardPoolCreated {
        pool_id,
        apy_bps,
        lock_duration,
    }
    .publish(env);
}

pub fn emit_reward_pool_updated(env: &Env, pool_id: u32, apy_bps: u32, active: bool) {
    RewardPoolUpdated {
        pool_id,
        apy_bps,
        active,
    }
    .publish(env);
}

pub fn emit_flexible_staked(env: &Env, user: &Address, pool_id: u32, amount: i128) {
    FlexibleStaked {
        user: user.clone(),
        pool_id,
        amount,
    }
    .publish(env);
}

pub fn emit_flexible_claimed(env: &Env, user: &Address, pool_id: u32, amount: i128) {
    FlexibleClaimed {
        user: user.clone(),
        pool_id,
        amount,
    }
    .publish(env);
}

pub fn emit_flexible_unstaked(
    env: &Env,
    user: &Address,
    pool_id: u32,
    amount: i128,
    penalty: i128,
) {
    FlexibleUnstaked {
        user: user.clone(),
        pool_id,
        amount,
        penalty,
    }
    .publish(env);
}

// ─── LP Incentive Events ─────────────────────────────────────────────────────

#[contractevent(topics = ["ArenaXStake_v1", "LP_POOL_CREATED"])]
pub struct LpPoolCreated {
    pub pool_id: u32,
    pub reward_rate_bps: u32,
    pub il_protection_bps: u32,
}

#[contractevent(topics = ["ArenaXStake_v1", "LP_DEPOSITED"])]
pub struct LpDeposited {
    pub user: Address,
    pub pool_id: u32,
    pub amount: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "LP_WITHDRAWN"])]
pub struct LpWithdrawn {
    pub user: Address,
    pub pool_id: u32,
    pub amount: i128,
    pub rewards_claimed: i128,
    pub fees_claimed: i128,
    pub il_protection_paid: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "LP_REWARDS_CLAIMED"])]
pub struct LpRewardsClaimed {
    pub user: Address,
    pub pool_id: u32,
    pub rewards: i128,
    pub fees: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "LP_FEE_DEPOSITED"])]
pub struct LpFeeDeposited {
    pub pool_id: u32,
    pub amount: i128,
    pub cumulative_fees: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "LP_IL_PROTECTED"])]
pub struct LpIlProtectionPaid {
    pub user: Address,
    pub pool_id: u32,
    pub amount: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "LP_RATE_CHANGED"])]
pub struct LpRateChanged {
    pub pool_id: u32,
    pub old_rate_bps: u32,
    pub new_rate_bps: u32,
}

#[contractevent(topics = ["ArenaXStake_v1", "LP_PERF_RECORDED"])]
pub struct LpPerformanceRecorded {
    pub user: Address,
    pub pool_id: u32,
    pub timestamp: u64,
    pub liquidity_delta: i128,
    pub rewards_claimed: i128,
    pub fees_claimed: i128,
    pub il_protection_paid: i128,
}

pub fn emit_lp_pool_created(env: &Env, pool_id: u32, reward_rate_bps: u32, il_protection_bps: u32) {
    LpPoolCreated { pool_id, reward_rate_bps, il_protection_bps }.publish(env);
}

pub fn emit_lp_deposited(env: &Env, user: &Address, pool_id: u32, amount: i128) {
    LpDeposited { user: user.clone(), pool_id, amount }.publish(env);
}

pub fn emit_lp_withdrawn(
    env: &Env,
    user: &Address,
    pool_id: u32,
    amount: i128,
    rewards_claimed: i128,
    fees_claimed: i128,
    il_protection_paid: i128,
) {
    LpWithdrawn {
        user: user.clone(),
        pool_id,
        amount,
        rewards_claimed,
        fees_claimed,
        il_protection_paid,
    }
    .publish(env);
}

pub fn emit_lp_rewards_claimed(env: &Env, user: &Address, pool_id: u32, rewards: i128, fees: i128) {
    LpRewardsClaimed { user: user.clone(), pool_id, rewards, fees }.publish(env);
}

pub fn emit_lp_fee_deposited(env: &Env, pool_id: u32, amount: i128, cumulative_fees: i128) {
    LpFeeDeposited { pool_id, amount, cumulative_fees }.publish(env);
}

pub fn emit_lp_il_protection_paid(env: &Env, user: &Address, pool_id: u32, amount: i128) {
    LpIlProtectionPaid { user: user.clone(), pool_id, amount }.publish(env);
}

pub fn emit_lp_rate_changed(env: &Env, pool_id: u32, old_rate_bps: u32, new_rate_bps: u32) {
    LpRateChanged { pool_id, old_rate_bps, new_rate_bps }.publish(env);
}

pub fn emit_lp_performance_recorded(
    env: &Env,
    user: &Address,
    pool_id: u32,
    timestamp: u64,
    liquidity_delta: i128,
    rewards_claimed: i128,
    fees_claimed: i128,
    il_protection_paid: i128,
) {
    LpPerformanceRecorded {
        user: user.clone(),
        pool_id,
        timestamp,
        liquidity_delta,
        rewards_claimed,
        fees_claimed,
        il_protection_paid,
    }
    .publish(env);
}
