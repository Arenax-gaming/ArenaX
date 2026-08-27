// Gas-optimized batch processing for currency operations.
//
// Design notes (see docs/BATCH_GAS_BENCHMARKS.md for measured figures):
// The single-item entry points (`mint_currency`, `transfer_currency`,
// `burn_currency`) each perform their own read-modify-write of
// `TotalCurrencySupply` and `EconomyAnalytics`. Calling them N times to
// process N items therefore pays for 2*N redundant instance-storage
// read/write round trips on state that is only ever needed once per
// transaction. The batch entry points here instead:
//   - validate the whole batch up front (fail closed before any writes),
//   - read `TotalCurrencySupply` / `EconomyAnalytics` exactly once,
//   - accumulate the aggregate delta in memory across the batch,
//   - write the aggregate state back exactly once.
// Per-recipient balances still require one read + one write each since
// there is no way to avoid touching distinct storage keys, but the
// aggregate bookkeeping collapses from O(N) storage ops to O(1).

use crate::error::VirtualEconomyError;
use soroban_sdk::{contracttype, Address, Vec};

/// Hard ceiling on items per batch call. Bounds both the gas cost of a
/// single invocation and the size of the in-memory accumulation, so a
/// batch can never grow large enough to blow the ledger's resource limits
/// or make a single transaction economically/spam-attack viable.
pub const MAX_BATCH_SIZE: u32 = 50;

pub struct BatchManager;

impl BatchManager {
    /// Validate batch size and that parallel arrays are the same length.
    pub fn validate_batch_size(len: u32) -> Result<(), VirtualEconomyError> {
        if len == 0 {
            return Err(VirtualEconomyError::InvalidAmount);
        }
        if len > MAX_BATCH_SIZE {
            return Err(VirtualEconomyError::InvalidAmount);
        }
        Ok(())
    }

    pub fn validate_matching_lengths(a: u32, b: u32) -> Result<(), VirtualEconomyError> {
        if a != b {
            return Err(VirtualEconomyError::InvalidConfig);
        }
        Ok(())
    }

    /// Sum a batch of amounts, rejecting any non-positive entry up front so
    /// the whole batch fails atomically instead of partially applying.
    pub fn sum_positive(amounts: &Vec<i128>) -> Result<i128, VirtualEconomyError> {
        let mut total: i128 = 0;
        for amount in amounts.iter() {
            if amount <= 0 {
                return Err(VirtualEconomyError::InvalidAmount);
            }
            total += amount;
        }
        Ok(total)
    }
}

/// One transfer leg within a `batch_transfer_currency` call.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchTransferItem {
    pub to: Address,
    pub amount: i128,
}

/// Aggregate result returned by every batch entry point so callers get a
/// single, cheap read of what happened instead of parsing per-item events.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchResult {
    pub items_processed: u32,
    pub total_amount: i128,
}
