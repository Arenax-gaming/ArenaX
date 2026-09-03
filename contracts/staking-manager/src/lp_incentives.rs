//! LP (Liquidity Provider) incentives module.
//!
//! Covers five acceptance criteria:
//!
//! 1. **LP reward allocation** — LPs earn AX rewards proportional to their share
//!    of total liquidity in a pool, accruing every second.
//! 2. **Dynamic reward rate** — The reward rate per pool can be updated by the
//!    admin at any time; existing rewards are snapshotted before the change takes
//!    effect so no historical accrual is lost.
//! 3. **Impermanent loss protection** — When an LP withdraws, the contract
//!    compares the current value of the LP's tokens against what they would have
//!    held if they had never deposited.  A configurable IL protection rate
//!    (in basis points, e.g. 5000 = 50 %) is paid from the fee reserve.
//! 4. **Fee sharing with LPs** — Protocol fees (denominated in AX tokens) can be
//!    deposited into a pool's fee reserve by the admin/fee-collector.  On
//!    withdrawal, an LP's pro-rata share of accumulated fees is paid out.
//! 5. **Historical LP performance** — Every deposit/withdrawal is appended to a
//!    per-user `LpPerformanceRecord` stored on-chain; admin can also push
//!    off-chain perf snapshots via `record_lp_performance`.
//!
//! This module owns the storage types and all side-effect-free math so the
//! contract methods in `lib.rs` stay thin.  `#[contracttype]` structs must be
//! defined here (or re-exported) before use in `lib.rs`.

use soroban_sdk::{contracttype, Address};

// ─── Constants ────────────────────────────────────────────────────────────────

pub const SECS_PER_YEAR: u64 = 31_536_000;
pub const BPS_DENOM: i128 = 10_000;

// ─── Storage types ────────────────────────────────────────────────────────────

/// Global configuration for an LP pool (one per pool id).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LpPoolConfig {
    pub id: u32,
    /// Annual reward rate in basis points (e.g. 2000 = 20 % APY).
    /// Governs acceptance criterion #1 (allocation) and #2 (dynamic rate).
    pub reward_rate_bps: u32,
    /// Total AX tokens currently deposited by all LPs.
    pub total_liquidity: i128,
    /// Accumulated fees (in AX) waiting to be distributed to LPs.
    /// Satisfies acceptance criterion #4 (fee sharing).
    pub fee_reserve: i128,
    /// Cumulative fees ever deposited — used for LP fee-share bookkeeping.
    pub cumulative_fees: i128,
    /// IL protection rate in basis points (0–10 000).
    /// Acceptance criterion #3.  0 = no IL protection for this pool.
    pub il_protection_bps: u32,
    /// Admin can deactivate a pool (no new deposits); existing LPs can still
    /// withdraw and claim.
    pub active: bool,
}

/// A single LP's position inside one pool.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LpPosition {
    pub user: Address,
    pub pool_id: u32,
    /// Current liquidity tokens (AX) deposited.
    pub amount: i128,
    pub deposited_at: u64,
    // ── Reward bookkeeping ────────────────────────────────────────────────
    /// Snapshot of pool.cumulative_fees at the moment of last deposit or claim.
    /// Used to compute the LP's share of fees earned since then.
    pub fee_debt: i128,
    /// AX rewards accrued but not yet claimed (reward-rate component).
    pub pending_rewards: i128,
    /// Timestamp at which pending_rewards was last snapshotted.
    pub last_reward_ts: u64,
    // ── IL protection bookkeeping ─────────────────────────────────────────
    /// Token-A price at deposit time (scaled ×1e7 for fixed-point).
    /// A value of `0` means IL protection is inactive for this position.
    pub entry_price_a: i128,
    /// Token-B price at deposit time (same scale).
    pub entry_price_b: i128,
}

/// One entry in the per-user historical performance log.
/// Acceptance criterion #5.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LpPerformanceRecord {
    pub user: Address,
    pub pool_id: u32,
    pub timestamp: u64,
    /// Net liquidity change for this event (positive = deposit, negative = withdraw).
    pub liquidity_delta: i128,
    /// Rewards claimed in this event (0 if a pure deposit).
    pub rewards_claimed: i128,
    /// Fees claimed in this event (0 if a pure deposit).
    pub fees_claimed: i128,
    /// IL protection payout in this event (0 if not applicable).
    pub il_protection_paid: i128,
}

// ─── Pure math helpers ────────────────────────────────────────────────────────

/// Pro-rata time-based LP reward.
///
/// Accrued = (position.amount / pool.total_liquidity) * reward_rate_bps * elapsed
///         / (SECS_PER_YEAR * BPS_DENOM)
///
/// Uses a simplified formula that avoids division by zero when total_liquidity
/// == 0 (returns 0 in that case).
pub fn calc_lp_rewards(pos: &LpPosition, rate_bps: u32, total_liquidity: i128, now: u64) -> i128 {
    if total_liquidity <= 0 || pos.amount <= 0 {
        return 0;
    }
    let elapsed = now.saturating_sub(pos.last_reward_ts) as i128;
    // Scale up to avoid integer truncation: compute numerator first.
    // reward = pos.amount * rate_bps * elapsed / (total_liquidity * SECS_PER_YEAR * BPS_DENOM)
    let numerator = pos.amount * rate_bps as i128 * elapsed;
    let denominator = total_liquidity * SECS_PER_YEAR as i128 * BPS_DENOM;
    if denominator == 0 {
        0
    } else {
        numerator / denominator
    }
}

/// LP's share of fees accrued since their last snapshot.
///
/// fee_earned = (pos.amount / pool.total_liquidity)
///            * (pool.cumulative_fees - pos.fee_debt)
///
/// Returns 0 if the pool has no liquidity.
pub fn calc_fee_share(pos: &LpPosition, pool: &LpPoolConfig) -> i128 {
    if pool.total_liquidity <= 0 || pos.amount <= 0 {
        return 0;
    }
    let fees_since = pool.cumulative_fees.saturating_sub(pos.fee_debt);
    if fees_since <= 0 {
        return 0;
    }
    // pos.amount / pool.total_liquidity  (scaled to avoid zero)
    fees_since * pos.amount / pool.total_liquidity
}

/// Impermanent loss protection payout.
///
/// IL is the percentage loss relative to "HODL" when the price ratio between
/// token A and B has changed.  For a 50/50 constant-product AMM the formula is:
///
///   IL_fraction = 2 * sqrt(r) / (1 + r) - 1,   where r = price_ratio_now / price_ratio_entry
///
/// Because Soroban runs `no_std` we approximate sqrt via Newton's method at
/// fixed-point.  Returned value is the AX amount the contract should compensate
/// (capped at `pos.amount` to avoid over-payment).
///
/// `price_a_now` and `price_b_now` are current prices scaled ×1e7.
/// `pool_il_bps` is the pool's IL protection rate (0–10 000 bps).
///
/// Returns 0 when:
///   - IL protection is disabled for the pool (bps == 0)
///   - Entry prices were not recorded (== 0)
///   - Prices have not diverged (ratio unchanged)
///   - No IL (prices moved in the same direction proportionally)
pub fn calc_il_protection(
    pos: &LpPosition,
    price_a_now: i128,
    price_b_now: i128,
    pool_il_bps: u32,
) -> i128 {
    if pool_il_bps == 0
        || pos.entry_price_a <= 0
        || pos.entry_price_b <= 0
        || price_a_now <= 0
        || price_b_now <= 0
        || pos.amount <= 0
    {
        return 0;
    }

    // r = (price_a_now / price_a_entry) / (price_b_now / price_b_entry)
    //   = (price_a_now * price_b_entry) / (price_b_now * price_a_entry)
    // Scaled ×1e7 to preserve precision.
    let scale: i128 = 10_000_000; // 1e7
    let r_num = price_a_now * pos.entry_price_b; // already ×1e14
    let r_den = price_b_now * pos.entry_price_a; // already ×1e14

    if r_den == 0 {
        return 0;
    }

    // r_scaled = r * scale  (so 1.0 → scale)
    let r_scaled = r_num * scale / r_den;

    if r_scaled == scale {
        return 0; // no price divergence
    }

    // sqrt_r_scaled ≈ sqrt(r) * scale  via Newton's method
    let sqrt_r_scaled = isqrt(r_scaled * scale); // sqrt(r * scale^2) = scale * sqrt(r)

    // 2*sqrt(r)/(1+r) - 1  all ×scale
    let one_plus_r = scale + r_scaled; // (1+r)*scale
    if one_plus_r == 0 {
        return 0;
    }

    let hold_value = 2 * sqrt_r_scaled * scale / one_plus_r; // in [0, scale]

    if hold_value >= scale {
        return 0; // no loss (shouldn't normally happen after divergence check)
    }

    // il_fraction (×scale) = scale - hold_value
    let il_fraction = scale - hold_value;

    // gross IL in AX = pos.amount * il_fraction / scale
    let gross_il = pos.amount * il_fraction / scale;

    // Apply pool protection rate
    let protected = gross_il * pool_il_bps as i128 / BPS_DENOM;

    // Cap at position size
    protected.min(pos.amount)
}

/// Integer square root (floor) using Newton's method.  Input must be non-negative.
fn isqrt(n: i128) -> i128 {
    if n <= 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Compute the dynamic reward rate based on utilisation.
///
/// As `total_liquidity` grows relative to `target_liquidity`, the rate
/// decreases towards `min_rate_bps`; below target the rate remains at
/// `base_rate_bps` (no bonuses — rate cannot exceed the base).
///
/// Formula (clamped):
///   if total_liquidity >= target: rate = max(min_rate_bps, base_rate_bps * target / total)
///   else:                         rate = base_rate_bps
///
/// All inputs in basis points; output is clamped to [min_rate_bps, base_rate_bps].
pub fn dynamic_rate(
    total_liquidity: i128,
    target_liquidity: i128,
    base_rate_bps: u32,
    min_rate_bps: u32,
) -> u32 {
    if target_liquidity <= 0 || total_liquidity <= 0 {
        return base_rate_bps;
    }
    if total_liquidity < target_liquidity {
        return base_rate_bps;
    }
    // Decrease proportionally once over-subscribed
    let scaled = base_rate_bps as i128 * target_liquidity / total_liquidity;
    let result = scaled.max(min_rate_bps as i128).min(base_rate_bps as i128);
    result as u32
}

// ─── Unit tests for pure math ─────────────────────────────────────────────────

#[cfg(test)]
mod math_tests {
    use super::*;
    use soroban_sdk::Env;

    fn dummy_pos(env: &Env, amount: i128, last_ts: u64) -> LpPosition {
        LpPosition {
            user: soroban_sdk::Address::generate(env),
            pool_id: 0,
            amount,
            deposited_at: last_ts,
            fee_debt: 0,
            pending_rewards: 0,
            last_reward_ts: last_ts,
            entry_price_a: 0,
            entry_price_b: 0,
        }
    }

    #[test]
    fn test_calc_lp_rewards_basic() {
        let env = Env::default();
        // 10 % APY, depositor owns 50 % of pool, elapsed 1 year → 5 % of deposit
        let pos = dummy_pos(&env, 1_000_000, 0);
        let reward = calc_lp_rewards(&pos, 1_000, 2_000_000, SECS_PER_YEAR);
        // expected: 1_000_000 * 1_000 * 31_536_000 / (2_000_000 * 31_536_000 * 10_000) = 50
        assert_eq!(reward, 50);
    }

    #[test]
    fn test_calc_lp_rewards_zero_liquidity() {
        let env = Env::default();
        let pos = dummy_pos(&env, 1_000_000, 0);
        assert_eq!(calc_lp_rewards(&pos, 1_000, 0, SECS_PER_YEAR), 0);
    }

    #[test]
    fn test_calc_fee_share_basic() {
        let env = Env::default();
        let mut pos = dummy_pos(&env, 500, 0);
        pos.fee_debt = 0;
        let pool = LpPoolConfig {
            id: 0,
            reward_rate_bps: 1_000,
            total_liquidity: 1_000,
            fee_reserve: 100,
            cumulative_fees: 100,
            il_protection_bps: 5_000,
            active: true,
        };
        // 500/1000 * 100 = 50
        assert_eq!(calc_fee_share(&pos, &pool), 50);
    }

    #[test]
    fn test_dynamic_rate_below_target() {
        // under target → base rate unchanged
        assert_eq!(dynamic_rate(500, 1_000, 2_000, 500), 2_000);
    }

    #[test]
    fn test_dynamic_rate_at_target() {
        assert_eq!(dynamic_rate(1_000, 1_000, 2_000, 500), 2_000);
    }

    #[test]
    fn test_dynamic_rate_above_target() {
        // double the target → rate halved, but min floors it
        let r = dynamic_rate(2_000, 1_000, 2_000, 500);
        assert_eq!(r, 1_000); // 2000 * 1000/2000 = 1000
    }

    #[test]
    fn test_dynamic_rate_floored_at_min() {
        // 10× target → rate would be 200, min is 500 → clamp to 500
        let r = dynamic_rate(10_000, 1_000, 2_000, 500);
        assert_eq!(r, 500);
    }

    #[test]
    fn test_il_protection_no_divergence() {
        let env = Env::default();
        let mut pos = dummy_pos(&env, 1_000_000, 0);
        pos.entry_price_a = 1_000_000; // $1.00 ×1e6
        pos.entry_price_b = 1_000_000;
        // Same prices → no IL
        assert_eq!(calc_il_protection(&pos, 1_000_000, 1_000_000, 5_000), 0);
    }

    #[test]
    fn test_il_protection_disabled() {
        let env = Env::default();
        let mut pos = dummy_pos(&env, 1_000_000, 0);
        pos.entry_price_a = 1_000_000;
        pos.entry_price_b = 1_000_000;
        assert_eq!(calc_il_protection(&pos, 2_000_000, 1_000_000, 0), 0);
    }

    #[test]
    fn test_il_protection_with_divergence() {
        let env = Env::default();
        let mut pos = dummy_pos(&env, 10_000_000, 0);
        pos.entry_price_a = 1_000_000;
        pos.entry_price_b = 1_000_000;
        // price A doubles relative to B → some IL should be computed
        let payout = calc_il_protection(&pos, 2_000_000, 1_000_000, 5_000);
        // payout must be positive and ≤ position size
        assert!(payout > 0);
        assert!(payout <= 10_000_000);
    }

    #[test]
    fn test_isqrt() {
        assert_eq!(isqrt(0), 0);
        assert_eq!(isqrt(1), 1);
        assert_eq!(isqrt(4), 2);
        assert_eq!(isqrt(9), 3);
        assert_eq!(isqrt(100), 10);
        assert_eq!(isqrt(10_000_000_000_000_000), 100_000_000); // 1e16 → 1e8
    }
}
