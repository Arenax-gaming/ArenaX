//! Oracle result expiry (#1556)
//!
//! Anti-cheat oracle results (`AntiCheatConfirmation`) previously carried no
//! expiry, so a stale result from a past season could be replayed to falsely
//! flag a player. Every result now carries a `valid_until` *ledger sequence*
//! — not a wall-clock timestamp, so expiry is judged against Soroban's
//! consensus clock rather than any client-supplied time.
//!
//! Expiry is enforced at two points:
//! - **Submission** (`AntiCheatOracle::submit_flag`): a `valid_until` already
//!   in the past is rejected with `InvalidValidUntil` before anything is
//!   written to storage.
//! - **Consumption** (`AntiCheatOracle::get_confirmation`): once the current
//!   ledger sequence has passed the stored `valid_until`, the result can no
//!   longer be read back — the call emits `result_expired` and returns
//!   `ResultExpired` instead of the stale data.
//!
//! An oracle can extend a result's validity simply by resubmitting
//! `submit_flag` for the same `(player, match_id)` with a later
//! `valid_until`; `submit_flag` always overwrites the existing record.

use soroban_sdk::Env;

use crate::error::AntiCheatError;

/// True once the current ledger sequence has passed `valid_until`, i.e. the
/// result is no longer valid and must not be consumed.
pub fn is_expired(env: &Env, valid_until: u32) -> bool {
    env.ledger().sequence() > valid_until
}

/// Validates a `valid_until` supplied at submission time: it must not
/// already be in the past relative to the current ledger sequence.
pub fn validate_valid_until(env: &Env, valid_until: u32) -> Result<(), AntiCheatError> {
    if valid_until < env.ledger().sequence() {
        return Err(AntiCheatError::InvalidValidUntil);
    }
    Ok(())
}
