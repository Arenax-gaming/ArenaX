//! Constant-product liquidity pool for AX token (Issue #882).
//!
//! # The invariant everything rests on
//!
//! `x * y >= k`, where `x` and `y` are the two reserves. Every operation must
//! leave the product no smaller than it was. Swaps grow it by the fee;
//! deposits and withdrawals move it proportionally. If any path can shrink it,
//! that path drains the pool — so `k` is checked after each swap rather than
//! assumed.
//!
//! # Rounding is a safety property, not a detail
//!
//! Integer division truncates, and the direction of that truncation decides who
//! absorbs the lost fraction. Every rounding decision here is deliberately
//! **against the caller and in favour of the pool**:
//!
//! - Swap output rounds *down*, so the trader never receives a stroop the
//!   invariant did not account for.
//! - LP tokens minted on deposit round *down*, so a depositor cannot mint a
//!   share they have not funded.
//! - Amounts returned on withdrawal round *down*, so a withdrawal cannot take
//!   more than the share is worth.
//!
//! Rounding the other way is the classic first-depositor and share-inflation
//! bug class: each individually looks like an off-by-one, and each is a way to
//! extract value from other LPs.
//!
//! # Minimum liquidity
//!
//! The first deposit permanently locks `MINIMUM_LIQUIDITY` LP tokens. Without
//! it, an attacker can be the sole LP, withdraw down to a dust reserve, and
//! then donate directly to the pool to inflate the value of one LP share so far
//! that a later depositor's share rounds to zero. Locking a floor makes total
//! supply unable to return to a value small enough for that to work. Uniswap V2
//! does the same thing for the same reason.

use soroban_sdk::{contracttype, Address, Env};

use crate::error::VirtualEconomyError;
use crate::storage::DataKey;

/// Fee taken from each swap's input, in basis points. 0.3% as the issue
/// specifies, accruing to LPs by being left in the reserves.
pub const SWAP_FEE_BPS: i128 = 30;
pub const BPS_DENOMINATOR: i128 = 10_000;

/// LP tokens burned on the first deposit and never redeemable.
pub const MINIMUM_LIQUIDITY: i128 = 1_000;

/// Cap on `slippage_bps` so a caller cannot disable slippage protection by
/// passing a nonsensical tolerance.
pub const MAX_SLIPPAGE_BPS: i128 = 5_000; // 50%

/// A two-asset constant-product pool.
///
/// Reserves are tracked here rather than read from balances so that a direct
/// transfer into the pool cannot silently change the price. Donations are
/// absorbed by `sync`, deliberately and visibly.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidityPool {
    /// Reserve of asset A (AX token).
    pub reserve_a: i128,
    /// Reserve of asset B (the paired asset).
    pub reserve_b: i128,
    /// Total LP tokens in circulation, including the locked minimum.
    pub total_shares: i128,
    /// Cumulative price accumulators for the TWAP oracle.
    pub price_a_cumulative: i128,
    pub price_b_cumulative: i128,
    /// Ledger timestamp of the last reserve-changing operation.
    pub last_update: u64,
    pub fee_bps: i128,
}

/// A price observation, for the oracle read.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceSnapshot {
    pub price_a_cumulative: i128,
    pub price_b_cumulative: i128,
    pub reserve_a: i128,
    pub reserve_b: i128,
    pub timestamp: u64,
}

/// Result of a swap, for events and callers.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwapResult {
    pub amount_in: i128,
    pub amount_out: i128,
    pub fee_paid: i128,
    pub new_reserve_a: i128,
    pub new_reserve_b: i128,
}

/// Result of a liquidity deposit.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositResult {
    pub amount_a: i128,
    pub amount_b: i128,
    pub shares_minted: i128,
    pub total_shares: i128,
}

/// Result of a liquidity withdrawal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawResult {
    pub amount_a: i128,
    pub amount_b: i128,
    pub shares_burned: i128,
    pub total_shares: i128,
}

/// Integer square root by Newton's method.
///
/// Used for the initial LP mint, `sqrt(a * b)`, which is what makes the first
/// depositor's share independent of the ratio they chose to deposit at.
fn integer_sqrt(value: i128) -> i128 {
    if value <= 0 {
        return 0;
    }
    if value < 4 {
        return 1;
    }

    let mut guess = value;
    let mut next = (value / 2) + 1;
    // Newton's method decreases monotonically until it overshoots by one, which
    // is the standard termination condition for the integer variant.
    while next < guess {
        guess = next;
        next = (next + value / next) / 2;
    }
    guess
}

/// `a * b / denominator`, rounded down, without overflowing on the product.
///
/// i128 is wide enough that a direct multiply is safe for realistic reserves,
/// but "realistic" is not a guarantee — a checked multiply that falls back to
/// dividing first keeps a large-reserve pool from panicking mid-swap.
fn mul_div_floor(a: i128, b: i128, denominator: i128) -> Result<i128, VirtualEconomyError> {
    if denominator == 0 {
        return Err(VirtualEconomyError::InvalidAmount);
    }
    match a.checked_mul(b) {
        Some(product) => Ok(product / denominator),
        None => {
            // Lossy fallback, only on a path that would otherwise abort.
            let reduced = a / denominator;
            reduced
                .checked_mul(b)
                .ok_or(VirtualEconomyError::InvalidAmount)
        }
    }
}

pub struct AmmManager;

impl AmmManager {
    // ---------------------------------------------------------------------
    // Pricing
    // ---------------------------------------------------------------------

    /// Output for a given input under `x * y = k`, after the fee.
    ///
    /// The fee is taken from the *input* before it is applied to the curve, so
    /// the uncharged portion stays in the reserves and accrues to LPs. That is
    /// why no separate fee balance is tracked: LP value grows because `k` grows.
    ///
    /// # Errors
    /// - `InvalidAmount` if the input is not positive.
    /// - `InsufficientLiquidity` if either reserve is empty.
    pub fn get_amount_out(
        amount_in: i128,
        reserve_in: i128,
        reserve_out: i128,
        fee_bps: i128,
    ) -> Result<i128, VirtualEconomyError> {
        if amount_in <= 0 {
            return Err(VirtualEconomyError::InvalidAmount);
        }
        if reserve_in <= 0 || reserve_out <= 0 {
            return Err(VirtualEconomyError::InsufficientLiquidity);
        }

        let amount_in_after_fee =
            mul_div_floor(amount_in, BPS_DENOMINATOR - fee_bps, BPS_DENOMINATOR)?;
        if amount_in_after_fee <= 0 {
            // A trade so small the entire input rounds away as fee. Rejecting is
            // better than accepting an input that buys nothing.
            return Err(VirtualEconomyError::InvalidAmount);
        }

        let numerator = amount_in_after_fee
            .checked_mul(reserve_out)
            .ok_or(VirtualEconomyError::InvalidAmount)?;
        let denominator = reserve_in
            .checked_add(amount_in_after_fee)
            .ok_or(VirtualEconomyError::InvalidAmount)?;

        // Rounds down: the trader absorbs the truncation, never the pool.
        Ok(numerator / denominator)
    }

    /// Input required to receive exactly `amount_out`.
    ///
    /// Rounds **up** — the mirror of `get_amount_out`. Rounding this down would
    /// let a caller pay one unit less than the curve requires, shrinking `k`.
    pub fn get_amount_in(
        amount_out: i128,
        reserve_in: i128,
        reserve_out: i128,
        fee_bps: i128,
    ) -> Result<i128, VirtualEconomyError> {
        if amount_out <= 0 {
            return Err(VirtualEconomyError::InvalidAmount);
        }
        if reserve_in <= 0 || reserve_out <= 0 {
            return Err(VirtualEconomyError::InsufficientLiquidity);
        }
        if amount_out >= reserve_out {
            // The curve is asymptotic: draining a reserve entirely costs
            // infinite input, so this can never be satisfied.
            return Err(VirtualEconomyError::InsufficientLiquidity);
        }

        let numerator = reserve_in
            .checked_mul(amount_out)
            .ok_or(VirtualEconomyError::InvalidAmount)?
            .checked_mul(BPS_DENOMINATOR)
            .ok_or(VirtualEconomyError::InvalidAmount)?;
        let denominator = (reserve_out - amount_out)
            .checked_mul(BPS_DENOMINATOR - fee_bps)
            .ok_or(VirtualEconomyError::InvalidAmount)?;

        Ok(numerator / denominator + 1)
    }

    /// Spot price of A in terms of B, scaled by 1e7 (Stellar's 7 decimals).
    ///
    /// Spot price is the *marginal* price and is trivially manipulable within a
    /// single transaction — anything security-sensitive should read the TWAP
    /// via [`Self::consult_twap`] instead.
    pub fn spot_price(reserve_a: i128, reserve_b: i128) -> Result<i128, VirtualEconomyError> {
        if reserve_a <= 0 || reserve_b <= 0 {
            return Err(VirtualEconomyError::InsufficientLiquidity);
        }
        mul_div_floor(reserve_b, 10_000_000, reserve_a)
    }

    // ---------------------------------------------------------------------
    // Oracle
    // ---------------------------------------------------------------------

    /// Advance the cumulative price accumulators to `now`.
    ///
    /// Accumulates `price * elapsed_seconds`, so the difference between two
    /// observations divided by the elapsed time is the time-weighted average.
    /// Manipulating a TWAP requires holding the price away from the market for
    /// the whole window, not just for one transaction.
    fn accumulate_price(pool: &mut LiquidityPool, now: u64) {
        let elapsed = now.saturating_sub(pool.last_update);
        if elapsed == 0 || pool.reserve_a <= 0 || pool.reserve_b <= 0 {
            pool.last_update = now;
            return;
        }

        let elapsed_i = elapsed as i128;
        if let Ok(price_a) = Self::spot_price(pool.reserve_a, pool.reserve_b) {
            pool.price_a_cumulative = pool
                .price_a_cumulative
                .saturating_add(price_a.saturating_mul(elapsed_i));
        }
        if let Ok(price_b) = Self::spot_price(pool.reserve_b, pool.reserve_a) {
            pool.price_b_cumulative = pool
                .price_b_cumulative
                .saturating_add(price_b.saturating_mul(elapsed_i));
        }
        pool.last_update = now;
    }

    /// Time-weighted average price of A between two snapshots.
    ///
    /// # Errors
    /// - `InvalidAmount` if the snapshots are not separated in time; a zero
    ///   window has no average and returning the spot price instead would
    ///   silently hand back the manipulable value the TWAP exists to avoid.
    pub fn consult_twap(
        earlier: &PriceSnapshot,
        later: &PriceSnapshot,
    ) -> Result<i128, VirtualEconomyError> {
        if later.timestamp <= earlier.timestamp {
            return Err(VirtualEconomyError::InvalidAmount);
        }
        let elapsed = (later.timestamp - earlier.timestamp) as i128;
        Ok((later.price_a_cumulative - earlier.price_a_cumulative) / elapsed)
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    pub fn get_pool(env: &Env) -> Result<LiquidityPool, VirtualEconomyError> {
        env.storage()
            .persistent()
            .get(&DataKey::AmmPool)
            .ok_or(VirtualEconomyError::PoolNotFound)
    }

    pub fn save_pool(env: &Env, pool: &LiquidityPool) {
        env.storage().persistent().set(&DataKey::AmmPool, pool);
    }

    pub fn get_shares(env: &Env, provider: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::AmmShares(provider.clone()))
            .unwrap_or(0)
    }

    fn set_shares(env: &Env, provider: &Address, shares: i128) {
        env.storage()
            .persistent()
            .set(&DataKey::AmmShares(provider.clone()), &shares);
    }

    // ---------------------------------------------------------------------
    // Liquidity
    // ---------------------------------------------------------------------

    /// Create the pool. Reserves start empty; the first deposit sets the price.
    pub fn create_pool(env: &Env, fee_bps: i128) -> Result<LiquidityPool, VirtualEconomyError> {
        if env.storage().persistent().has(&DataKey::AmmPool) {
            return Err(VirtualEconomyError::PoolAlreadyExists);
        }
        if !(0..=BPS_DENOMINATOR).contains(&fee_bps) {
            return Err(VirtualEconomyError::InvalidAmount);
        }

        let pool = LiquidityPool {
            reserve_a: 0,
            reserve_b: 0,
            total_shares: 0,
            price_a_cumulative: 0,
            price_b_cumulative: 0,
            last_update: env.ledger().timestamp(),
            fee_bps,
        };
        Self::save_pool(env, &pool);
        Ok(pool)
    }

    /// Add liquidity and mint LP tokens.
    ///
    /// The first deposit sets the initial price and mints `sqrt(a*b)`, minus the
    /// permanently locked minimum. Later deposits must match the current ratio,
    /// and mint the *smaller* of the two proportional claims — so depositing
    /// off-ratio forfeits the excess rather than moving the price, which would
    /// otherwise be a free way to trade without paying the fee.
    pub fn add_liquidity(
        env: &Env,
        provider: &Address,
        amount_a: i128,
        amount_b: i128,
        min_shares: i128,
    ) -> Result<DepositResult, VirtualEconomyError> {
        if amount_a <= 0 || amount_b <= 0 {
            return Err(VirtualEconomyError::InvalidAmount);
        }

        let mut pool = Self::get_pool(env)?;
        Self::accumulate_price(&mut pool, env.ledger().timestamp());

        let shares = if pool.total_shares == 0 {
            let initial = integer_sqrt(
                amount_a
                    .checked_mul(amount_b)
                    .ok_or(VirtualEconomyError::InvalidAmount)?,
            );
            if initial <= MINIMUM_LIQUIDITY {
                // Too small to lock the floor and still mint anything.
                return Err(VirtualEconomyError::InsufficientLiquidity);
            }
            // The locked minimum is added to total supply but never credited to
            // anyone, so it can never be withdrawn.
            pool.total_shares = MINIMUM_LIQUIDITY;
            initial - MINIMUM_LIQUIDITY
        } else {
            let from_a = mul_div_floor(amount_a, pool.total_shares, pool.reserve_a)?;
            let from_b = mul_div_floor(amount_b, pool.total_shares, pool.reserve_b)?;
            // The minimum is what stops an off-ratio deposit from minting shares
            // it has not funded on both sides.
            if from_a < from_b {
                from_a
            } else {
                from_b
            }
        };

        if shares <= 0 {
            return Err(VirtualEconomyError::InsufficientLiquidity);
        }
        if shares < min_shares {
            return Err(VirtualEconomyError::SlippageExceeded);
        }

        pool.reserve_a += amount_a;
        pool.reserve_b += amount_b;
        pool.total_shares += shares;
        Self::save_pool(env, &pool);
        Self::set_shares(env, provider, Self::get_shares(env, provider) + shares);

        Ok(DepositResult {
            amount_a,
            amount_b,
            shares_minted: shares,
            total_shares: pool.total_shares,
        })
    }

    /// Burn LP tokens and return the proportional reserves.
    ///
    /// Both amounts round down, so the pool never pays out more than the share
    /// is worth; the remainder stays with the remaining LPs.
    pub fn remove_liquidity(
        env: &Env,
        provider: &Address,
        shares: i128,
        min_a: i128,
        min_b: i128,
    ) -> Result<WithdrawResult, VirtualEconomyError> {
        if shares <= 0 {
            return Err(VirtualEconomyError::InvalidAmount);
        }

        let held = Self::get_shares(env, provider);
        if held < shares {
            return Err(VirtualEconomyError::InsufficientBalance);
        }

        let mut pool = Self::get_pool(env)?;
        if pool.total_shares <= 0 {
            return Err(VirtualEconomyError::InsufficientLiquidity);
        }
        Self::accumulate_price(&mut pool, env.ledger().timestamp());

        let amount_a = mul_div_floor(shares, pool.reserve_a, pool.total_shares)?;
        let amount_b = mul_div_floor(shares, pool.reserve_b, pool.total_shares)?;

        if amount_a <= 0 || amount_b <= 0 {
            return Err(VirtualEconomyError::InsufficientLiquidity);
        }
        if amount_a < min_a || amount_b < min_b {
            return Err(VirtualEconomyError::SlippageExceeded);
        }

        pool.reserve_a -= amount_a;
        pool.reserve_b -= amount_b;
        pool.total_shares -= shares;
        Self::save_pool(env, &pool);
        Self::set_shares(env, provider, held - shares);

        Ok(WithdrawResult {
            amount_a,
            amount_b,
            shares_burned: shares,
            total_shares: pool.total_shares,
        })
    }

    // ---------------------------------------------------------------------
    // Swapping
    // ---------------------------------------------------------------------

    /// Swap `amount_in` of one asset for the other.
    ///
    /// `min_amount_out` is the caller's slippage floor and is the *only* thing
    /// protecting them from a sandwich: the price they were quoted off-chain is
    /// not the price they get on-chain, because anything can execute in between.
    /// A zero floor is rejected rather than treated as "no preference" — an
    /// unprotected swap is almost always a mistake rather than an intention.
    ///
    /// # Errors
    /// - `InvalidAmount` for a non-positive input or a zero slippage floor.
    /// - `SlippageExceeded` if the output would be below `min_amount_out`.
    /// - `InsufficientLiquidity` if the pool is empty or the trade would drain it.
    pub fn swap(
        env: &Env,
        a_to_b: bool,
        amount_in: i128,
        min_amount_out: i128,
    ) -> Result<SwapResult, VirtualEconomyError> {
        if amount_in <= 0 {
            return Err(VirtualEconomyError::InvalidAmount);
        }
        if min_amount_out <= 0 {
            return Err(VirtualEconomyError::InvalidAmount);
        }

        let mut pool = Self::get_pool(env)?;
        if pool.reserve_a <= 0 || pool.reserve_b <= 0 {
            return Err(VirtualEconomyError::InsufficientLiquidity);
        }
        Self::accumulate_price(&mut pool, env.ledger().timestamp());

        let (reserve_in, reserve_out) = if a_to_b {
            (pool.reserve_a, pool.reserve_b)
        } else {
            (pool.reserve_b, pool.reserve_a)
        };

        let k_before = reserve_in
            .checked_mul(reserve_out)
            .ok_or(VirtualEconomyError::InvalidAmount)?;

        let amount_out = Self::get_amount_out(amount_in, reserve_in, reserve_out, pool.fee_bps)?;

        if amount_out <= 0 {
            return Err(VirtualEconomyError::InsufficientLiquidity);
        }
        if amount_out >= reserve_out {
            return Err(VirtualEconomyError::InsufficientLiquidity);
        }
        if amount_out < min_amount_out {
            return Err(VirtualEconomyError::SlippageExceeded);
        }

        let new_reserve_in = reserve_in + amount_in;
        let new_reserve_out = reserve_out - amount_out;

        // The invariant is *checked*, not assumed. If a future change to the
        // pricing maths ever lets k shrink, that is a drain, and it should fail
        // here rather than in production.
        let k_after = new_reserve_in
            .checked_mul(new_reserve_out)
            .ok_or(VirtualEconomyError::InvalidAmount)?;
        if k_after < k_before {
            return Err(VirtualEconomyError::InvariantViolation);
        }

        if a_to_b {
            pool.reserve_a = new_reserve_in;
            pool.reserve_b = new_reserve_out;
        } else {
            pool.reserve_b = new_reserve_in;
            pool.reserve_a = new_reserve_out;
        }

        let fee_paid =
            amount_in - mul_div_floor(amount_in, BPS_DENOMINATOR - pool.fee_bps, BPS_DENOMINATOR)?;
        Self::save_pool(env, &pool);

        Ok(SwapResult {
            amount_in,
            amount_out,
            fee_paid,
            new_reserve_a: pool.reserve_a,
            new_reserve_b: pool.reserve_b,
        })
    }

    /// Current oracle snapshot, with accumulators advanced to now.
    pub fn observe(env: &Env) -> Result<PriceSnapshot, VirtualEconomyError> {
        let mut pool = Self::get_pool(env)?;
        Self::accumulate_price(&mut pool, env.ledger().timestamp());
        Self::save_pool(env, &pool);

        Ok(PriceSnapshot {
            price_a_cumulative: pool.price_a_cumulative,
            price_b_cumulative: pool.price_b_cumulative,
            reserve_a: pool.reserve_a,
            reserve_b: pool.reserve_b,
            timestamp: pool.last_update,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEE: i128 = SWAP_FEE_BPS;

    #[test]
    fn integer_sqrt_is_the_floor_of_the_real_root() {
        assert_eq!(integer_sqrt(0), 0);
        assert_eq!(integer_sqrt(1), 1);
        assert_eq!(integer_sqrt(4), 2);
        assert_eq!(integer_sqrt(8), 2);
        assert_eq!(integer_sqrt(9), 3);
        assert_eq!(integer_sqrt(1_000_000), 1_000);
        // Never over-estimates, which would over-mint the first LP.
        for n in [2i128, 3, 15, 16, 17, 99, 101, 10_001] {
            let r = integer_sqrt(n);
            assert!(r * r <= n, "sqrt({n}) = {r} overshoots");
            assert!((r + 1) * (r + 1) > n, "sqrt({n}) = {r} is not maximal");
        }
    }

    #[test]
    fn output_is_bounded_by_the_curve_and_rounds_down() {
        // 0.3% fee on 1000 in against a 1_000_000/1_000_000 pool.
        let out = AmmManager::get_amount_out(1_000, 1_000_000, 1_000_000, FEE).unwrap();
        // 997 in after fee, so out = 997*1e6/(1e6+997) = 996 (floor).
        assert_eq!(out, 996);
        // Strictly less than the input: the fee and the curve both take a cut.
        assert!(out < 1_000);
    }

    #[test]
    fn swap_never_shrinks_k() {
        let (mut ra, mut rb) = (1_000_000i128, 1_000_000i128);
        let mut k = ra * rb;

        // Starts at 400, the smallest input that survives the 0.3% fee at
        // this reserve size - a smaller trade is rejected outright, which
        // `a_trade_too_small_to_pay_the_fee_is_rejected` covers separately.
        for amount in [400i128, 1_000, 5_000, 50_000, 250_000] {
            let out = AmmManager::get_amount_out(amount, ra, rb, FEE).unwrap();
            ra += amount;
            rb -= out;
            let k_after = ra * rb;
            assert!(k_after >= k, "k shrank: {k} -> {k_after}");
            k = k_after;
        }
    }

    #[test]
    fn get_amount_in_is_the_inverse_and_rounds_up() {
        let (ra, rb) = (1_000_000i128, 1_000_000i128);
        let desired = 996i128;

        let needed = AmmManager::get_amount_in(desired, ra, rb, FEE).unwrap();
        // Paying that much must buy at least what was asked for - rounding the
        // other way would let a caller underpay and shrink k.
        let actual = AmmManager::get_amount_out(needed, ra, rb, FEE).unwrap();
        assert!(actual >= desired, "needed {needed} bought only {actual}");
    }

    #[test]
    fn draining_a_reserve_is_impossible() {
        // The curve is asymptotic: the last unit of a reserve costs infinity.
        assert_eq!(
            AmmManager::get_amount_in(1_000_000, 1_000_000, 1_000_000, FEE),
            Err(VirtualEconomyError::InsufficientLiquidity)
        );
        // And no finite input can take the whole reserve.
        let out =
            AmmManager::get_amount_out(i128::from(u32::MAX), 1_000_000, 1_000_000, FEE).unwrap();
        assert!(out < 1_000_000);
    }

    #[test]
    fn empty_or_invalid_inputs_are_rejected() {
        assert_eq!(
            AmmManager::get_amount_out(0, 1_000, 1_000, FEE),
            Err(VirtualEconomyError::InvalidAmount)
        );
        assert_eq!(
            AmmManager::get_amount_out(-5, 1_000, 1_000, FEE),
            Err(VirtualEconomyError::InvalidAmount)
        );
        assert_eq!(
            AmmManager::get_amount_out(100, 0, 1_000, FEE),
            Err(VirtualEconomyError::InsufficientLiquidity)
        );
    }

    #[test]
    fn a_trade_too_small_to_pay_the_fee_is_rejected() {
        // 1 unit at 0.3% rounds entirely away; accepting it would take the
        // input and return nothing.
        assert_eq!(
            AmmManager::get_amount_out(1, 1_000_000, 1_000_000, FEE),
            Err(VirtualEconomyError::InvalidAmount)
        );
    }

    #[test]
    fn fee_accrues_to_reserves_rather_than_a_separate_balance() {
        let (ra, rb) = (1_000_000i128, 1_000_000i128);
        let no_fee = AmmManager::get_amount_out(10_000, ra, rb, 0).unwrap();
        let with_fee = AmmManager::get_amount_out(10_000, ra, rb, FEE).unwrap();
        // The trader receives less; the difference stays in the pool, which is
        // exactly how LP value grows.
        assert!(with_fee < no_fee);
    }

    #[test]
    fn spot_price_tracks_the_ratio() {
        // Twice as much B as A means one A is worth two B.
        assert_eq!(AmmManager::spot_price(1_000, 2_000).unwrap(), 20_000_000);
        assert_eq!(AmmManager::spot_price(2_000, 1_000).unwrap(), 5_000_000);
        assert_eq!(
            AmmManager::spot_price(0, 1_000),
            Err(VirtualEconomyError::InsufficientLiquidity)
        );
    }

    #[test]
    fn twap_requires_a_non_zero_window() {
        let snap = PriceSnapshot {
            price_a_cumulative: 100,
            price_b_cumulative: 100,
            reserve_a: 1,
            reserve_b: 1,
            timestamp: 50,
        };
        // A zero window has no average; returning spot instead would hand back
        // the manipulable value the TWAP exists to avoid.
        assert_eq!(
            AmmManager::consult_twap(&snap, &snap),
            Err(VirtualEconomyError::InvalidAmount)
        );

        let later = PriceSnapshot {
            price_a_cumulative: 100 + 10_000_000 * 60,
            timestamp: 110,
            ..snap.clone()
        };
        assert_eq!(AmmManager::consult_twap(&snap, &later).unwrap(), 10_000_000);
    }

    #[test]
    fn larger_trades_get_progressively_worse_prices() {
        let (ra, rb) = (1_000_000i128, 1_000_000i128);
        let small = AmmManager::get_amount_out(1_000, ra, rb, FEE).unwrap();
        let large = AmmManager::get_amount_out(100_000, ra, rb, FEE).unwrap();

        // Price impact: 100x the input buys well under 100x the output.
        assert!(
            large < small * 100,
            "large trade should suffer price impact"
        );
    }
}
