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

/// Pro-rata reward: `(principal * apy_bps * elapsed) / (SECS_PER_YEAR * BPS_DENOM)`
///
/// Computes accumulated rewards for a position based on the annual percentage
/// yield (in basis points), the time elapsed since last reward snapshot, and the
/// staked principal. Uses integer division which truncates toward zero (floor
/// for positive values), ensuring rewards never round up and cannot be exploited
/// via rounding edge cases.
///
/// - `principal`: the staked amount (`pos.amount`, positive i128)
/// - `apy_bps`: annual reward rate in basis points (e.g. 1500 = 15% APY)
/// - `elapsed`: seconds since `pos.last_reward_ts` (`now.saturating_sub(last_reward_ts)`)
///
/// # Formula
/// ```math
/// \text{rewards} = \frac{\text{principal} \times \text{apy\_bps} \times \text{elapsed}}{\text{SECS\_PER\_YEAR} \times \text{BPS\_DENOM}}
/// ```
///
/// # Precision
/// - 1 basis point precision is guaranteed: dividing by `BPS_DENOM` (10_000)
///   means each unit of `apy_bps` represents 0.01% of principal per year.
/// - Rounding: integer division truncates toward zero, so for positive values
///   this is equivalent to `floor()`. Rewards always round down, never up.
/// - 12-month verification: when `elapsed = SECS_PER_YEAR` and `apy_bps = 1200`
///   (12% APY), the result is `principal * 1200 / 10_000 = principal * 0.12`,
///   verifying the 12-month calculation.
pub fn calc_pending(pos: &FlexiblePosition, apy_bps: u32, now: u64) -> i128 {
    let elapsed = now.saturating_sub(pos.last_reward_ts) as i128;
    pos.amount * apy_bps as i128 * elapsed / (SECS_PER_YEAR as i128 * BPS_DENOM)
}

/// Basis-points penalty applied against `amount` for exiting a locked pool
/// before `unlock_at`. Returns `0` if `now >= unlock_at` or `penalty_bps == 0`.
///
/// The penalty is calculated as `(amount * penalty_bps) / BPS_DENOM`, where
/// `BPS_DENOM = 10_000`. Integer division truncates toward zero (floor for
/// positive values), ensuring the penalty never exceeds the calculated amount
/// and cannot be exploited via rounding edge cases.
///
/// # Formula
/// ```math
/// \text{penalty} = \frac{\text{amount} \times \text{penalty\_bps}}{\text{BPS\_DENOM}}
/// ```
///
/// # Precision
/// - 1 basis point precision: each unit of `penalty_bps` represents 0.01% of
///   the amount.
/// - Rounding: integer division truncates toward zero, so for positive `amount`
///   this is equivalent to `floor()`. The penalty always rounds down.
pub fn early_exit_penalty(amount: i128, penalty_bps: u32, now: u64, unlock_at: u64) -> i128 {
    if now >= unlock_at || penalty_bps == 0 {
        0
    } else {
        amount * penalty_bps as i128 / BPS_DENOM
    }
}
