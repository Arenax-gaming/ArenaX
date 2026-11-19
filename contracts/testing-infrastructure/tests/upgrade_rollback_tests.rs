#![cfg(test)]

//! Upgrade-system rollback test harness (#1576).
//!
//! Exercises the full upgrade -> rollback cycle against a deployed
//! `upgrade-system` contract instance, verifying that:
//!   - state recorded before an upgrade survives both the upgrade and the
//!     subsequent rollback (no data loss),
//!   - a rolled-back contract reports the correct (pre-upgrade) version, and
//!   - a migration that would corrupt state mid-upgrade is detected and
//!     aborts before the upgrade can complete.
//!
//! These tests exercise `prepare_upgrade` / `prepare_rollback` rather than
//! `execute_upgrade` / `rollback`. The only difference is the trailing
//! `update_current_contract_wasm` host call, which requires a WASM blob that
//! has actually been uploaded to the ledger — something no unit/integration
//! test can fabricate. All of the governance logic this issue cares about
//! (timelock, pause gating, version bookkeeping, rollback, migration
//! tracking) lives entirely on the "prepare" side, so it is fully covered
//! here without external dependencies, and runs via plain `cargo test`.

use soroban_sdk::{symbol_short, testutils::Address as _, testutils::Ledger as _, Address, BytesN, Env};
use upgrade_system::{UpgradeError, UpgradeManager, UpgradeManagerClient, Version, DEFAULT_UPGRADE_DELAY};

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

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn deploy_v1(env: &Env) -> (UpgradeManagerClient<'_>, Address, BytesN<32>) {
    env.mock_all_auths();
    let contract_id = env.register(UpgradeManager, ());
    let client = UpgradeManagerClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let v1_wasm = hash(env, 1);

    client.initialize(&admin, &V1, &v1_wasm);
    (client, admin, v1_wasm)
}

fn advance_past_timelock(env: &Env) {
    env.ledger()
        .with_mut(|l| l.timestamp += DEFAULT_UPGRADE_DELAY + 1);
}

/// Deploy a v1 contract, upgrade it to v2 (running a migration along the
/// way), then roll back to v1 — and confirm the migration record applied
/// before the upgrade is still intact afterwards, i.e. the cycle completes
/// without data loss.
#[test]
fn upgrade_then_rollback_preserves_state_without_data_loss() {
    let env = Env::default();
    let (client, _admin, v1_wasm) = deploy_v1(&env);
    let v2_wasm = hash(&env, 2);

    // Business state recorded on the contract before the upgrade begins.
    client.pause();
    let migration_name = symbol_short!("mig_v2");
    client.record_migration(&migration_name);
    assert!(client.is_migration_applied(&migration_name));
    client.unpause();

    // Upgrade v1 -> v2.
    client.schedule_upgrade(&v2_wasm, &V2, &false);
    advance_past_timelock(&env);
    let upgrade_record = client.prepare_upgrade();

    assert_eq!(upgrade_record.from_version, V1);
    assert_eq!(upgrade_record.to_version, V2);
    assert_eq!(client.current_version(), V2);
    assert_eq!(client.current_wasm_hash(), v2_wasm);
    // The migration recorded pre-upgrade must still be there post-upgrade.
    assert!(client.is_migration_applied(&migration_name));

    // Roll back v2 -> v1.
    let rollback_record = client.prepare_rollback();

    assert!(rollback_record.was_rollback);
    assert_eq!(rollback_record.from_version, V2);
    assert_eq!(rollback_record.to_version, V1);

    // The rolled-back contract must report the correct (v1) version number
    // and the original WASM hash.
    assert_eq!(client.current_version(), V1);
    assert_eq!(client.current_wasm_hash(), v1_wasm);

    // No data loss: the migration applied before the upgrade is still
    // recorded after the full upgrade -> rollback cycle, since rollback only
    // restores the version/hash pointers and never touches the persistent
    // migration ledger.
    assert!(client.is_migration_applied(&migration_name));

    // Both the upgrade and the rollback are preserved in history — an
    // operator reviewing this later can see exactly what happened.
    let history = client.upgrade_history();
    assert_eq!(history.len(), 2);
    assert!(!history.get(0).unwrap().was_rollback);
    assert!(history.get(1).unwrap().was_rollback);
}

/// A migrating upgrade must not be able to complete while the contract is
/// live (unpaused) — attempting it mid-upgrade is treated as the kind of
/// state corruption the pause gate exists to prevent, and the upgrade must
/// abort rather than silently proceeding.
#[test]
fn mid_upgrade_state_corruption_aborts_the_upgrade() {
    let env = Env::default();
    let (client, _admin, v1_wasm) = deploy_v1(&env);

    client.schedule_upgrade(&hash(&env, 2), &V2, &true /* requires_migration */);
    advance_past_timelock(&env);

    // The contract was never paused before attempting to execute a
    // migration-carrying upgrade — this is the corruption scenario: writes
    // could still be landing while migration runs. The upgrade must refuse
    // to proceed.
    assert_eq!(
        client.try_prepare_upgrade(),
        Err(Ok(UpgradeError::NotPaused))
    );

    // Nothing must have moved: version, wasm hash, and history are all
    // exactly as they were before the aborted attempt.
    assert_eq!(client.current_version(), V1);
    assert_eq!(client.current_wasm_hash(), v1_wasm);
    assert_eq!(client.upgrade_history().len(), 0);
    assert!(client.pending_upgrade().is_some());
}

/// A duplicate migration record is itself a form of state corruption (e.g. a
/// retried migration step re-applying "add 10% to every balance"). Recording
/// the same migration twice while preparing an upgrade must be rejected, and
/// the upgrade must not be able to complete on top of a corrupted migration
/// ledger.
#[test]
fn duplicate_migration_during_upgrade_preparation_is_rejected() {
    let env = Env::default();
    let (client, _admin, _v1_wasm) = deploy_v1(&env);

    client.pause();
    let migration_name = symbol_short!("mig_v2");
    client.record_migration(&migration_name);

    // Re-applying the same migration mid-upgrade-preparation must fail
    // rather than silently corrupting state.
    assert_eq!(
        client.try_record_migration(&migration_name),
        Err(Ok(UpgradeError::MigrationAlreadyApplied))
    );

    // The upgrade itself can still proceed normally once the (single, valid)
    // migration is in place and the contract is paused.
    client.schedule_upgrade(&hash(&env, 2), &V2, &true);
    advance_past_timelock(&env);
    let record = client.prepare_upgrade();

    assert_eq!(record.to_version, V2);
    assert_eq!(client.current_version(), V2);
    assert!(client.is_migration_applied(&migration_name));
}
