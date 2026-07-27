//! Flexible reward pool types and pure calculation helpers.
//!
//! Extends the base staking manager with *multiple* reward pools, each with
//! its own APY, lock duration, and early-exit penalty. This lets governance
//! offer a menu of risk/reward tradeoffs (e.g. a 0%-penalty flexible pool at
//! a modest APY, alongside 30/90/180-day locked pools at richer APYs) rather
//! than a single fixed global rate.
//!
//! The `#[contractimpl]` methods that expose these types live in `lib.rs`
//! (Soroban requires a single contract-impl block per contract type); this
//! module only owns the storage types and side-effect-free math so that math
//! stays easy to unit test in isolation.

use soroban_sdk::{contracttype, Address};

pub const SECS_PER_YEAR: u64 = 31_536_000;
pub const BPS_DENOM: i128 = 10_000;

/// Configuration and running totals for a single reward pool/tier.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardPool {
    pub id: u32,
    /// Annual reward rate in basis points (e.g. 1500 = 15% APY).
    pub apy_bps: u32,
    /// Lock duration in seconds. `0` marks a "flexible" pool that can be
    /// unstaked at any time with no penalty.
    pub lock_duration: u64,
    /// Basis points of principal forfeited on withdrawal before the lock
    /// expires. Only meaningful when `lock_duration > 0`.
    pub early_exit_penalty_bps: u32,
    /// Admin can deactivate a pool to stop new stakes while letting existing
    /// positions run to completion.
    pub active: bool,
    pub total_staked: i128,
}

/// A user's stake within a specific [`RewardPool`].
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FlexiblePosition {
    pub user: Address,
    pub pool_id: u32,
    pub amount: i128,
    pub staked_at: u64,
    /// Timestamp after which principal can be withdrawn without penalty.
    pub unlock_at: u64,
    /// Rewards accrued but not yet snapshotted into a claim.
    pub pending_rewards: i128,
    pub last_reward_ts: u64,
}

/// Pro-rata reward: principal * apy_bps * elapsed / (secs_per_year * 10_000)
pub fn calc_pending(pos: &FlexiblePosition, apy_bps: u32, now: u64) -> i128 {
    let elapsed = now.saturating_sub(pos.last_reward_ts) as i128;
    pos.amount * apy_bps as i128 * elapsed / (SECS_PER_YEAR as i128 * BPS_DENOM)
}

/// Basis-points penalty applied against `amount` for exiting a locked pool
/// before `unlock_at`. Returns `0` if `now >= unlock_at`.
pub fn early_exit_penalty(amount: i128, penalty_bps: u32, now: u64, unlock_at: u64) -> i128 {
    if now >= unlock_at || penalty_bps == 0 {
        0
    } else {
        amount * penalty_bps as i128 / BPS_DENOM
    }
}
