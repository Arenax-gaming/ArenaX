#![cfg(test)]

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env,
};

use crate::{UpgradeError, UpgradeManager, UpgradeManagerClient, Version, DEFAULT_UPGRADE_DELAY};

// These exercise `prepare_upgrade` / `prepare_rollback` rather than
// `execute_upgrade` / `rollback`. The only difference is the final
// `update_current_contract_wasm` call, which the host rejects for any hash that
// was not actually uploaded to the ledger - something a unit test cannot
// fabricate. All the governance logic being tested lives on the prepare side;
// the installing wrappers are one line each and are covered by deployment
// testing rather than here.

const V1: Version = Version {
    major: 1,
    minor: 0,
    patch: 0,
};
const V2: Version = Version {
    major: 2,
    minor: 0,
    patch: 0,
};
const V3: Version = Version {
    major: 3,
    minor: 0,
    patch: 0,
};

fn setup(env: &Env) -> (UpgradeManagerClient<'_>, Address, BytesN<32>) {
    env.mock_all_auths();
    let contract_id = env.register(UpgradeManager, ());
    let client = UpgradeManagerClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let wasm = BytesN::from_array(env, &[1u8; 32]);

    client.initialize(&admin, &V1, &wasm);
    (client, admin, wasm)
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Move the ledger past the timelock.
fn advance_past_timelock(env: &Env) {
    env.ledger()
        .with_mut(|l| l.timestamp += DEFAULT_UPGRADE_DELAY + 1);
}

#[test]
fn initialize_records_version_and_hash() {
    let env = Env::default();
    let (client, _admin, wasm) = setup(&env);

    assert_eq!(client.current_version(), V1);
    assert_eq!(client.current_wasm_hash(), wasm);
    assert!(!client.is_paused());
    assert_eq!(client.upgrade_history().len(), 0);
}

#[test]
fn initialize_is_once_only() {
    let env = Env::default();
    let (client, admin, wasm) = setup(&env);
    assert_eq!(
        client.try_initialize(&admin, &V2, &wasm),
        Err(Ok(UpgradeError::AlreadyInitialized))
    );
}

#[test]
fn scheduling_sets_a_timelock() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);

    let pending = client.schedule_upgrade(&hash(&env, 2), &V2, &false);

    assert_eq!(pending.target_version, V2);
    assert_eq!(
        pending.executable_at,
        pending.scheduled_at + DEFAULT_UPGRADE_DELAY
    );
    assert!(client.pending_upgrade().is_some());
}

#[test]
fn only_one_upgrade_may_be_pending() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);
    client.schedule_upgrade(&hash(&env, 2), &V2, &false);

    assert_eq!(
        client.try_schedule_upgrade(&hash(&env, 3), &V3, &false),
        Err(Ok(UpgradeError::UpgradeAlreadyScheduled))
    );
}

#[test]
fn a_version_that_does_not_move_forward_is_rejected() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);

    // Re-deploying older code under a version that already ran would make the
    // migration ledger meaningless.
    assert_eq!(
        client.try_schedule_upgrade(&hash(&env, 2), &V1, &false),
        Err(Ok(UpgradeError::InvalidVersion))
    );
    let older = Version {
        major: 0,
        minor: 9,
        patch: 0,
    };
    assert_eq!(
        client.try_schedule_upgrade(&hash(&env, 2), &older, &false),
        Err(Ok(UpgradeError::InvalidVersion))
    );
}

#[test]
fn execution_before_the_timelock_elapses_is_refused() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);
    client.schedule_upgrade(&hash(&env, 2), &V2, &false);

    assert_eq!(
        client.try_prepare_upgrade(),
        Err(Ok(UpgradeError::TimelockNotElapsed))
    );

    // One second short still counts as short.
    env.ledger()
        .with_mut(|l| l.timestamp += DEFAULT_UPGRADE_DELAY - 1);
    assert_eq!(
        client.try_prepare_upgrade(),
        Err(Ok(UpgradeError::TimelockNotElapsed))
    );
}

#[test]
fn execution_after_the_timelock_advances_the_version() {
    let env = Env::default();
    let (client, _admin, original) = setup(&env);
    let next = hash(&env, 2);
    client.schedule_upgrade(&next, &V2, &false);
    advance_past_timelock(&env);

    let record = client.prepare_upgrade();

    assert_eq!(record.from_version, V1);
    assert_eq!(record.to_version, V2);
    assert_eq!(record.from_wasm_hash, original);
    assert!(!record.was_rollback);
    assert_eq!(client.current_version(), V2);
    assert_eq!(client.current_wasm_hash(), next);
    // The pending slot is cleared, so the same upgrade cannot run twice.
    assert!(client.pending_upgrade().is_none());
}

#[test]
fn a_migrating_upgrade_requires_a_pause_first() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);
    client.schedule_upgrade(&hash(&env, 2), &V2, &true);
    advance_past_timelock(&env);

    // Migrating state while writes are still landing migrates an inconsistent
    // snapshot, and the corruption is silent.
    assert_eq!(
        client.try_prepare_upgrade(),
        Err(Ok(UpgradeError::NotPaused))
    );

    client.pause();
    assert!(client.try_prepare_upgrade().is_ok());
}

#[test]
fn a_non_migrating_upgrade_does_not_require_a_pause() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);
    client.schedule_upgrade(&hash(&env, 2), &V2, &false);
    advance_past_timelock(&env);

    // Forcing a pause for routine patches makes the mechanism disruptive
    // enough that operators start bypassing it.
    assert!(client.try_prepare_upgrade().is_ok());
}

#[test]
fn cancelling_removes_the_pending_upgrade() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);
    client.schedule_upgrade(&hash(&env, 2), &V2, &false);

    client.cancel_upgrade();

    assert!(client.pending_upgrade().is_none());
    assert_eq!(
        client.try_cancel_upgrade(),
        Err(Ok(UpgradeError::NoUpgradeScheduled))
    );
    // A cancelled upgrade never happened, so the version must not move.
    assert_eq!(client.current_version(), V1);
}

#[test]
fn rollback_restores_the_previous_wasm_and_version() {
    let env = Env::default();
    let (client, _admin, original) = setup(&env);
    client.schedule_upgrade(&hash(&env, 2), &V2, &false);
    advance_past_timelock(&env);
    client.prepare_upgrade();

    let record = client.prepare_rollback();

    assert!(record.was_rollback);
    assert_eq!(client.current_version(), V1);
    assert_eq!(client.current_wasm_hash(), original);
}

#[test]
fn rollback_records_rather_than_erases_the_failed_upgrade() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);
    client.schedule_upgrade(&hash(&env, 2), &V2, &false);
    advance_past_timelock(&env);
    client.prepare_upgrade();
    client.prepare_rollback();

    let history = client.upgrade_history();
    // An upgrade that had to be reverted is the event an operator most needs
    // to find later; erasing it would be rewriting the record.
    assert_eq!(history.len(), 2);
    assert!(!history.get(0).unwrap().was_rollback);
    assert!(history.get(1).unwrap().was_rollback);
}

#[test]
fn rollback_without_history_is_refused() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);
    assert_eq!(
        client.try_prepare_rollback(),
        Err(Ok(UpgradeError::NoRollbackTarget))
    );
}

#[test]
fn pause_blocks_guarded_operations() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);

    assert!(client.try_require_not_paused().is_ok());

    client.pause();
    assert!(client.is_paused());
    assert_eq!(
        client.try_require_not_paused(),
        Err(Ok(UpgradeError::Paused))
    );

    client.unpause();
    assert!(client.try_require_not_paused().is_ok());
}

#[test]
fn a_migration_cannot_be_applied_twice() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);
    client.pause();

    let name = symbol_short!("mig_v2");
    client.record_migration(&name);
    assert!(client.is_migration_applied(&name));

    // "Add 10% to every balance" run twice is a worse bug than not running it.
    assert_eq!(
        client.try_record_migration(&name),
        Err(Ok(UpgradeError::MigrationAlreadyApplied))
    );
}

#[test]
fn migrations_must_run_against_a_paused_contract() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);

    assert_eq!(
        client.try_record_migration(&symbol_short!("mig_v2")),
        Err(Ok(UpgradeError::NotPaused))
    );
}

#[test]
fn distinct_migrations_are_tracked_separately() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);
    client.pause();

    client.record_migration(&symbol_short!("mig_a"));

    assert!(client.is_migration_applied(&symbol_short!("mig_a")));
    assert!(!client.is_migration_applied(&symbol_short!("mig_b")));
}

#[test]
fn the_upgrade_delay_is_configurable_but_not_removable() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);

    client.set_upgrade_delay(&3600);
    let pending = client.schedule_upgrade(&hash(&env, 2), &V2, &false);
    assert_eq!(pending.executable_at, pending.scheduled_at + 3600);

    // Zero would turn scheduling into a formality and remove the window the
    // mechanism exists to create.
    assert_eq!(
        client.try_set_upgrade_delay(&0),
        Err(Ok(UpgradeError::InvalidDelay))
    );
}

#[test]
fn successive_upgrades_chain_through_history() {
    let env = Env::default();
    let (client, _admin, _wasm) = setup(&env);

    client.schedule_upgrade(&hash(&env, 2), &V2, &false);
    advance_past_timelock(&env);
    client.prepare_upgrade();

    client.schedule_upgrade(&hash(&env, 3), &V3, &false);
    advance_past_timelock(&env);
    client.prepare_upgrade();

    let history = client.upgrade_history();
    assert_eq!(history.len(), 2);
    // Each record's starting point is the previous record's destination.
    assert_eq!(history.get(0).unwrap().to_version, V2);
    assert_eq!(history.get(1).unwrap().from_version, V2);
    assert_eq!(client.current_version(), V3);
}
