// Price oracle integration for the ArenaX virtual economy.
//
// Architecture:
//   - A **primary** oracle (Chainlink-style on-chain price feed) is queried
//     first on every price update.
//   - A **fallback** oracle is used when the primary is stale or reports a
//     price outside the acceptable variance window.
//   - Every accepted price is appended to an on-chain ring-buffer of
//     `MAX_HISTORY` entries for historical queries.
//   - The minimum seconds that must pass before a new push is accepted is
//     configurable per asset pair (update frequency).
//
// All pure computation lives here; storage mutations happen through the keys
// exported from `storage.rs`.

use crate::error::VirtualEconomyError;
use crate::storage::{OracleConfig, OraclePriceEntry, PriceHistory};
use soroban_sdk::Address;

/// Maximum variance (in basis points) allowed between two oracle reads before
/// the fallback is preferred.  10 000 bp = 100 %.
pub const MAX_VARIANCE_BPS: u32 = 10_000;

/// Hard cap on stored history entries (ring-buffer size).
pub const MAX_HISTORY: u32 = 100;

pub struct OracleManager;

impl OracleManager {
    // -------------------------------------------------------------------------
    // Configuration helpers
    // -------------------------------------------------------------------------

    /// Return `true` when the given update interval has elapsed since
    /// `last_updated`.
    pub fn is_update_due(now: u64, last_updated: u64, update_interval: u64) -> bool {
        now >= last_updated.saturating_add(update_interval)
    }

    /// Validate an [`OracleConfig`] before it is persisted.
    ///
    /// Rules:
    /// - `update_interval` must be ≥ 1 second (prevents spam).
    /// - `max_variance_bps` must be in `(0, MAX_VARIANCE_BPS]`.
    /// - `history_size` must be in `[1, MAX_HISTORY]`.
    pub fn validate_config(config: &OracleConfig) -> Result<(), VirtualEconomyError> {
        if config.update_interval == 0 {
            return Err(VirtualEconomyError::InvalidOracleConfig);
        }
        if config.max_variance_bps == 0 || config.max_variance_bps > MAX_VARIANCE_BPS {
            return Err(VirtualEconomyError::InvalidOracleConfig);
        }
        if config.history_size == 0 || config.history_size > MAX_HISTORY {
            return Err(VirtualEconomyError::InvalidOracleConfig);
        }
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Variance / staleness checks
    // -------------------------------------------------------------------------

    /// Compute the absolute variance between `new_price` and `reference` in
    /// basis points.  Returns `0` when `reference == 0` (no prior price).
    ///
    /// `variance_bps = |new - ref| * 10_000 / ref`
    pub fn price_variance_bps(new_price: i128, reference: i128) -> u32 {
        if reference <= 0 || new_price <= 0 {
            return 0;
        }
        let diff = if new_price > reference {
            new_price - reference
        } else {
            reference - new_price
        };
        // Cap at u32::MAX to avoid overflow in pathological inputs.
        ((diff * 10_000) / reference).min(u32::MAX as i128) as u32
    }

    /// Return `true` when `price` is within the allowed variance window
    /// relative to the last accepted price.  Always `true` when there is no
    /// prior price.
    pub fn is_within_variance(
        new_price: i128,
        last_price: i128,
        max_variance_bps: u32,
    ) -> bool {
        if last_price <= 0 {
            return true; // no reference — accept any non-negative price
        }
        Self::price_variance_bps(new_price, last_price) <= max_variance_bps
    }

    /// Return `true` when `timestamp` is not older than `max_age_secs` from
    /// `now`.
    pub fn is_fresh(now: u64, timestamp: u64, max_age_secs: u64) -> bool {
        now.saturating_sub(timestamp) <= max_age_secs
    }

    // -------------------------------------------------------------------------
    // Price resolution (primary → fallback)
    // -------------------------------------------------------------------------

    /// Determine which oracle price to accept for a given asset pair.
    ///
    /// Decision logic:
    /// 1. Reject any price ≤ 0.
    /// 2. If the primary price is fresh and within the variance window, use it.
    /// 3. Otherwise fall back to the fallback oracle price (if configured and
    ///    it passes freshness + variance).
    /// 4. If neither passes, return `OraclePriceStale`.
    ///
    /// Returns the accepted price together with whether the fallback was used.
    pub fn resolve_price(
        primary_price: i128,
        primary_timestamp: u64,
        fallback_price: Option<i128>,
        fallback_timestamp: Option<u64>,
        last_accepted_price: i128,
        config: &OracleConfig,
        now: u64,
    ) -> Result<(i128, bool), VirtualEconomyError> {
        let max_age = config.update_interval.saturating_mul(3); // 3 × update interval = stale

        let primary_ok = primary_price > 0
            && Self::is_fresh(now, primary_timestamp, max_age)
            && Self::is_within_variance(primary_price, last_accepted_price, config.max_variance_bps);

        if primary_ok {
            return Ok((primary_price, false));
        }

        // Try fallback
        if let (Some(fb_price), Some(fb_ts)) = (fallback_price, fallback_timestamp) {
            let fallback_ok = fb_price > 0
                && Self::is_fresh(now, fb_ts, max_age)
                && Self::is_within_variance(fb_price, last_accepted_price, config.max_variance_bps);

            if fallback_ok {
                return Ok((fb_price, true));
            }
        }

        Err(VirtualEconomyError::OraclePriceStale)
    }

    // -------------------------------------------------------------------------
    // History management
    // -------------------------------------------------------------------------

    /// Append a new price entry to the ring-buffer, respecting `history_size`.
    /// Oldest entries are dropped when the buffer is full.
    pub fn append_history(
        history: &mut PriceHistory,
        price: i128,
        timestamp: u64,
        source: Address,
        is_fallback: bool,
        history_size: u32,
    ) {
        let entry = OraclePriceEntry {
            price,
            timestamp,
            source,
            is_fallback,
        };

        // Ring-buffer eviction: remove oldest when full.
        let cap = history_size.min(MAX_HISTORY) as usize;
        while history.entries.len() >= cap as u32 {
            history.entries.pop_front();
        }

        history.entries.push_back(entry);
        history.last_price = price;
        history.last_updated = timestamp;
        history.update_count = history.update_count.saturating_add(1);
    }

    /// Compute the time-weighted average price (TWAP) over the stored history.
    ///
    /// Each entry is weighted by the seconds it was "valid" (the gap to the
    /// next entry, or a `default_interval` for the most recent one).
    /// Returns the simple average when there is only one entry.
    pub fn calculate_twap(history: &PriceHistory, default_interval: u64) -> i128 {
        let n = history.entries.len();
        if n == 0 {
            return 0;
        }
        if n == 1 {
            return history.entries.get(0).map(|e| e.price).unwrap_or(0);
        }

        let mut weighted_sum: i128 = 0;
        let mut total_weight: i128 = 0;

        for i in 0..n {
            let entry = match history.entries.get(i) {
                Some(e) => e,
                None => continue,
            };
            let weight = if i + 1 < n {
                let next = history.entries.get(i + 1).unwrap();
                (next.timestamp.saturating_sub(entry.timestamp)) as i128
            } else {
                default_interval as i128
            };

            let w = weight.max(1);
            weighted_sum = weighted_sum.saturating_add(entry.price.saturating_mul(w));
            total_weight = total_weight.saturating_add(w);
        }

        if total_weight == 0 {
            return history.last_price;
        }
        weighted_sum / total_weight
    }

    /// Return the lowest and highest price in the stored history as
    /// `(min, max)`.  Returns `(0, 0)` for an empty history.
    pub fn price_range(history: &PriceHistory) -> (i128, i128) {
        let n = history.entries.len();
        if n == 0 {
            return (0, 0);
        }

        let first = history.entries.get(0).map(|e| e.price).unwrap_or(0);
        let mut min_price = first;
        let mut max_price = first;

        for i in 1..n {
            if let Some(entry) = history.entries.get(i) {
                if entry.price < min_price {
                    min_price = entry.price;
                }
                if entry.price > max_price {
                    max_price = entry.price;
                }
            }
        }
        (min_price, max_price)
    }

    /// Derive the ledger-time maximum age for a freshness check from the
    /// configured `update_interval`.
    ///
    /// An entry that arrived within `update_interval * stale_multiplier`
    /// seconds is considered fresh.
    pub fn max_staleness(update_interval: u64, stale_multiplier: u64) -> u64 {
        update_interval.saturating_mul(stale_multiplier)
    }
}
