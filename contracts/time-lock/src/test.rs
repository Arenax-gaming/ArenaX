#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Env, symbol_short};

fn generate_id(env: &Env, seed: u8) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0] = seed;
    BytesN::from_array(env, &bytes)
}

#[test]
fn test_time_lock_workflow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let target = Address::generate(&env);

    let contract_id = env.register(TimeLock, ());
    let client = TimeLockClient::new(&env, &contract_id);

    // Initialize with 100 seconds min delay
    client.initialize(&admin, &100);
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_min_delay(), 100);

    let op_id = generate_id(&env, 1);
    let func = symbol_short!("transfer");
    let args = Bytes::new(&env);
    let description = symbol_short!("governce");

    // Try to schedule with too small delay (should panic)
    // client.schedule_operation(&admin, &op_id, &target, &func, &args, &50, &description);
    
    // Schedule with valid delay
    client.schedule_operation(&admin, &op_id, &target, &func, &args, &200, &description);

    let op = client.get_operation(&op_id).unwrap();
    assert_eq!(op.status, STATUS_SCHEDULED);
    assert_eq!(op.execute_after, env.ledger().timestamp() + 200);

    // Try executing immediately (should panic due to timelock)
    // client.execute_operation(&admin, &op_id);

    // Advance time and execute
    let current_time = env.ledger().timestamp();
    env.ledger().with_mut(|l| l.timestamp = current_time + 201);
    client.execute_operation(&admin, &op_id);

    let op_after = client.get_operation(&op_id).unwrap();
    assert_eq!(op_after.status, STATUS_EXECUTED);
}

#[test]
fn test_time_lock_cancel_and_accelerate() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let target = Address::generate(&env);

    let contract_id = env.register(TimeLock, ());
    let client = TimeLockClient::new(&env, &contract_id);

    client.initialize(&admin, &100);

    let op_id1 = generate_id(&env, 1);
    let op_id2 = generate_id(&env, 2);
    let func = symbol_short!("transfer");
    let args = Bytes::new(&env);
    let description = symbol_short!("governce");

    // Schedule two operations
    client.schedule_operation(&admin, &op_id1, &target, &func, &args, &200, &description);
    client.schedule_operation(&admin, &op_id2, &target, &func, &args, &200, &description);

    // Cancel first
    client.cancel_operation(&admin, &op_id1);
    let op1 = client.get_operation(&op_id1).unwrap();
    assert_eq!(op1.status, STATUS_CANCELLED);

    // Accelerate second
    client.accelerate_operation(&admin, &op_id2);
    let op2 = client.get_operation(&op_id2).unwrap();
    assert_eq!(op2.status, STATUS_EXECUTED);
}
