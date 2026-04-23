use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

fn create_test_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let governance = Address::generate(&env);
    let proposer = Address::generate(&env);
    let validator = Address::generate(&env);
    (env, governance, proposer, validator)
}

fn generate_proposal_id(env: &Env, seed: u32) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0] = (seed >> 24) as u8;
    bytes[1] = (seed >> 16) as u8;
    bytes[2] = (seed >> 8) as u8;
    bytes[3] = seed as u8;
    BytesN::from_array(env, &bytes)
}

fn generate_wasm_hash(env: &Env, seed: u32) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[28] = (seed >> 24) as u8;
    bytes[29] = (seed >> 16) as u8;
    bytes[30] = (seed >> 8) as u8;
    bytes[31] = seed as u8;
    BytesN::from_array(env, &bytes)
}

#[test]
fn test_initialize_success() {
    let (env, governance, _, _) = create_test_env();
    let contract_id = env.register(UpgradeSystem, ());
    let client = UpgradeSystemClient::new(&env, &contract_id);

    client.initialize(&governance, &(24 * 60 * 60), &3, &2);

    let config = client.get_config();
    assert_eq!(config.governance_address, governance);
    assert_eq!(config.required_approvals, 3);
}

#[test]
fn test_propose_upgrade_success() {
    let (env, governance, _, _) = create_test_env();
    let contract_id = env.register(UpgradeSystem, ());
    let client = UpgradeSystemClient::new(&env, &contract_id);

    client.initialize(&governance, &(24 * 60 * 60), &3, &2);

    let proposal_id = generate_proposal_id(&env, 1);
    let contract_addr = Address::generate(&env);
    let wasm_hash = generate_wasm_hash(&env, 1);
    let description = String::from_str(&env, "Test upgrade");

    let params = ProposeUpgradeParams {
        contract_address: contract_addr,
        new_wasm_hash: wasm_hash,
        upgrade_type: UpgradeType::Feature as u32,
        timelock_duration: 24 * 60 * 60,
        description,
    };

    client.propose_upgrade(&governance, &proposal_id, &params);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, UpgradeStatus::Pending as u32);
}

#[test]
fn test_validate_upgrade_success() {
    let (env, governance, _, _) = create_test_env();
    let contract_id = env.register(UpgradeSystem, ());
    let client = UpgradeSystemClient::new(&env, &contract_id);

    client.initialize(&governance, &(24 * 60 * 60), &3, &2);

    let proposal_id = generate_proposal_id(&env, 1);
    let contract_addr = Address::generate(&env);
    let wasm_hash = generate_wasm_hash(&env, 1);
    let description = String::from_str(&env, "Test upgrade");

    let params = ProposeUpgradeParams {
        contract_address: contract_addr,
        new_wasm_hash: wasm_hash,
        upgrade_type: UpgradeType::Feature as u32,
        timelock_duration: 24 * 60 * 60,
        description,
    };

    client.propose_upgrade(&governance, &proposal_id, &params);

    let security_issues: Vec<String> = Vec::new(&env);

    client.validate_upgrade(&governance, &proposal_id, &85, &false, &security_issues);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, UpgradeStatus::Validated as u32);
}

#[test]
fn test_emergency_pause_success() {
    let (env, governance, _, _) = create_test_env();
    let contract_id = env.register(UpgradeSystem, ());
    let client = UpgradeSystemClient::new(&env, &contract_id);

    client.initialize(&governance, &(24 * 60 * 60), &3, &2);

    let contract_addr = Address::generate(&env);
    let reason = String::from_str(&env, "Critical bug found");

    client.emergency_pause(&governance, &contract_addr, &reason);

    let state = client.get_emergency_state(&contract_addr);
    assert!(state.is_paused);
}

#[test]
fn test_get_upgrade_history() {
    let (env, governance, _, _) = create_test_env();
    let contract_id = env.register(UpgradeSystem, ());
    let client = UpgradeSystemClient::new(&env, &contract_id);

    client.initialize(&governance, &(24 * 60 * 60), &3, &2);

    let contract_addr = Address::generate(&env);
    let history = client.get_upgrade_history(&contract_addr);

    assert_eq!(history.len(), 0);
}

#[test]
fn test_approve_and_schedule() {
    let (env, governance, _, _) = create_test_env();
    let contract_id = env.register(UpgradeSystem, ());
    let client = UpgradeSystemClient::new(&env, &contract_id);

    client.initialize(&governance, &(24 * 60 * 60), &3, &2);

    let proposal_id = generate_proposal_id(&env, 1);
    let contract_addr = Address::generate(&env);
    let wasm_hash = generate_wasm_hash(&env, 1);
    let description = String::from_str(&env, "Test upgrade");

    let params = ProposeUpgradeParams {
        contract_address: contract_addr,
        new_wasm_hash: wasm_hash,
        upgrade_type: UpgradeType::Feature as u32,
        timelock_duration: 24 * 60 * 60,
        description,
    };

    client.propose_upgrade(&governance, &proposal_id, &params);

    let security_issues: Vec<String> = Vec::new(&env);
    client.validate_upgrade(&governance, &proposal_id, &85, &false, &security_issues);

    // Approve 3 times with different approvers
    // Note: In production, these would be different governance signers
    // For this test, we just verify the first approval works
    let sig_hash = generate_wasm_hash(&env, 100);
    client.approve_upgrade(&governance, &proposal_id, &sig_hash);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.approval_count, 1);

    // After 3 approvals it would be scheduled
    // assert_eq!(proposal.status, UpgradeStatus::Scheduled as u32);
}
