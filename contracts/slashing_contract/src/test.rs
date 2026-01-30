#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

// ============================================================================
// Test Helpers
// ============================================================================

fn create_test_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    (env, admin, user1, user2)
}

fn initialize_contract(env: &Env, admin: &Address) -> Address {
    let contract_id = env.register(SlashingContract, ());
    let client = SlashingContractClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.initialize(admin);

    contract_id
}

fn generate_case_id(env: &Env, seed: u32) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0..4].copy_from_slice(&seed.to_be_bytes());
    BytesN::from_array(&env, &bytes)
}

fn generate_evidence_hash(env: &Env, seed: u32) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[28..32].copy_from_slice(&seed.to_be_bytes());
    BytesN::from_array(&env, &bytes)
}

// ============================================================================
// Initialization Tests
// ============================================================================

#[test]
fn test_initialize_success() {
    let (env, admin, _, _) = create_test_env();
    env.mock_all_auths();

    let contract_id = env.register(SlashingContract, ());
    let client = SlashingContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Verify initialization by trying to set identity contract (admin-only operation)
    let identity_contract = Address::generate(&env);
    client.set_identity_contract(&identity_contract);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_fails() {
    let (env, admin, _, _) = create_test_env();
    env.mock_all_auths();

    let contract_id = env.register(SlashingContract, ());
    let client = SlashingContractClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.initialize(&admin); // Should panic
}

#[test]
fn test_set_identity_contract() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let identity_contract = Address::generate(&env);

    env.mock_all_auths();
    client.set_identity_contract(&identity_contract);
}

#[test]
fn test_set_escrow_contract() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let escrow_contract = Address::generate(&env);

    env.mock_all_auths();
    client.set_escrow_contract(&escrow_contract);
}

// ============================================================================
// Case Management Tests
// ============================================================================

#[test]
fn test_open_case_success() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);
    let reason_code = 100; // Cheating

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &reason_code, &evidence_hash);

    // Verify case was created
    let case = client.get_case(&case_id);
    assert_eq!(case.subject, user1);
    assert_eq!(case.reason_code, reason_code);
    assert_eq!(case.status, SlashStatus::Proposed as u32);
    assert_eq!(case.resolved_at, None);
}

#[test]
#[should_panic(expected = "case already exists")]
fn test_open_case_duplicate_fails() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.open_case(&case_id, &user1, &100, &evidence_hash); // Should panic
}

#[test]
fn test_approve_case_success() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.approve_case(&case_id);

    // Verify case was approved
    let case = client.get_case(&case_id);
    assert_eq!(case.status, SlashStatus::Approved as u32);
}

#[test]
#[should_panic(expected = "case not found")]
fn test_approve_nonexistent_case_fails() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 999);

    env.mock_all_auths();
    client.approve_case(&case_id); // Should panic
}

#[test]
#[should_panic(expected = "invalid case status")]
fn test_approve_already_approved_case_fails() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.approve_case(&case_id);
    client.approve_case(&case_id); // Should panic
}

#[test]
fn test_cancel_case_success() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.cancel_case(&case_id);

    // Verify case was cancelled
    let case = client.get_case(&case_id);
    assert_eq!(case.status, SlashStatus::Cancelled as u32);
    assert!(case.resolved_at.is_some());
}

#[test]
#[should_panic(expected = "can only cancel proposed cases")]
fn test_cancel_approved_case_fails() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.approve_case(&case_id);
    client.cancel_case(&case_id); // Should panic
}

// ============================================================================
// Penalty Execution Tests
// ============================================================================

#[test]
fn test_execute_permanent_ban() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.approve_case(&case_id);

    // Execute permanent ban
    client.execute_penalty(
        &case_id,
        &(PenaltyType::PermanentBan as u32),
        &None,
        &None,
        &None,
    );

    // Verify ban
    assert!(client.is_banned(&user1));

    let ban_record = client.get_ban_record(&user1).unwrap();
    assert!(ban_record.is_permanent);
    assert_eq!(ban_record.expires_at, None);

    // Verify case is executed
    let case = client.get_case(&case_id);
    assert_eq!(case.status, SlashStatus::Executed as u32);
    assert!(case.resolved_at.is_some());
    assert!(client.is_case_executed(&case_id));
}

#[test]
fn test_execute_temporary_suspension() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);
    let duration = 86400u64; // 1 day

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.approve_case(&case_id);

    // Execute temporary suspension
    client.execute_penalty(
        &case_id,
        &(PenaltyType::TemporarySuspension as u32),
        &None,
        &None,
        &Some(duration),
    );

    // Verify suspension
    assert!(client.is_banned(&user1));

    let ban_record = client.get_ban_record(&user1).unwrap();
    assert!(!ban_record.is_permanent);
    assert!(ban_record.expires_at.is_some());
}

#[test]
#[should_panic(expected = "duration required for temporary suspension")]
fn test_execute_temporary_suspension_without_duration_fails() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.approve_case(&case_id);

    // Execute without duration - should panic
    client.execute_penalty(
        &case_id,
        &(PenaltyType::TemporarySuspension as u32),
        &None,
        &None,
        &None,
    );
}

#[test]
#[should_panic(expected = "duration must be positive")]
fn test_execute_temporary_suspension_zero_duration_fails() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.approve_case(&case_id);

    // Execute with zero duration - should panic
    client.execute_penalty(
        &case_id,
        &(PenaltyType::TemporarySuspension as u32),
        &None,
        &None,
        &Some(0),
    );
}

#[test]
#[should_panic(expected = "case not approved")]
fn test_execute_penalty_on_proposed_case_fails() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);

    // Try to execute without approval - should panic
    client.execute_penalty(
        &case_id,
        &(PenaltyType::PermanentBan as u32),
        &None,
        &None,
        &None,
    );
}

#[test]
#[should_panic(expected = "case already executed")]
fn test_double_execution_protection() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.approve_case(&case_id);

    // Execute once
    client.execute_penalty(
        &case_id,
        &(PenaltyType::PermanentBan as u32),
        &None,
        &None,
        &None,
    );

    // Try to execute again - should panic
    client.execute_penalty(
        &case_id,
        &(PenaltyType::PermanentBan as u32),
        &None,
        &None,
        &None,
    );
}

#[test]
#[should_panic(expected = "invalid penalty type")]
fn test_execute_invalid_penalty_type_fails() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.approve_case(&case_id);

    // Execute with invalid penalty type - should panic
    client.execute_penalty(&case_id, &999, &None, &None, &None);
}

#[test]
#[should_panic(expected = "subject already permanently banned")]
fn test_open_case_for_banned_user_fails() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    // Ban user first
    let case_id1 = generate_case_id(&env, 1);
    let evidence_hash1 = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id1, &user1, &100, &evidence_hash1);
    client.approve_case(&case_id1);
    client.execute_penalty(
        &case_id1,
        &(PenaltyType::PermanentBan as u32),
        &None,
        &None,
        &None,
    );

    // Try to open another case for banned user - should panic
    let case_id2 = generate_case_id(&env, 2);
    let evidence_hash2 = generate_evidence_hash(&env, 2);
    client.open_case(&case_id2, &user1, &101, &evidence_hash2);
}

// ============================================================================
// Ban Status Tests
// ============================================================================

#[test]
fn test_is_banned_returns_false_for_unbanned_user() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    assert!(!client.is_banned(&user1));
}

#[test]
fn test_is_banned_returns_true_for_permanently_banned_user() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.approve_case(&case_id);
    client.execute_penalty(
        &case_id,
        &(PenaltyType::PermanentBan as u32),
        &None,
        &None,
        &None,
    );

    assert!(client.is_banned(&user1));
}

#[test]
fn test_get_ban_record_returns_none_for_unbanned_user() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    assert_eq!(client.get_ban_record(&user1), None);
}

#[test]
fn test_is_case_executed_returns_false_for_new_case() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);

    assert!(!client.is_case_executed(&case_id));
}

#[test]
fn test_is_case_executed_returns_true_after_execution() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);

    env.mock_all_auths();
    client.open_case(&case_id, &user1, &100, &evidence_hash);
    client.approve_case(&case_id);
    client.execute_penalty(
        &case_id,
        &(PenaltyType::PermanentBan as u32),
        &None,
        &None,
        &None,
    );

    assert!(client.is_case_executed(&case_id));
}

// ============================================================================
// Edge Case Tests
// ============================================================================

#[test]
fn test_multiple_cases_for_different_users() {
    let (env, admin, user1, user2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id1 = generate_case_id(&env, 1);
    let case_id2 = generate_case_id(&env, 2);
    let evidence_hash1 = generate_evidence_hash(&env, 1);
    let evidence_hash2 = generate_evidence_hash(&env, 2);

    env.mock_all_auths();

    // Open cases for both users
    client.open_case(&case_id1, &user1, &100, &evidence_hash1);
    client.open_case(&case_id2, &user2, &101, &evidence_hash2);

    // Approve and execute both
    client.approve_case(&case_id1);
    client.approve_case(&case_id2);

    client.execute_penalty(
        &case_id1,
        &(PenaltyType::PermanentBan as u32),
        &None,
        &None,
        &None,
    );

    client.execute_penalty(
        &case_id2,
        &(PenaltyType::TemporarySuspension as u32),
        &None,
        &None,
        &Some(3600),
    );

    // Verify both are banned
    assert!(client.is_banned(&user1));
    assert!(client.is_banned(&user2));

    // Verify ban types
    let ban1 = client.get_ban_record(&user1).unwrap();
    let ban2 = client.get_ban_record(&user2).unwrap();

    assert!(ban1.is_permanent);
    assert!(!ban2.is_permanent);
}

#[test]
fn test_case_workflow_complete() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let case_id = generate_case_id(&env, 1);
    let evidence_hash = generate_evidence_hash(&env, 1);
    let reason_code = 100;

    env.mock_all_auths();

    // Step 1: Open case
    client.open_case(&case_id, &user1, &reason_code, &evidence_hash);
    let case = client.get_case(&case_id);
    assert_eq!(case.status, SlashStatus::Proposed as u32);
    assert!(!client.is_banned(&user1));

    // Step 2: Approve case
    client.approve_case(&case_id);
    let case = client.get_case(&case_id);
    assert_eq!(case.status, SlashStatus::Approved as u32);
    assert!(!client.is_banned(&user1));

    // Step 3: Execute penalty
    client.execute_penalty(
        &case_id,
        &(PenaltyType::PermanentBan as u32),
        &None,
        &None,
        &None,
    );
    let case = client.get_case(&case_id);
    assert_eq!(case.status, SlashStatus::Executed as u32);
    assert!(case.resolved_at.is_some());
    assert!(client.is_banned(&user1));
    assert!(client.is_case_executed(&case_id));
}

#[test]
fn test_reason_codes_preserved() {
    let (env, admin, user1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = SlashingContractClient::new(&env, &contract_id);

    let test_cases = [
        (1, 100), // Cheating
        (2, 200), // Collusion
        (3, 300), // Match fixing
        (4, 400), // Referee misconduct
        (5, 500), // Protocol abuse
    ];

    env.mock_all_auths();

    for (seed, reason_code) in test_cases {
        let case_id = generate_case_id(&env, seed);
        let evidence_hash = generate_evidence_hash(&env, seed);

        client.open_case(&case_id, &user1, &reason_code, &evidence_hash);

        let case = client.get_case(&case_id);
        assert_eq!(case.reason_code, reason_code);
        assert_eq!(case.evidence_hash, evidence_hash);
    }
}
