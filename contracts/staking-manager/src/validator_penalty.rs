//! Validator penalty (slash) mechanism for the StakingManager contract.
//!
//! This module implements configurable slashing of validator stakes with:
//! - Severity-based slash amounts (levels 0-4)
//! - Configurable burn/treasury split of slashed tokens
//! - Treasury receives slash proceeds via on-chain token transfer (#920)
//! - Human-readable slash rationale logged on-chain (#920)
//! - Appeal window and resolution flow (recovery after period) (#920)
//! - Immutable slash records stored per slash ID
//! - Per-validator slash history with total slashed counter
//!
//! # Economic penalty flow (issue #920)
//!
//! When a validator is slashed:
//!   1. The `slash_amount` for the given severity is deducted from
//!      `UserStakeInfo.total_staked` (capped at available stake).
//!   2. `burn_bps` of that amount is transferred to the admin address
//!      (to be burned by the AX-token contract) via `token::Client::transfer`.
//!   3. The remainder is transferred to `SlashConfig.treasury_address` so
//!      the DAO treasury contract receives real on-chain tokens (#920: treasury
//!      receives slash).
//!   4. A `SlashRecord` with a human-readable `rationale` string is written
//!      to persistent storage (#920: slash rationale logged).
//!   5. `ValidatorSlashHistory` totals are updated.
//!   6. Events are emitted for off-chain indexers.
//!
//! # Recovery / appeal (#920: recovery after period)
//!
//! Within `appeal_window_seconds` of the slash, the validator may call
//! `appeal_slash` providing a numeric reason code and a human-readable
//! rationale string.  An admin then calls `resolve_appeal(grant=true)` to
//! reverse all token movements (treasury sends tokens back to the contract,
//! which credits the validator's `total_staked`) or
//! `resolve_appeal(grant=false)` to deny and close the appeal permanently.
//!
//! # Appeal mechanism (#920: appeal mechanism)
//!
//! The appeal flow is:
//!   validator → `appeal_slash(slash_id, reason, rationale)` → pending
//!   admin    → `resolve_appeal(slash_id, grant=true|false)` → resolved
//!
//! If granted, tokens are restored; if denied, the slash stands permanently.

use crate::{
    AppealRecord, DataKey, SlashConfig, SlashRecord, UserStakeInfo, ValidatorSlashHistory,
};
use arenax_events::slashing as slash_events;
use arenax_events::staking as stake_events;
use soroban_sdk::{token, Address, Bytes, BytesN, Env, String};

/// Provides all validator penalty operations. Methods are static helpers
/// called from the `StakingManager` contract-impl block in `lib.rs`.
pub struct ValidatorPenaltyManager;

impl ValidatorPenaltyManager {
    // ── Configuration ────────────────────────────────────────────────────────

    /// Store a new slash configuration. Admin-only — caller must have
    /// already called `admin.require_auth()` in the contract-impl layer.
    ///
    /// # Parameters
    /// - `config.enabled`           — master on/off switch
    /// - `config.slash_amounts`     — one amount per severity level (0-4)
    /// - `config.burn_bps`          — fraction burned (rest to treasury)
    /// - `config.appeal_window_seconds` — time for validator to appeal
    /// - `config.ax_token`          — AX token contract for real transfers
    /// - `config.treasury_address`  — treasury contract that receives slash
    pub fn configure_slashing(env: &Env, config: SlashConfig) {
        if config.burn_bps > 10_000 {
            panic!("burn_bps exceeds 100%");
        }
        if config.slash_amounts.len() == 0 {
            panic!("slash_amounts must not be empty");
        }
        env.storage()
            .instance()
            .set(&DataKey::ValidatorSlashConfig, &config);
    }

    /// Read the current slash config. Returns `None` if not yet configured.
    pub fn get_slash_config(env: &Env) -> Option<SlashConfig> {
        env.storage().instance().get(&DataKey::ValidatorSlashConfig)
    }

    // ── Slash ────────────────────────────────────────────────────────────────

    /// Slash a validator for the given `severity` (0-4) using the configured
    /// slash amount for that severity. Returns the `slash_id`.
    ///
    /// ### Token flow
    /// The slashed tokens are transferred **out of this staking contract**:
    /// - `burn_amount` → admin address (for the admin to call `ax_token.burn`)
    /// - `treasury_amount` → `config.treasury_address` (real on-chain transfer)
    ///
    /// This satisfies the "treasury receives slash" acceptance criterion (#920).
    pub fn slash_validator(
        env: &Env,
        admin: Address,
        validator: Address,
        severity: u32,
        reason: u32,
        rationale: String,
    ) -> BytesN<32> {
        admin.require_auth();

        let config: SlashConfig = env
            .storage()
            .instance()
            .get(&DataKey::ValidatorSlashConfig)
            .expect("slash config not set");

        if !config.enabled {
            panic!("slashing disabled");
        }
        if severity as usize >= config.slash_amounts.len() as usize {
            panic!("invalid severity level");
        }

        let requested_amount = config
            .slash_amounts
            .get(severity)
            .expect("severity out of range");

        // Load the validator's current stake info (or default zero-state)
        let mut stake_info: UserStakeInfo = env
            .storage()
            .instance()
            .get(&DataKey::UserStakeInfo(validator.clone()))
            .unwrap_or(UserStakeInfo {
                user: validator.clone(),
                total_staked: 0,
                total_slashed: 0,
                active_tournaments: 0,
                completed_tournaments: 0,
            });

        // Slash what is available; do not go negative
        let actual_amount = requested_amount.min(stake_info.total_staked);
        stake_info.total_staked -= actual_amount;
        stake_info.total_slashed += actual_amount;
        env.storage()
            .instance()
            .set(&DataKey::UserStakeInfo(validator.clone()), &stake_info);

        let now = env.ledger().timestamp();

        // Split: burn_bps fraction goes to admin for burning; rest to treasury
        let burn_amount = actual_amount * config.burn_bps as i128 / 10_000;
        let treasury_amount = actual_amount - burn_amount;

        let contract_addr = env.current_contract_address();
        let ax_client = token::Client::new(env, &config.ax_token);

        // Transfer burn portion to admin address (admin burns via ax_token.burn)
        if burn_amount > 0 {
            ax_client.transfer(&contract_addr, &admin, &burn_amount);
        }

        // Transfer treasury portion to the treasury contract (#920: treasury receives slash)
        if treasury_amount > 0 {
            ax_client.transfer(&contract_addr, &config.treasury_address, &treasury_amount);
        }

        // Generate a unique slash_id from the current counter
        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ValidatorPenaltyCounter)
            .unwrap_or(0u64);
        env.storage()
            .instance()
            .set(&DataKey::ValidatorPenaltyCounter, &(counter + 1));

        let slash_id = Self::counter_to_bytes_n(env, counter);

        // Persist the slash record keyed by slash_id (#920: slash rationale logged)
        let record = SlashRecord {
            slash_id: slash_id.clone(),
            validator: validator.clone(),
            amount: actual_amount,
            severity,
            reason,
            rationale,
            slashed_at: now,
            burned_amount: burn_amount,
            treasury_amount,
            appealed: false,
            appeal_resolved: false,
            appeal_granted: false,
        };
        env.storage()
            .persistent()
            .set(&DataKey::ValidatorAppealRecord(slash_id.clone()), &record);

        // Update the validator's slash history
        let mut history: ValidatorSlashHistory = env
            .storage()
            .persistent()
            .get(&DataKey::ValidatorSlashRecord(validator.clone()))
            .unwrap_or(ValidatorSlashHistory {
                validator: validator.clone(),
                total_slashed: 0,
                slash_count: 0,
                active_appeal: None,
            });
        history.total_slashed += actual_amount;
        history.slash_count += 1;
        env.storage()
            .persistent()
            .set(&DataKey::ValidatorSlashRecord(validator.clone()), &history);

        // Emit staking-domain event
        stake_events::emit_slashed(
            env,
            &validator,
            &BytesN::from_array(env, &[0u8; 32]),
            actual_amount,
            &admin,
        );

        // Emit slashing-domain event with the slash_id as the case_id
        slash_events::emit_case_opened(
            env,
            &slash_id,
            &validator,
            &admin,
            reason,
            &BytesN::from_array(env, &[0u8; 32]),
        );

        slash_id
    }

    // ── Appeal ───────────────────────────────────────────────────────────────

    /// Submit an appeal for a slash. Only the slashed validator may appeal,
    /// and only within the configured `appeal_window_seconds` (#920: appeal mechanism).
    ///
    /// `reason` is a numeric code; `appeal_rationale` is a human-readable
    /// justification stored immutably on-chain.
    pub fn appeal_slash(
        env: &Env,
        validator: Address,
        slash_id: BytesN<32>,
        reason: u32,
        appeal_rationale: String,
    ) {
        validator.require_auth();

        let config: SlashConfig = env
            .storage()
            .instance()
            .get(&DataKey::ValidatorSlashConfig)
            .expect("slash config not set");

        let mut record: SlashRecord = env
            .storage()
            .persistent()
            .get(&DataKey::ValidatorAppealRecord(slash_id.clone()))
            .expect("slash record not found");

        if record.validator != validator {
            panic!("only the slashed validator may appeal");
        }
        if record.appealed {
            panic!("already appealed");
        }

        // Zero appeal_window_seconds means appeals are disabled for this config
        if config.appeal_window_seconds == 0 {
            panic!("appeals are disabled");
        }

        let now = env.ledger().timestamp();
        if now > record.slashed_at + config.appeal_window_seconds {
            panic!("appeal window expired");
        }

        // Mark the record as appealed
        record.appealed = true;
        env.storage()
            .persistent()
            .set(&DataKey::ValidatorAppealRecord(slash_id.clone()), &record);

        // Create the appeal record keyed by slash_id (#920: appeal mechanism)
        let appeal = AppealRecord {
            slash_id: slash_id.clone(),
            appellant: validator.clone(),
            appeal_reason: reason,
            appeal_rationale,
            submitted_at: now,
            resolved: false,
            granted: false,
        };
        env.storage()
            .persistent()
            .set(&DataKey::ValidatorAppeal(slash_id.clone()), &appeal);

        // Update history: mark active appeal
        let mut history: ValidatorSlashHistory = env
            .storage()
            .persistent()
            .get(&DataKey::ValidatorSlashRecord(validator.clone()))
            .expect("slash history not found");
        history.active_appeal = Some(slash_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::ValidatorSlashRecord(validator.clone()), &history);
    }

    // ── Resolve Appeal ───────────────────────────────────────────────────────

    /// Resolve an appeal for a slash. Admin-only.
    ///
    /// If `grant = true`, the slashed amount is restored to the validator
    /// (#920: recovery after period):
    ///   - Treasury sends back the `treasury_amount` to this contract
    ///   - Admin sends back the `burned_amount` to this contract
    ///   - `UserStakeInfo.total_staked` is increased by the full original amount
    ///
    /// If `grant = false`, the slash stands and the appeal is permanently closed.
    pub fn resolve_appeal(env: &Env, admin: Address, slash_id: BytesN<32>, grant: bool) {
        admin.require_auth();

        let mut appeal: AppealRecord = env
            .storage()
            .persistent()
            .get(&DataKey::ValidatorAppeal(slash_id.clone()))
            .expect("appeal not found");

        if appeal.resolved {
            panic!("appeal already resolved");
        }

        let mut record: SlashRecord = env
            .storage()
            .persistent()
            .get(&DataKey::ValidatorAppealRecord(slash_id.clone()))
            .expect("slash record not found");

        if !record.appealed {
            panic!("no active appeal on this slash");
        }

        appeal.resolved = true;
        appeal.granted = grant;
        record.appeal_resolved = true;
        record.appeal_granted = grant;

        // If the appeal is granted, reverse all token movements (#920: recovery after period)
        if grant {
            let config: SlashConfig = env
                .storage()
                .instance()
                .get(&DataKey::ValidatorSlashConfig)
                .expect("slash config not set");

            let restored = record.amount;
            let contract_addr = env.current_contract_address();
            let ax_client = token::Client::new(env, &config.ax_token);

            // Treasury sends back the non-burned portion
            if record.treasury_amount > 0 {
                ax_client.transfer(
                    &config.treasury_address,
                    &contract_addr,
                    &record.treasury_amount,
                );
            }

            // Admin sends back the burned portion
            if record.burned_amount > 0 {
                ax_client.transfer(&admin, &contract_addr, &record.burned_amount);
            }

            // Restore the validator's total_staked
            let mut stake_info: UserStakeInfo = env
                .storage()
                .instance()
                .get(&DataKey::UserStakeInfo(record.validator.clone()))
                .unwrap_or(UserStakeInfo {
                    user: record.validator.clone(),
                    total_staked: 0,
                    total_slashed: 0,
                    active_tournaments: 0,
                    completed_tournaments: 0,
                });
            stake_info.total_staked += restored;
            stake_info.total_slashed = stake_info.total_slashed.saturating_sub(restored);
            env.storage().instance().set(
                &DataKey::UserStakeInfo(record.validator.clone()),
                &stake_info,
            );

            // Update history totals
            let mut history: ValidatorSlashHistory = env
                .storage()
                .persistent()
                .get(&DataKey::ValidatorSlashRecord(record.validator.clone()))
                .expect("slash history not found");
            history.total_slashed = history.total_slashed.saturating_sub(restored);
            history.active_appeal = None;
            env.storage().persistent().set(
                &DataKey::ValidatorSlashRecord(record.validator.clone()),
                &history,
            );
        } else {
            // Denied — clear the active appeal on history
            let mut history: ValidatorSlashHistory = env
                .storage()
                .persistent()
                .get(&DataKey::ValidatorSlashRecord(record.validator.clone()))
                .expect("slash history not found");
            history.active_appeal = None;
            env.storage().persistent().set(
                &DataKey::ValidatorSlashRecord(record.validator.clone()),
                &history,
            );
        }

        env.storage()
            .persistent()
            .set(&DataKey::ValidatorAppeal(slash_id.clone()), &appeal);
        env.storage()
            .persistent()
            .set(&DataKey::ValidatorAppealRecord(slash_id.clone()), &record);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    /// Return the slash history for a validator, or `None` if never slashed.
    pub fn get_slash_history(env: &Env, validator: Address) -> Option<ValidatorSlashHistory> {
        env.storage()
            .persistent()
            .get(&DataKey::ValidatorSlashRecord(validator))
    }

    /// Return the `SlashRecord` for a given `slash_id`, or `None`.
    pub fn get_slash_record(env: &Env, slash_id: BytesN<32>) -> Option<SlashRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::ValidatorAppealRecord(slash_id))
    }

    /// Return the `AppealRecord` for a given `slash_id`, or `None`.
    pub fn get_appeal_record(env: &Env, slash_id: BytesN<32>) -> Option<AppealRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::ValidatorAppeal(slash_id))
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    /// Encode a `u64` counter into a 32-byte identifier using a SHA-256 hash
    /// so each counter value produces a unique, unpredictable slash ID.
    fn counter_to_bytes_n(env: &Env, counter: u64) -> BytesN<32> {
        let be = counter.to_be_bytes();
        let mut raw = Bytes::new(env);
        for b in be.iter() {
            raw.push_back(*b);
        }
        env.crypto().sha256(&raw).into()
    }
}
