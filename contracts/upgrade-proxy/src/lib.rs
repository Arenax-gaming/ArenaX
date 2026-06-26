#![no_std]

//! # ArenaX Upgradeable Proxy Contract
//!
//! Implements a standard upgradeable proxy pattern for all ArenaX contracts:
//!
//! - **Admin-controlled upgrades** with optional timelock enforcement.
//! - **Emergency pause**: all forwarded calls revert while paused.
//! - **Upgrade timelock**: a `propose_upgrade` → wait → `execute_upgrade` flow
//!   prevents immediate execution of potentially dangerous new WASM blobs.
//! - **Rollback** support: the previous WASM hash is retained so the admin can
//!   revert within the rollback window.
//! - **Event emission** on every state change for full auditability.

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, BytesN, Env, Symbol,
};

// ── Error codes ──────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ProxyError {
    NotInitialized       = 1,
    AlreadyInitialized   = 2,
    Unauthorized         = 3,
    Paused               = 4,
    NoPendingUpgrade     = 5,
    TimelockNotElapsed   = 6,
    NoRollbackAvailable  = 7,
    RollbackWindowPassed = 8,
    InvalidWasmHash      = 9,
}

// ── Storage types ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct ProxyConfig {
    pub admin:               Address,
    pub implementation_hash: BytesN<32>,
    pub timelock_ledgers:    u32,
    pub paused:              bool,
}

#[contracttype]
#[derive(Clone)]
pub struct PendingUpgrade {
    pub new_wasm_hash:     BytesN<32>,
    pub proposed_at:       u32,
    pub executable_after:  u32,
}

// ── Storage keys ─────────────────────────────────────────────────────────────

const KEY_CONFIG:           &str = "CONFIG";
const KEY_PENDING:          &str = "PENDING";
const KEY_PREV_HASH:        &str = "PREV";
const KEY_ROLLBACK_UNTIL:   &str = "RBACK";

/// Ledgers the admin has to roll back after an upgrade (≈ 24 h at 5 s/ledger).
const ROLLBACK_WINDOW_LEDGERS: u32 = 17_280;

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct UpgradeProxy;

#[contractimpl]
impl UpgradeProxy {
    // ── Initialisation ──────────────────────────────────────────────────────

    pub fn initialize(
        env:              Env,
        admin:            Address,
        impl_wasm_hash:   BytesN<32>,
        timelock_ledgers: u32,
    ) -> Result<(), ProxyError> {
        if env.storage().instance().has(&Symbol::new(&env, KEY_CONFIG)) {
            return Err(ProxyError::AlreadyInitialized);
        }
        admin.require_auth();

        let config = ProxyConfig {
            admin: admin.clone(),
            implementation_hash: impl_wasm_hash,
            timelock_ledgers,
            paused: false,
        };
        env.storage().instance().set(&Symbol::new(&env, KEY_CONFIG), &config);

        env.events().publish(
            (Symbol::new(&env, "proxy_init"),),
            (admin, timelock_ledgers),
        );
        Ok(())
    }

    // ── Upgrade flow ────────────────────────────────────────────────────────

    /// Stage a new WASM hash for upgrade. The hash is not applied until
    /// `execute_upgrade` is called after the timelock has elapsed.
    pub fn propose_upgrade(
        env:           Env,
        new_wasm_hash: BytesN<32>,
    ) -> Result<u32, ProxyError> {
        let config = Self::load_config(&env)?;
        config.admin.require_auth();

        let proposed_at      = env.ledger().sequence();
        let executable_after = proposed_at.saturating_add(config.timelock_ledgers);

        let pending = PendingUpgrade {
            new_wasm_hash: new_wasm_hash.clone(),
            proposed_at,
            executable_after,
        };
        env.storage().instance().set(&Symbol::new(&env, KEY_PENDING), &pending);

        env.events().publish(
            (Symbol::new(&env, "upgrade_proposed"),),
            (new_wasm_hash, executable_after),
        );
        Ok(executable_after)
    }

    /// Execute the pending upgrade once the timelock has elapsed.
    pub fn execute_upgrade(env: Env) -> Result<(), ProxyError> {
        let config = Self::load_config(&env)?;
        config.admin.require_auth();

        let pending: PendingUpgrade = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, KEY_PENDING))
            .ok_or(ProxyError::NoPendingUpgrade)?;

        if env.ledger().sequence() < pending.executable_after {
            return Err(ProxyError::TimelockNotElapsed);
        }

        // Retain the current hash for rollback.
        env.storage()
            .instance()
            .set(&Symbol::new(&env, KEY_PREV_HASH), &config.implementation_hash);
        let rollback_until = env.ledger().sequence().saturating_add(ROLLBACK_WINDOW_LEDGERS);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, KEY_ROLLBACK_UNTIL), &rollback_until);

        let new_hash = pending.new_wasm_hash.clone();

        // Apply the upgrade.
        env.deployer().update_current_contract_wasm(new_hash.clone());

        let mut updated = config;
        updated.implementation_hash = new_hash.clone();
        env.storage().instance().set(&Symbol::new(&env, KEY_CONFIG), &updated);
        env.storage().instance().remove(&Symbol::new(&env, KEY_PENDING));

        env.events().publish(
            (Symbol::new(&env, "upgrade_executed"),),
            new_hash,
        );
        Ok(())
    }

    /// Roll back to the previous WASM within the rollback window.
    pub fn rollback(env: Env) -> Result<(), ProxyError> {
        let config = Self::load_config(&env)?;
        config.admin.require_auth();

        let prev_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, KEY_PREV_HASH))
            .ok_or(ProxyError::NoRollbackAvailable)?;

        let rollback_until: u32 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, KEY_ROLLBACK_UNTIL))
            .unwrap_or(0);

        if env.ledger().sequence() > rollback_until {
            return Err(ProxyError::RollbackWindowPassed);
        }

        env.deployer().update_current_contract_wasm(prev_hash.clone());

        let mut updated = config;
        updated.implementation_hash = prev_hash.clone();
        env.storage().instance().set(&Symbol::new(&env, KEY_CONFIG), &updated);
        env.storage().instance().remove(&Symbol::new(&env, KEY_PREV_HASH));
        env.storage().instance().remove(&Symbol::new(&env, KEY_ROLLBACK_UNTIL));

        env.events().publish((Symbol::new(&env, "rollback"),), prev_hash);
        Ok(())
    }

    // ── Pause / unpause ─────────────────────────────────────────────────────

    pub fn pause(env: Env) -> Result<(), ProxyError> {
        let mut config = Self::load_config(&env)?;
        config.admin.require_auth();
        config.paused = true;
        env.storage().instance().set(&Symbol::new(&env, KEY_CONFIG), &config);
        env.events().publish((Symbol::new(&env, "paused"),), ());
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), ProxyError> {
        let mut config = Self::load_config(&env)?;
        config.admin.require_auth();
        config.paused = false;
        env.storage().instance().set(&Symbol::new(&env, KEY_CONFIG), &config);
        env.events().publish((Symbol::new(&env, "unpaused"),), ());
        Ok(())
    }

    // ── Admin transfer ──────────────────────────────────────────────────────

    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), ProxyError> {
        let mut config = Self::load_config(&env)?;
        config.admin.require_auth();
        let old_admin = config.admin.clone();
        config.admin = new_admin.clone();
        env.storage().instance().set(&Symbol::new(&env, KEY_CONFIG), &config);
        env.events().publish(
            (Symbol::new(&env, "admin_transferred"),),
            (old_admin, new_admin),
        );
        Ok(())
    }

    // ── Guards ──────────────────────────────────────────────────────────────

    /// Call this at the top of every forwarded function to enforce pause.
    pub fn assert_not_paused(env: Env) -> Result<(), ProxyError> {
        let config = Self::load_config(&env)?;
        if config.paused {
            return Err(ProxyError::Paused);
        }
        Ok(())
    }

    // ── View functions ──────────────────────────────────────────────────────

    pub fn get_config(env: Env) -> Result<ProxyConfig, ProxyError> {
        Self::load_config(&env)
    }

    pub fn get_pending_upgrade(env: Env) -> Option<PendingUpgrade> {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, KEY_PENDING))
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    fn load_config(env: &Env) -> Result<ProxyConfig, ProxyError> {
        env.storage()
            .instance()
            .get(&Symbol::new(env, KEY_CONFIG))
            .ok_or(ProxyError::NotInitialized)
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, BytesN};

    fn dummy_hash(env: &Env, seed: u8) -> BytesN<32> {
        BytesN::from_array(env, &[seed; 32])
    }

    fn setup(env: &Env, timelock: u32) -> (Address, UpgradeProxyClient<'_>) {
        let admin = Address::generate(env);
        let id = env.register_contract(None, UpgradeProxy);
        let client = UpgradeProxyClient::new(env, &id);
        env.mock_all_auths();
        client.initialize(&admin, &dummy_hash(env, 1), &timelock).unwrap();
        (admin, client)
    }

    #[test]
    fn initialize_sets_config() {
        let env = Env::default();
        let (_, client) = setup(&env, 10);
        let cfg = client.get_config().unwrap();
        assert!(!cfg.paused);
        assert_eq!(cfg.timelock_ledgers, 10);
    }

    #[test]
    fn double_init_returns_error() {
        let env = Env::default();
        let (admin, client) = setup(&env, 0);
        env.mock_all_auths();
        let err = client.initialize(&admin, &dummy_hash(&env, 2), &0).unwrap_err();
        assert_eq!(err, ProxyError::AlreadyInitialized);
    }

    #[test]
    fn propose_and_execute_upgrade_with_zero_timelock() {
        let env = Env::default();
        let (_, client) = setup(&env, 0);
        env.mock_all_auths();

        let new_hash = dummy_hash(&env, 2);
        client.propose_upgrade(&new_hash).unwrap();
        assert!(client.get_pending_upgrade().is_some());

        // Timelock == 0, so executable immediately.
        client.execute_upgrade().unwrap();
        assert!(client.get_pending_upgrade().is_none());
        let cfg = client.get_config().unwrap();
        assert_eq!(cfg.implementation_hash, new_hash);
    }

    #[test]
    fn execute_before_timelock_returns_error() {
        let env = Env::default();
        let (_, client) = setup(&env, 100);
        env.mock_all_auths();

        client.propose_upgrade(&dummy_hash(&env, 2)).unwrap();
        let err = client.execute_upgrade().unwrap_err();
        assert_eq!(err, ProxyError::TimelockNotElapsed);
    }

    #[test]
    fn pause_blocks_assert_not_paused() {
        let env = Env::default();
        let (_, client) = setup(&env, 0);
        env.mock_all_auths();

        client.pause().unwrap();
        let err = client.assert_not_paused().unwrap_err();
        assert_eq!(err, ProxyError::Paused);

        client.unpause().unwrap();
        assert!(client.assert_not_paused().is_ok());
    }

    #[test]
    fn execute_without_propose_returns_error() {
        let env = Env::default();
        let (_, client) = setup(&env, 0);
        env.mock_all_auths();

        let err = client.execute_upgrade().unwrap_err();
        assert_eq!(err, ProxyError::NoPendingUpgrade);
    }
}
