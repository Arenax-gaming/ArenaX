//! Time-lock voting escrow (#912).
//!
//! Users lock AX tokens for a duration of their choosing (up to
//! [`MAX_LOCK_DURATION`]) in exchange for a boosted voting weight: 10% per
//! full year locked, so a 4-year lock roughly doubles a user's raw stake
//! into governance weight. This is a *separate* facility from the flexible
//! reward pools in `flexible_rewards.rs` — those trade a fixed lock for
//! yield; this trades a fixed lock for governance power. Exiting before the
//! chosen unlock time forfeits a flat 25% of principal, unlike the
//! per-pool-configurable penalty flexible pools use.
//!
//! The `#[contractimpl]` methods that expose these types live in `lib.rs`;
//! this module only owns the storage type and side-effect-free math so the
//! math stays easy to unit test in isolation (matching `flexible_rewards.rs`
//! and `lp_incentives.rs`'s existing split).

use soroban_sdk::{contracttype, Address};

pub const SECS_PER_YEAR: u64 = 31_536_000;
pub const MAX_LOCK_YEARS: u64 = 4;
pub const MAX_LOCK_DURATION: u64 = MAX_LOCK_YEARS * SECS_PER_YEAR;
/// Voting-weight bonus per full year locked, in basis points (1_000 = 10%).
pub const BONUS_BPS_PER_YEAR: u32 = 1_000;
pub const BPS_DENOM: i128 = 10_000;
/// Flat penalty on principal for withdrawing before `unlock_at`.
pub const EARLY_UNLOCK_PENALTY_BPS: u32 = 2_500;

/// A user's time-locked voting position.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VotingEscrowLock {
    pub user: Address,
    pub amount: i128,
    pub locked_at: u64,
    /// Duration chosen at lock time, in seconds (bounded by `MAX_LOCK_DURATION`).
    pub duration: u64,
    pub unlock_at: u64,
}

/// Voting-weight bonus for a chosen lock `duration`, in basis points: 10%
/// per full year locked. A partial year earns no bonus for that partial
/// year (e.g. 18 months earns the same bonus as 12 months).
///
/// # Formula
/// ```math
/// \text{bonus\_bps} = \lfloor \text{duration} / \text{SECS\_PER\_YEAR} \rfloor \times 1000
/// ```
pub fn lock_bonus_bps(duration: u64) -> u32 {
    let years = (duration / SECS_PER_YEAR) as u32;
    years.saturating_mul(BONUS_BPS_PER_YEAR)
}

/// Voting weight granted by locking `amount` for `duration`: principal plus
/// its lock bonus. A 4-year lock (the max) yields a 40% bonus, e.g. locking
/// 1_000 AX for 4 years yields 1_400 voting weight.
///
/// # Formula
/// ```math
/// \text{weight} = \text{amount} + \frac{\text{amount} \times \text{bonus\_bps}}{\text{BPS\_DENOM}}
/// ```
pub fn voting_weight(amount: i128, duration: u64) -> i128 {
    let bonus_bps = lock_bonus_bps(duration) as i128;
    amount + (amount * bonus_bps / BPS_DENOM)
}

/// Flat 25% early-unlock penalty on principal, charged only when withdrawing
/// before `unlock_at`. Returns `0` once the lock has matured.
///
/// # Formula
/// ```math
/// \text{penalty} = \frac{\text{amount} \times 2500}{\text{BPS\_DENOM}}
/// ```
pub fn early_unlock_penalty(amount: i128, now: u64, unlock_at: u64) -> i128 {
    if now >= unlock_at {
        0
    } else {
        amount * EARLY_UNLOCK_PENALTY_BPS as i128 / BPS_DENOM
    }
}
