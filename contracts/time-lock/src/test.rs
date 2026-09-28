#![cfg(test)]

use super::*;
use soroban_sdk::{symbol_short, testutils::Address as _, testutils::Ledger as _, Bytes, Env};

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn make_id(env: &Env, seed: u8) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0] = seed;
    BytesN::from_array(env, &bytes)
}

/// Set up a contract with `num_governors` governors (admin + extras) and
/// return (client, admin, governors_vec).
fn setup(
    env: &Env,
    min_delay: u64,
    grace: u64,
    quorum: u32,
    num_governors: u32,
) -> (TimeLockClient<'_>, Address, Vec<Address>) {
    let contract_id = env.register(TimeLock, ());
    let client = TimeLockClient::new(env, &contract_id);
    let admin = Address::generate(env);

    client.initialize(&admin, &min_delay, &grace, &quorum);

    let mut govs: Vec<Address> = Vec::new(env);
    govs.push_back(admin.clone());

    for _ in 1..num_governors {
        let g = Address::generate(env);
        client.add_governor(&admin, &g);
        govs.push_back(g.clone());
    }

    (client, admin, govs)
}

fn schedule_default(
    client: &TimeLockClient,
    caller: &Address,
    id: &BytesN<32>,
    target: &Address,
    env: &Env,
) {
    let func = symbol_short!("transfer");
    let args = Bytes::new(env);
    let desc = symbol_short!("op");
    client.schedule_operation(
        caller,
        id,
        target,
        &func,
        &args,
        &200,
        &desc,
        &CATEGORY_GENERAL,
        &PRIORITY_MEDIUM,
        &0u64,
    );
}

// ─── Initialization ───────────────────────────────────────────────────────────

#[test]
fn test_initialize_stores_config() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 2, 1);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_min_delay(), 100);
    assert_eq!(client.get_grace_period(), 3600);
    assert_eq!(client.get_accel_quorum(), 2);
    assert_eq!(client.get_governors().len(), 1);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    client.initialize(&admin, &100, &3600, &1);
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

#[test]
fn test_schedule_operation_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);

    let op = client.get_operation(&id).unwrap();
    assert_eq!(op.status, STATUS_SCHEDULED);
    assert_eq!(op.category, CATEGORY_GENERAL);
    assert_eq!(op.priority, PRIORITY_MEDIUM);
    assert_eq!(op.proposer, admin);
    // execute_after = now(0) + 200
    assert_eq!(op.execute_after, 200);
    // execute_before = execute_after + grace(3600)
    assert_eq!(op.execute_before, 3800);
}

#[test]
#[should_panic(expected = "delay is less than minimum delay")]
fn test_schedule_below_min_delay_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);
    let func = symbol_short!("transfer");
    let args = Bytes::new(&env);
    let desc = symbol_short!("op");

    // 50 < min_delay(100) → should panic
    client.schedule_operation(
        &admin,
        &id,
        &target,
        &func,
        &args,
        &50,
        &desc,
        &CATEGORY_GENERAL,
        &PRIORITY_MEDIUM,
        &0u64,
    );
}

#[test]
#[should_panic(expected = "operation already scheduled")]
fn test_schedule_duplicate_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);
    schedule_default(&client, &admin, &id, &target, &env); // duplicate
}

#[test]
#[should_panic(expected = "caller is not a governor")]
fn test_schedule_non_governor_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _) = setup(&env, 100, 3600, 1, 1);
    let outsider = Address::generate(&env);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &outsider, &id, &target, &env);
}

#[test]
fn test_schedule_with_custom_grace_period() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);
    let func = symbol_short!("transfer");
    let args = Bytes::new(&env);
    let desc = symbol_short!("op");

    // custom grace = 7200 (2 h)
    client.schedule_operation(
        &admin,
        &id,
        &target,
        &func,
        &args,
        &200,
        &desc,
        &CATEGORY_TREASURY,
        &PRIORITY_HIGH,
        &7200u64,
    );

    let op = client.get_operation(&id).unwrap();
    assert_eq!(op.execute_before, op.execute_after + 7200);
    assert_eq!(op.category, CATEGORY_TREASURY);
    assert_eq!(op.priority, PRIORITY_HIGH);
}

// ─── Execution ────────────────────────────────────────────────────────────────

#[test]
fn test_execute_after_delay_passes() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);

    env.ledger().with_mut(|l| l.timestamp = 201);
    client.execute_operation(&admin, &id);

    let op = client.get_operation(&id).unwrap();
    assert_eq!(op.status, STATUS_EXECUTED);
}

#[test]
#[should_panic(expected = "timelock delay has not expired yet")]
fn test_execute_before_delay_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);
    // time is still 0, execute_after is 200
    client.execute_operation(&admin, &id);
}

#[test]
#[should_panic(expected = "operation execution window has expired")]
fn test_execute_after_grace_period_expires() {
    let env = Env::default();
    env.mock_all_auths();

    // short grace = 100 seconds
    let (client, admin, _) = setup(&env, 100, 100, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);

    // jump past execute_after(200) + grace(100) = 301
    env.ledger().with_mut(|l| l.timestamp = 400);
    client.execute_operation(&admin, &id);
}

#[test]
fn test_execute_updates_analytics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);
    env.ledger().with_mut(|l| l.timestamp = 300);
    client.execute_operation(&admin, &id);

    let analytics = client.get_analytics();
    assert_eq!(analytics.total_scheduled, 1);
    assert_eq!(analytics.total_executed, 1);
    assert_eq!(analytics.total_cancelled, 0);
    // last execution timestamp set
    assert_eq!(client.get_last_execution_timestamp(), 300);
}

// ─── Cancellation ─────────────────────────────────────────────────────────────

#[test]
fn test_cancel_operation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);
    client.cancel_operation(&admin, &id);

    let op = client.get_operation(&id).unwrap();
    assert_eq!(op.status, STATUS_CANCELLED);

    let analytics = client.get_analytics();
    assert_eq!(analytics.total_cancelled, 1);
}

#[test]
#[should_panic(expected = "operation is not in scheduled state")]
fn test_cancel_already_cancelled_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);
    client.cancel_operation(&admin, &id);
    client.cancel_operation(&admin, &id); // second cancel → panic
}

// ─── Acceleration & Quorum Voting ─────────────────────────────────────────────

#[test]
fn test_acceleration_reaches_quorum() {
    let env = Env::default();
    env.mock_all_auths();

    // quorum = 2, 3 governors
    let (client, admin, govs) = setup(&env, 100, 3600, 2, 3);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);

    // First vote — quorum not yet reached
    client.vote_accelerate(&govs.get(0).unwrap(), &id);
    let op = client.get_operation(&id).unwrap();
    assert_eq!(op.status, STATUS_SCHEDULED);

    // Second vote — quorum reached → executed
    client.vote_accelerate(&govs.get(1).unwrap(), &id);
    let op2 = client.get_operation(&id).unwrap();
    assert_eq!(op2.status, STATUS_EXECUTED);

    let analytics = client.get_analytics();
    assert_eq!(analytics.total_accelerated, 1);
    assert_eq!(analytics.total_executed, 1);
}

#[test]
#[should_panic(expected = "already voted to accelerate this operation")]
fn test_double_vote_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 3, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);
    client.vote_accelerate(&admin, &id);
    client.vote_accelerate(&admin, &id); // duplicate
}

#[test]
fn test_single_governor_quorum_one_accelerates_immediately() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);
    client.vote_accelerate(&admin, &id);

    let op = client.get_operation(&id).unwrap();
    assert_eq!(op.status, STATUS_EXECUTED);
}

#[test]
fn test_get_accel_votes_returns_voters() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, govs) = setup(&env, 100, 3600, 3, 3);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);
    client.vote_accelerate(&govs.get(0).unwrap(), &id);
    client.vote_accelerate(&govs.get(1).unwrap(), &id);

    let votes = client.get_accel_votes(&id);
    assert_eq!(votes.len(), 2);
}

// ─── Governance Override ──────────────────────────────────────────────────────

#[test]
fn test_governance_override_execute() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);
    client.governance_override(&admin, &id, &true, &symbol_short!("emergency"));

    let op = client.get_operation(&id).unwrap();
    assert_eq!(op.status, STATUS_EXECUTED);
}

#[test]
fn test_governance_override_cancel() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);
    client.governance_override(&admin, &id, &false, &symbol_short!("vetoed"));

    let op = client.get_operation(&id).unwrap();
    assert_eq!(op.status, STATUS_CANCELLED);
}

#[test]
#[should_panic(expected = "only admin may invoke governance override")]
fn test_governance_override_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, govs) = setup(&env, 100, 3600, 1, 2);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);

    let non_admin = govs.get(1).unwrap();
    client.governance_override(&non_admin, &id, &true, &symbol_short!("hack"));
}

// ─── Governor Management ──────────────────────────────────────────────────────

#[test]
fn test_add_and_remove_governor() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let new_gov = Address::generate(&env);

    client.add_governor(&admin, &new_gov);
    assert!(client.is_governor(&new_gov));
    assert_eq!(client.get_governors().len(), 2);

    client.remove_governor(&admin, &new_gov);
    assert!(!client.is_governor(&new_gov));
    assert_eq!(client.get_governors().len(), 1);
}

#[test]
#[should_panic(expected = "address is already a governor")]
fn test_add_duplicate_governor_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    client.add_governor(&admin, &admin); // admin already in list
}

#[test]
#[should_panic(expected = "cannot remove the last governor")]
fn test_remove_last_governor_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    client.remove_governor(&admin, &admin);
}

#[test]
#[should_panic(expected = "only admin can add governors")]
fn test_non_admin_add_governor_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, govs) = setup(&env, 100, 3600, 1, 2);
    let new_gov = Address::generate(&env);
    let non_admin = govs.get(1).unwrap();
    client.add_governor(&non_admin, &new_gov);
}

// ─── Configuration Updates ────────────────────────────────────────────────────

#[test]
fn test_update_min_delay() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    client.update_min_delay(&admin, &500);
    assert_eq!(client.get_min_delay(), 500);
}

#[test]
fn test_update_grace_period() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    client.update_grace_period(&admin, &7200);
    assert_eq!(client.get_grace_period(), 7200);
}

#[test]
#[should_panic(expected = "grace period must be > 0")]
fn test_update_grace_period_zero_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    client.update_grace_period(&admin, &0);
}

#[test]
fn test_update_accel_quorum() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    client.update_accel_quorum(&admin, &3);
    assert_eq!(client.get_accel_quorum(), 3);
}

#[test]
#[should_panic(expected = "quorum must be > 0")]
fn test_update_quorum_zero_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    client.update_accel_quorum(&admin, &0);
}

// ─── Analytics & Monitoring ───────────────────────────────────────────────────

#[test]
fn test_analytics_tracks_all_operations() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, govs) = setup(&env, 100, 3600, 2, 3);
    let target = Address::generate(&env);

    let id1 = make_id(&env, 1);
    let id2 = make_id(&env, 2);
    let id3 = make_id(&env, 3);

    // Schedule 3 ops in different categories
    let func = symbol_short!("exec");
    let args = Bytes::new(&env);
    let desc = symbol_short!("op");

    client.schedule_operation(
        &admin,
        &id1,
        &target,
        &func,
        &args,
        &200,
        &desc,
        &CATEGORY_TREASURY,
        &PRIORITY_HIGH,
        &0u64,
    );
    client.schedule_operation(
        &admin,
        &id2,
        &target,
        &func,
        &args,
        &200,
        &desc,
        &CATEGORY_UPGRADE,
        &PRIORITY_CRITICAL,
        &0u64,
    );
    client.schedule_operation(
        &admin,
        &id3,
        &target,
        &func,
        &args,
        &200,
        &desc,
        &CATEGORY_GENERAL,
        &PRIORITY_LOW,
        &0u64,
    );

    assert_eq!(client.get_active_count(), 3);

    // Execute id1
    env.ledger().with_mut(|l| l.timestamp = 300);
    client.execute_operation(&admin, &id1);

    // Cancel id2
    client.cancel_operation(&admin, &id2);

    // Accelerate id3 (quorum=2 → need 2 votes)
    client.vote_accelerate(&govs.get(0).unwrap(), &id3);
    client.vote_accelerate(&govs.get(1).unwrap(), &id3);

    let analytics = client.get_analytics();
    assert_eq!(analytics.total_scheduled, 3);
    assert_eq!(analytics.total_executed, 2); // id1 + id3 (accelerated)
    assert_eq!(analytics.total_cancelled, 1);
    assert_eq!(analytics.total_accelerated, 1);
    assert_eq!(client.get_active_count(), 0);

    // Category stats
    let treasury_stats = client.get_category_stats(&CATEGORY_TREASURY);
    assert_eq!(treasury_stats.scheduled, 1);
    assert_eq!(treasury_stats.executed, 1);

    let upgrade_stats = client.get_category_stats(&CATEGORY_UPGRADE);
    assert_eq!(upgrade_stats.cancelled, 1);
}

#[test]
fn test_average_delay_calculation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    assert_eq!(client.get_average_delay(), 0); // no executions yet

    schedule_default(&client, &admin, &id, &target, &env); // scheduled at t=0
    env.ledger().with_mut(|l| l.timestamp = 300); // executed at t=300
    client.execute_operation(&admin, &id);

    assert_eq!(client.get_average_delay(), 300); // 300 - 0 = 300
}

#[test]
fn test_monitoring_snapshot_emitted() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 100, 3600, 1, 1);
    let target = Address::generate(&env);
    let id = make_id(&env, 1);

    schedule_default(&client, &admin, &id, &target, &env);
    env.ledger().with_mut(|l| l.timestamp = 201);
    client.execute_operation(&admin, &id);

    // Should not panic; event is emitted
    client.emit_snapshot();
}

// ─── Priority & Category Scheduling ──────────────────────────────────────────

#[test]
fn test_all_categories_and_priorities_schedule() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup(&env, 10, 3600, 1, 1);
    let target = Address::generate(&env);
    let func = symbol_short!("exec");
    let args = Bytes::new(&env);
    let desc = symbol_short!("op");

    let categories = [
        CATEGORY_GENERAL,
        CATEGORY_TREASURY,
        CATEGORY_UPGRADE,
        CATEGORY_GOVERNANCE,
        CATEGORY_EMERGENCY,
    ];
    let priorities = [
        PRIORITY_LOW,
        PRIORITY_MEDIUM,
        PRIORITY_HIGH,
        PRIORITY_CRITICAL,
    ];

    let mut seed = 10u8;
    for cat in categories.iter() {
        for pri in priorities.iter() {
            let id = make_id(&env, seed);
            seed += 1;
            client.schedule_operation(
                &admin, &id, &target, &func, &args, &20, &desc, cat, pri, &0u64,
            );
            let op = client.get_operation(&id).unwrap();
            assert_eq!(op.category, *cat);
            assert_eq!(op.priority, *pri);
        }
    }
}

// ─── Full Workflow Test ───────────────────────────────────────────────────────

#[test]
fn test_full_governance_workflow() {
    let env = Env::default();
    env.mock_all_auths();

    // 3 governors, quorum = 2
    let (client, admin, govs) = setup(&env, 60, 1800, 2, 3);
    let target = Address::generate(&env);

    // Gov-1 proposes an upgrade operation
    let id = make_id(&env, 99);
    let func = symbol_short!("upgrade");
    let args = Bytes::new(&env);
    let desc = symbol_short!("v2");

    client.schedule_operation(
        &govs.get(1).unwrap(),
        &id,
        &target,
        &func,
        &args,
        &120,
        &desc,
        &CATEGORY_UPGRADE,
        &PRIORITY_CRITICAL,
        &0u64,
    );

    let op = client.get_operation(&id).unwrap();
    assert_eq!(op.proposer, govs.get(1).unwrap());
    assert_eq!(op.status, STATUS_SCHEDULED);

    // Gov-0 and Gov-2 vote to accelerate
    client.vote_accelerate(&govs.get(0).unwrap(), &id);
    let op_mid = client.get_operation(&id).unwrap();
    assert_eq!(op_mid.status, STATUS_SCHEDULED); // only 1 vote so far

    client.vote_accelerate(&govs.get(2).unwrap(), &id);
    let op_final = client.get_operation(&id).unwrap();
    assert_eq!(op_final.status, STATUS_EXECUTED); // quorum reached

    // Verify analytics
    let analytics = client.get_analytics();
    assert_eq!(analytics.total_accelerated, 1);
    assert_eq!(analytics.total_executed, 1);

    // Add a 4th governor and verify
    let new_gov = Address::generate(&env);
    client.add_governor(&admin, &new_gov);
    assert_eq!(client.get_governors().len(), 4);
    assert!(client.is_governor(&new_gov));
}

// ─── Emergency stop (#877) ─────────────────────────────────────────────────

#[test]
fn test_pause_round_trip() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _govs) = setup(&env, 100, 3600, 2, 2);

    assert!(!client.is_paused());
    client.set_paused(&admin, &true);
    assert!(client.is_paused());
    client.set_paused(&admin, &false);
    assert!(!client.is_paused());
}

#[test]
#[should_panic(expected = "only admin can perform this action")]
fn test_pause_by_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _govs) = setup(&env, 100, 3600, 2, 2);

    let intruder = Address::generate(&env);
    client.set_paused(&intruder, &true);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_schedule_blocked_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, govs) = setup(&env, 0, 3600, 2, 2);

    client.set_paused(&admin, &true);

    let target = Address::generate(&env);
    schedule_default(
        &client,
        &govs.get(0).unwrap(),
        &make_id(&env, 1),
        &target,
        &env,
    );
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_execute_blocked_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, govs) = setup(&env, 0, 3600, 2, 2);

    let target = Address::generate(&env);
    let id = make_id(&env, 2);
    schedule_default(&client, &govs.get(0).unwrap(), &id, &target, &env);

    client.set_paused(&admin, &true);
    client.execute_operation(&govs.get(0).unwrap(), &id);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_vote_accelerate_blocked_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, govs) = setup(&env, 0, 3600, 2, 2);

    let target = Address::generate(&env);
    let id = make_id(&env, 3);
    schedule_default(&client, &govs.get(0).unwrap(), &id, &target, &env);

    client.set_paused(&admin, &true);
    client.vote_accelerate(&govs.get(1).unwrap(), &id);
}

#[test]
fn test_reads_work_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, govs) = setup(&env, 0, 3600, 2, 2);

    let target = Address::generate(&env);
    let id = make_id(&env, 4);
    schedule_default(&client, &govs.get(0).unwrap(), &id, &target, &env);

    client.set_paused(&admin, &true);

    // Read entry points must stay available during an emergency stop.
    assert!(client.is_paused());
    let op = client.get_operation(&id).expect("operation must exist");
    assert_eq!(op.status, STATUS_SCHEDULED);
    assert_eq!(client.get_active_count(), 1);
    assert_eq!(client.get_governors().len(), 2);
    assert_eq!(client.get_analytics().total_scheduled, 1);
}

#[test]
fn test_unpause_restores_mutations() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, govs) = setup(&env, 0, 3600, 2, 2);

    client.set_paused(&admin, &true);
    client.set_paused(&admin, &false);

    let target = Address::generate(&env);
    let id = make_id(&env, 5);
    schedule_default(&client, &govs.get(0).unwrap(), &id, &target, &env);
    assert_eq!(client.get_active_count(), 1);
}
