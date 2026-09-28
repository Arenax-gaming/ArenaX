#![no_std]

//! Contract upgrade manager (Issue #880).
//!
//! # Why this is not a proxy
//!
//! The issue asks for a proxy pattern. On EVM a proxy is necessary because code
//! at an address is immutable, so upgrades work by delegating from a stable
//! address to a swappable implementation. **Soroban does not have that
//! constraint**: `env.deployer().update_current_contract_wasm(hash)` replaces a
//! contract's code in place, keeping its address, its storage, and every
//! reference other contracts hold to it.
//!
//! Implementing a delegating proxy here would therefore *add* the failure modes
//! the EVM pattern is famous for — storage-layout collisions between proxy and
//! implementation, an extra hop on every call, and a selector-clash surface —
//! to buy a property the platform already provides for free. So this manager
//! governs the native upgrade instead: it decides *whether* an upgrade may
//! proceed, records what happened, and can put it back.
//!
//! # What actually needs protecting
//!
//! An upgrade is the single most dangerous operation a contract has: it can
//! replace all behaviour in one transaction. The controls here exist because
//! each corresponds to a way real upgrades go wrong:
//!
//! - **Timelock** — an upgrade nobody could see coming is indistinguishable
//!   from a key compromise. Scheduling forces a public window.
//! - **Pause during upgrade** — state migrated while writes are landing is
//!   migrated inconsistently.
//! - **Rollback** — the previous WASM hash is recorded *before* the swap, so
//!   reverting does not depend on anyone having written it down.
//! - **Version tracking** — a migration that runs twice, or runs against the
//!   wrong starting version, corrupts exactly the state it was meant to fix.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    Symbol, Vec,
};

// ── Storage keys ────────────────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("admin");
const VERSION: Symbol = symbol_short!("version");
const PENDING: Symbol = symbol_short!("pending");
const PAUSED: Symbol = symbol_short!("paused");
const HISTORY: Symbol = symbol_short!("history");
const CURRENT: Symbol = symbol_short!("current");
const DELAY: Symbol = symbol_short!("delay");
const MIGRATED: Symbol = symbol_short!("migrated");

/// Default timelock: 48 hours, long enough for an unexpected upgrade to be
/// noticed and contested across time zones.
pub const DEFAULT_UPGRADE_DELAY: u64 = 172_800;

/// Cap on retained history entries, so the record cannot grow without bound.
pub const MAX_HISTORY: u32 = 32;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum UpgradeError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    /// An upgrade is already scheduled; cancel it before scheduling another.
    UpgradeAlreadyScheduled = 4,
    NoUpgradeScheduled = 5,
    /// The timelock has not elapsed.
    TimelockNotElapsed = 6,
    /// Execution requires the contract to be paused first.
    NotPaused = 7,
    /// The contract is paused and this operation is not allowed while it is.
    Paused = 8,
    /// No previous version is recorded, so there is nothing to roll back to.
    NoRollbackTarget = 9,
    /// The proposed version does not follow the current one.
    InvalidVersion = 10,
    /// This migration has already been applied.
    MigrationAlreadyApplied = 11,
    InvalidDelay = 12,
}

/// Semantic version triple.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl Version {
    /// Strict ordering. Used to reject an upgrade that does not move forward —
    /// re-deploying an older WASM under a version that already ran would make
    /// migration state meaningless.
    fn is_after(&self, other: &Version) -> bool {
        (self.major, self.minor, self.patch) > (other.major, other.minor, other.patch)
    }
}

/// An upgrade waiting out its timelock.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingUpgrade {
    pub new_wasm_hash: BytesN<32>,
    pub target_version: Version,
    pub scheduled_at: u64,
    /// Earliest ledger timestamp at which this may execute.
    pub executable_at: u64,
    pub scheduled_by: Address,
    /// Whether state migration must run as part of this upgrade.
    pub requires_migration: bool,
}

/// A completed upgrade, kept so the lineage is queryable on-chain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeRecord {
    pub from_version: Version,
    pub to_version: Version,
    pub from_wasm_hash: BytesN<32>,
    pub to_wasm_hash: BytesN<32>,
    pub executed_at: u64,
    pub executed_by: Address,
    /// True when this record was produced by a rollback rather than an upgrade.
    pub was_rollback: bool,
}

#[contract]
pub struct UpgradeManager;

#[contractimpl]
impl UpgradeManager {
    /// Initialize with an admin, a starting version, and the deployed WASM hash.
    ///
    /// # Errors
    /// - `AlreadyInitialized` if called twice.
    pub fn initialize(
        env: Env,
        admin: Address,
        version: Version,
        wasm_hash: BytesN<32>,
    ) -> Result<(), UpgradeError> {
        if env.storage().instance().has(&ADMIN) {
            return Err(UpgradeError::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&VERSION, &version);
        env.storage().instance().set(&CURRENT, &wasm_hash);
        env.storage().instance().set(&PAUSED, &false);
        env.storage().instance().set(&DELAY, &DEFAULT_UPGRADE_DELAY);
        env.storage()
            .instance()
            .set(&HISTORY, &Vec::<UpgradeRecord>::new(&env));

        Ok(())
    }

    // ── Scheduling ──────────────────────────────────────────────────────────

    /// Schedule an upgrade. It becomes executable once the timelock elapses.
    ///
    /// Scheduling is deliberately separate from execution. A single-call
    /// upgrade gives observers no window to react, which means a stolen admin
    /// key and a legitimate release are operationally identical.
    ///
    /// # Errors
    /// - `Unauthorized` if the caller is not the admin.
    /// - `UpgradeAlreadyScheduled` if one is already pending.
    /// - `InvalidVersion` if `target_version` does not follow the current one.
    pub fn schedule_upgrade(
        env: Env,
        new_wasm_hash: BytesN<32>,
        target_version: Version,
        requires_migration: bool,
    ) -> Result<PendingUpgrade, UpgradeError> {
        let admin = Self::require_admin(&env)?;

        if env.storage().instance().has(&PENDING) {
            return Err(UpgradeError::UpgradeAlreadyScheduled);
        }

        let current: Version = Self::current_version(env.clone())?;
        if !target_version.is_after(&current) {
            return Err(UpgradeError::InvalidVersion);
        }

        let now = env.ledger().timestamp();
        let delay: u64 = env
            .storage()
            .instance()
            .get(&DELAY)
            .unwrap_or(DEFAULT_UPGRADE_DELAY);

        let pending = PendingUpgrade {
            new_wasm_hash,
            target_version,
            scheduled_at: now,
            executable_at: now.saturating_add(delay),
            scheduled_by: admin,
            requires_migration,
        };

        env.storage().instance().set(&PENDING, &pending);
        Ok(pending)
    }

    /// Cancel a scheduled upgrade.
    ///
    /// The counterpart to the timelock: a window to notice a bad upgrade is
    /// worth nothing without a way to stop it.
    pub fn cancel_upgrade(env: Env) -> Result<(), UpgradeError> {
        Self::require_admin(&env)?;

        if !env.storage().instance().has(&PENDING) {
            return Err(UpgradeError::NoUpgradeScheduled);
        }

        env.storage().instance().remove(&PENDING);
        Ok(())
    }

    // ── Pause ───────────────────────────────────────────────────────────────

    /// Pause state-changing operations.
    ///
    /// Required before executing an upgrade that migrates state: migrating
    /// while writes are still landing migrates an inconsistent snapshot, and
    /// the resulting corruption is silent.
    pub fn pause(env: Env) -> Result<(), UpgradeError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&PAUSED, &true);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), UpgradeError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&PAUSED, &false);
        Ok(())
    }

    #[must_use]
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&PAUSED).unwrap_or(false)
    }

    /// Guard for other contracts to call before mutating state.
    ///
    /// # Errors
    /// - `Paused` while an upgrade is in progress.
    pub fn require_not_paused(env: Env) -> Result<(), UpgradeError> {
        if Self::is_paused(env) {
            return Err(UpgradeError::Paused);
        }
        Ok(())
    }

    // ── Execution ───────────────────────────────────────────────────────────

    /// Execute the scheduled upgrade.
    ///
    /// The previous WASM hash is written into history **before** the swap, so
    /// the rollback target exists even if the new code is broken enough that
    /// nothing after this point runs correctly. Recording it afterwards would
    /// make rollback depend on the very code that just failed.
    ///
    /// # Errors
    /// - `NoUpgradeScheduled` if nothing is pending.
    /// - `TimelockNotElapsed` if the delay has not passed.
    /// - `NotPaused` if the upgrade migrates state and the contract is live.
    pub fn execute_upgrade(env: Env) -> Result<UpgradeRecord, UpgradeError> {
        let record = Self::prepare_upgrade(env.clone())?;

        // Soroban replaces the code in place - same address, same storage, and
        // every existing reference to this contract keeps working. This is what
        // makes a delegating proxy unnecessary.
        env.deployer()
            .update_current_contract_wasm(record.to_wasm_hash.clone());

        Ok(record)
    }

    /// Everything `execute_upgrade` does *except* installing the new WASM:
    /// run the checks, record history, advance the version, clear the pending
    /// slot, and return the hash to install.
    ///
    /// Split out because `update_current_contract_wasm` requires a WASM that
    /// has actually been uploaded to the ledger, which a unit test cannot
    /// fabricate. Keeping the governance logic — timelock, pause requirement,
    /// version ordering, rollback bookkeeping — on this side of the boundary
    /// means all of it is testable, and the privileged host call stays a thin
    /// wrapper with nothing to get wrong.
    ///
    /// Callers should use `execute_upgrade`; this is public so the decision can
    /// be exercised directly.
    pub fn prepare_upgrade(env: Env) -> Result<UpgradeRecord, UpgradeError> {
        let admin = Self::require_admin(&env)?;

        let pending: PendingUpgrade = env
            .storage()
            .instance()
            .get(&PENDING)
            .ok_or(UpgradeError::NoUpgradeScheduled)?;

        let now = env.ledger().timestamp();
        if now < pending.executable_at {
            return Err(UpgradeError::TimelockNotElapsed);
        }

        // Only migrating upgrades demand a pause. Forcing it for every upgrade
        // would make routine patches disruptive enough that operators start
        // skipping the mechanism.
        if pending.requires_migration && !Self::is_paused(env.clone()) {
            return Err(UpgradeError::NotPaused);
        }

        let from_version: Version = Self::current_version(env.clone())?;
        let from_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&CURRENT)
            .ok_or(UpgradeError::NotInitialized)?;

        let record = UpgradeRecord {
            from_version,
            to_version: pending.target_version,
            from_wasm_hash: from_hash,
            to_wasm_hash: pending.new_wasm_hash.clone(),
            executed_at: now,
            executed_by: admin,
            was_rollback: false,
        };

        // History and version first; the WASM swap last.
        Self::push_history(&env, &record);
        env.storage()
            .instance()
            .set(&VERSION, &pending.target_version);
        env.storage()
            .instance()
            .set(&CURRENT, &pending.new_wasm_hash);
        env.storage().instance().remove(&PENDING);

        Ok(record)
    }

    /// Roll back to the previously deployed WASM.
    ///
    /// Records a new history entry rather than deleting the failed one: an
    /// upgrade that had to be reverted is exactly the event an operator most
    /// needs to find later, and erasing it would be rewriting the record.
    ///
    /// The version is restored to the pre-upgrade value, so a subsequent
    /// re-attempt is a fresh upgrade rather than a silent re-run.
    ///
    /// # Errors
    /// - `NoRollbackTarget` if no upgrade has been executed yet.
    pub fn rollback(env: Env) -> Result<UpgradeRecord, UpgradeError> {
        let record = Self::prepare_rollback(env.clone())?;

        env.deployer()
            .update_current_contract_wasm(record.to_wasm_hash.clone());

        Ok(record)
    }

    /// `rollback` without installing the WASM. See [`Self::prepare_upgrade`]
    /// for why the split exists.
    pub fn prepare_rollback(env: Env) -> Result<UpgradeRecord, UpgradeError> {
        let admin = Self::require_admin(&env)?;

        let history: Vec<UpgradeRecord> = env
            .storage()
            .instance()
            .get(&HISTORY)
            .unwrap_or_else(|| Vec::new(&env));

        let last = history.last().ok_or(UpgradeError::NoRollbackTarget)?;

        let record = UpgradeRecord {
            from_version: last.to_version,
            to_version: last.from_version,
            from_wasm_hash: last.to_wasm_hash.clone(),
            to_wasm_hash: last.from_wasm_hash.clone(),
            executed_at: env.ledger().timestamp(),
            executed_by: admin,
            was_rollback: true,
        };

        Self::push_history(&env, &record);
        env.storage().instance().set(&VERSION, &last.from_version);
        env.storage().instance().set(&CURRENT, &last.from_wasm_hash);

        Ok(record)
    }

    // ── Migration ───────────────────────────────────────────────────────────

    /// Record that a named migration has run, refusing a second application.
    ///
    /// Migrations are rarely idempotent — "add 10% to every balance" run twice
    /// is a different and much worse bug than not running it at all. The ledger
    /// of applied migrations is what makes a retry safe after a partial
    /// failure.
    ///
    /// # Errors
    /// - `MigrationAlreadyApplied` if this name has already been recorded.
    /// - `NotPaused` because migrations must not run against live writes.
    pub fn record_migration(env: Env, name: Symbol) -> Result<(), UpgradeError> {
        Self::require_admin(&env)?;

        if !Self::is_paused(env.clone()) {
            return Err(UpgradeError::NotPaused);
        }

        let key = (MIGRATED, name.clone());
        if env.storage().persistent().has(&key) {
            return Err(UpgradeError::MigrationAlreadyApplied);
        }

        env.storage()
            .persistent()
            .set(&key, &env.ledger().timestamp());
        Ok(())
    }

    /// Whether a migration has been applied.
    #[must_use]
    pub fn is_migration_applied(env: Env, name: Symbol) -> bool {
        env.storage().persistent().has(&(MIGRATED, name))
    }

    // ── Reads ───────────────────────────────────────────────────────────────

    pub fn current_version(env: Env) -> Result<Version, UpgradeError> {
        env.storage()
            .instance()
            .get(&VERSION)
            .ok_or(UpgradeError::NotInitialized)
    }

    pub fn current_wasm_hash(env: Env) -> Result<BytesN<32>, UpgradeError> {
        env.storage()
            .instance()
            .get(&CURRENT)
            .ok_or(UpgradeError::NotInitialized)
    }

    #[must_use]
    pub fn pending_upgrade(env: Env) -> Option<PendingUpgrade> {
        env.storage().instance().get(&PENDING)
    }

    #[must_use]
    pub fn upgrade_history(env: Env) -> Vec<UpgradeRecord> {
        env.storage()
            .instance()
            .get(&HISTORY)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Change the timelock delay. Admin only.
    ///
    /// A zero delay is rejected: it would turn scheduling into a formality and
    /// remove the window the mechanism exists to create.
    pub fn set_upgrade_delay(env: Env, delay_seconds: u64) -> Result<(), UpgradeError> {
        Self::require_admin(&env)?;
        if delay_seconds == 0 {
            return Err(UpgradeError::InvalidDelay);
        }
        env.storage().instance().set(&DELAY, &delay_seconds);
        Ok(())
    }

    // ── Internals ───────────────────────────────────────────────────────────

    fn require_admin(env: &Env) -> Result<Address, UpgradeError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(UpgradeError::NotInitialized)?;
        admin.require_auth();
        Ok(admin)
    }

    /// Append to history, dropping the oldest entry past the cap.
    fn push_history(env: &Env, record: &UpgradeRecord) {
        let mut history: Vec<UpgradeRecord> = env
            .storage()
            .instance()
            .get(&HISTORY)
            .unwrap_or_else(|| Vec::new(env));

        if history.len() >= MAX_HISTORY {
            history.remove(0);
        }
        history.push_back(record.clone());
        env.storage().instance().set(&HISTORY, &history);
    }
}

#[cfg(test)]
mod test;
