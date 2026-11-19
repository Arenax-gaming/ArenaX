//! Emergency override configuration for the time-lock contract (Issue #1554).
//!
//! All time-locked operations historically used the same delay before they
//! could be executed. Critical emergency operations (e.g. pausing the
//! protocol after an exploit) need a much shorter path to execution while
//! still being fully auditable and governed.

use soroban_sdk::{contracttype, Address, BytesN};

/// Reduced delay (in seconds) that an `EMERGENCY_ROLE` holder may use to
/// execute a scheduled operation, instead of waiting for the operation's
/// full standard delay to elapse.
pub const EMERGENCY_DELAY_SECONDS: u64 = 3_600; // 1 hour

/// Standard delay (in seconds) that applies to all non-emergency roles.
/// Deployments are expected to configure `min_delay` (via `initialize` /
/// `update_min_delay`) to at least this value; kept here as a documented
/// reference constant for the standard path.
pub const STANDARD_DELAY_SECONDS: u64 = 172_800; // 48 hours

/// A single audit record of an emergency-override execution. Appended to the
/// on-chain emergency override log every time the reduced-delay path is
/// taken, so every use remains auditable in contract state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmergencyOverrideRecord {
    pub operation_id: BytesN<32>,
    pub executor: Address,
    pub used_at: u64,
}
