//! Validator penalty (slash) mechanism for the StakingManager contract.
//!
//! This module implements configurable slashing of validator stakes with:
//! - Severity-based slash amounts (levels 0-4)
//! - Burn/pool split of slashed tokens
//! - Appeal window and resolution flow
//! - Immutable slash records stored per slash ID
//! - Per-validator slash history

use crate::{
    AppealRecord, DataKey, SlashConfig, SlashRecord, UserStakeInfo, ValidatorSlashHistory,
};
use arenax_events::slashing as slash_events;
use arenax_events::staking as stake_events;
use soroban_sdk::{Address, Bytes, BytesN, Env};

/// Provides all validator penalty operations. Methods are static helpers
/// called from the `StakingManager` contract-impl block in `lib.rs`.
pub struct ValidatorPenaltyManager;

impl ValidatorPenaltyManager {
    // ── Configuration ────────────────────────────────────────────────────────

    /// Store a new slash configuration. Admin-only — caller must have
    /// already called `admin.require_auth()` in the contract-impl layer.
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
    /// - Deducts from `UserStakeInfo.total_staked`; if stake is
    ///   insufficient, slashes what is available.
    /// - Burns `amount * burn_bps / 10_000` (tracked via `DataKey::BurnedSupply`
    ///   counter — no token-burn call because no token client is available here).
    /// - Routes the rest into `DataKey::RewardPool`.
    /// - Records a `SlashRecord` and updates `ValidatorSlashHistory`.
    pub fn slash_validator(
        env: &Env,
        admin: Address,
        validator: Address,
        severity: u32,
        reason: u32,
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

        // Split: burn portion tracked via counter; rest added to reward pool
        let burn_amount = actual_amount * config.burn_bps as i128 / 10_000;
        let pool_amount = actual_amount - burn_amount;

        // Track burned supply (no token call — just accounting)
        if burn_amount > 0 {
            let burned: i128 = env
                .storage()
                .instance()
                .get(&DataKey::BurnedSupply)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::BurnedSupply, &(burned + burn_amount));
        }

        // Add pool portion to reward pool
        if pool_amount > 0 {
            let pool: i128 = env
                .storage()
                .instance()
                .get(&DataKey::RewardPool)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::RewardPool, &(pool + pool_amount));
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

        // Persist the slash record keyed by slash_id
        let record = SlashRecord {
            slash_id: slash_id.clone(),
            validator: validator.clone(),
            amount: actual_amount,
            severity,
            reason,
            slashed_at: now,
            burned_amount: burn_amount,
            pool_amount,
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

        // Emit events
        stake_events::emit_slashed(
            env,
            &validator,
            &BytesN::from_array(env, &[0u8; 32]),
            actual_amount,
            &admin,
        );

        // Emit a slashing-domain event with the slash_id as the case_id,
        // and a zero evidence hash (no ZK proof at this layer)
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
    /// and only within the configured `appeal_window_seconds`.
    pub fn appeal_slash(env: &Env, validator: Address, slash_id: BytesN<32>, reason: u32) {
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

        let now = env.ledger().timestamp();
        if now > record.slashed_at + config.appeal_window_seconds {
            panic!("appeal window expired");
        }

        // Mark the record as appealed
        record.appealed = true;
        env.storage()
            .persistent()
            .set(&DataKey::ValidatorAppealRecord(slash_id.clone()), &record);

        // Create the appeal record keyed by slash_id
        let appeal = AppealRecord {
            slash_id: slash_id.clone(),
            appellant: validator.clone(),
            appeal_reason: reason,
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
    /// If `grant = true`, the slashed amount is restored to the validator's
    /// `UserStakeInfo.total_staked` and removed from the reward pool / burn
    /// tracking.
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

        // If the appeal is granted, reverse the slash accounting
        if grant {
            let restored = record.amount;

            // Restore to the validator's total_staked
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

            // Reverse burn supply counter
            if record.burned_amount > 0 {
                let burned: i128 = env
                    .storage()
                    .instance()
                    .get(&DataKey::BurnedSupply)
                    .unwrap_or(0);
                env.storage().instance().set(
                    &DataKey::BurnedSupply,
                    &(burned - record.burned_amount).max(0),
                );
            }

            // Remove pool portion from reward pool
            if record.pool_amount > 0 {
                let pool: i128 = env
                    .storage()
                    .instance()
                    .get(&DataKey::RewardPool)
                    .unwrap_or(0);
                env.storage()
                    .instance()
                    .set(&DataKey::RewardPool, &(pool - record.pool_amount).max(0));
            }

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

    // ── Internal helpers ─────────────────────────────────────────────────────

    /// Encode a `u64` counter into a 32-byte identifier using a simple
    /// SHA-256 hash so each counter value produces a unique, unpredictable
    /// slash ID.
    fn counter_to_bytes_n(env: &Env, counter: u64) -> BytesN<32> {
        // Build an 8-byte Bytes value from the counter's big-endian
        // representation, then hash it.
        let be = counter.to_be_bytes();
        let mut raw = Bytes::new(env);
        for b in be.iter() {
            raw.push_back(*b);
        }
        env.crypto().sha256(&raw)
    }
}
