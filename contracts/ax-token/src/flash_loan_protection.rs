// Flash loan protection utilities for AxToken
// FLASH_LOAN_PROTECTED functions check this before executing
#![allow(dead_code)]
use soroban_sdk::{Address, Env};
use crate::DataKey;

/// Identifies the category of a protected operation for audit/logging purposes.
pub enum ProtectedOperation {
    OracleUpdate,
    Governance,
    Transfer,
    Burn,
}

/// Stateless guard that uses Soroban temporary storage to detect same-sequence
/// (i.e. same-transaction) re-use of sensitive operations — the mechanism by
/// which flash-loan attacks occur on Stellar/Soroban.
pub struct FlashLoanGuard;

impl FlashLoanGuard {
    /// Check if the address has performed an operation in the current ledger sequence.
    /// Returns true if a flash loan is detected (same sequence).
    pub fn is_flash_loan_attempt(env: &Env, addr: &Address) -> bool {
        let current_seq = env.ledger().sequence();
        let last_seq: u32 = env
            .storage()
            .temporary()
            .get(&DataKey::LastOpSequence(addr.clone()))
            .unwrap_or(0);
        last_seq == current_seq
    }

    /// Record that this address performed a protected operation this sequence.
    pub fn record_operation(env: &Env, addr: &Address) {
        let current_seq = env.ledger().sequence();
        // Store with short TTL (10 ledgers is enough)
        env.storage()
            .temporary()
            .set(&DataKey::LastOpSequence(addr.clone()), &current_seq);
    }

    /// Check global sequence for oracle/price-sensitive operations.
    /// Returns true if a global protected operation already occurred this sequence.
    pub fn check_global_sequence(env: &Env) -> bool {
        let current_seq = env.ledger().sequence();
        let last_seq: u32 = env
            .storage()
            .temporary()
            .get(&DataKey::GlobalLastSequence)
            .unwrap_or(0);
        last_seq == current_seq
    }

    /// Record a global price-sensitive operation.
    pub fn record_global_operation(env: &Env) {
        let current_seq = env.ledger().sequence();
        env.storage()
            .temporary()
            .set(&DataKey::GlobalLastSequence, &current_seq);
    }

    /// Convenience: check and immediately record a per-address protected operation.
    /// Returns true when a flash loan is detected; the caller should panic.
    pub fn check_and_set_sequence(env: &Env, addr: &Address) -> bool {
        if Self::is_flash_loan_attempt(env, addr) {
            return true;
        }
        Self::record_operation(env, addr);
        false
    }

    /// Returns true when the stored sequence for `addr` equals `current_seq`.
    pub fn is_same_sequence(env: &Env, addr: &Address) -> bool {
        Self::is_flash_loan_attempt(env, addr)
    }

    /// Clear the per-address sequence record (e.g. after a successful multi-step flow).
    pub fn clear_sequence(env: &Env, addr: &Address) {
        env.storage()
            .temporary()
            .remove(&DataKey::LastOpSequence(addr.clone()));
    }
}
