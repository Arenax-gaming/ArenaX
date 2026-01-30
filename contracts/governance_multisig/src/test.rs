#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, Symbol, Vec};

// ============================================================================
// Test Helpers
// ============================================================================

fn create_test_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    (env, signer1, signer2, signer3)
}

fn initialize_contract(
    env: &Env,
    signers: Vec<Address>,
    threshold: u32,
) -> Address {
    let contract_id = env.register(GovernanceMultisig, ());
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.initialize(&signers, &threshold);

    contract_id
}

fn generate_proposal_id(env: &Env, seed: u32) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0..4].copy_from_slice(&seed.to_be_bytes());
    BytesN::from_array(&env, &bytes)
}

fn create_empty_args(env: &Env) -> Bytes {
    Bytes::new(env)
}

// ============================================================================
// Initialization Tests
// ============================================================================

#[test]
fn test_initialize_success() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let contract_id = env.register(GovernanceMultisig, ());
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    client.initialize(&signers, &2);

    // Verify initialization
    let config = client.get_config();
    assert_eq!(config.threshold, 2);
    assert_eq!(config.max_signers, 20);

    assert_eq!(client.get_signer_count(), 3);
    assert!(client.is_signer(&signer1));
    assert!(client.is_signer(&signer2));
    assert!(client.is_signer(&signer3));
}

#[test]
fn test_initialize_twice_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let contract_id = env.register(GovernanceMultisig, ());
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initialize(&signers, &2);

    // Second initialization should fail
    let result = client.try_initialize(&signers, &2);
    assert_eq!(result, Err(Ok(GovernanceError::AlreadyInitialized)));
}

#[test]
fn test_initialize_empty_signers_fails() {
    let (env, _, _, _) = create_test_env();
    env.mock_all_auths();

    let contract_id = env.register(GovernanceMultisig, ());
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let signers: Vec<Address> = Vec::new(&env);

    let result = client.try_initialize(&signers, &1);
    assert_eq!(result, Err(Ok(GovernanceError::EmptySignerList)));
}

#[test]
fn test_initialize_zero_threshold_fails() {
    let (env, signer1, _, _) = create_test_env();
    env.mock_all_auths();

    let contract_id = env.register(GovernanceMultisig, ());
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());

    let result = client.try_initialize(&signers, &0);
    assert_eq!(result, Err(Ok(GovernanceError::InvalidThreshold)));
}

#[test]
fn test_initialize_threshold_exceeds_signers_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let contract_id = env.register(GovernanceMultisig, ());
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let result = client.try_initialize(&signers, &3);
    assert_eq!(result, Err(Ok(GovernanceError::ThresholdExceedsSigners)));
}

// ============================================================================
// Proposal Tests
// ============================================================================

#[test]
fn test_propose_success() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(
        &signer1,
        &proposal_id,
        &target,
        &function,
        &args,
        &None,
    );

    // Verify proposal was created
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.proposer, signer1);
    assert_eq!(proposal.target_contract, target);
    assert_eq!(proposal.status, ProposalStatus::Pending as u32);
    assert_eq!(proposal.approval_count, 0);
}

#[test]
fn test_propose_duplicate_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(
        &signer1,
        &proposal_id,
        &target,
        &function,
        &args,
        &None,
    );

    // Second proposal with same ID should fail
    let result = client.try_create_proposal(
        &signer1,
        &proposal_id,
        &target,
        &function,
        &args,
        &None,
    );
    assert_eq!(result, Err(Ok(GovernanceError::ProposalAlreadyExists)));
}

#[test]
fn test_propose_self_call_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    // Try to target the governance contract itself
    let result = client.try_create_proposal(
        &signer1,
        &proposal_id,
        &contract_id,  // targeting self
        &function,
        &args,
        &None,
    );
    assert_eq!(result, Err(Ok(GovernanceError::SelfCallNotAllowed)));
}

#[test]
fn test_propose_non_signer_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);
    let non_signer = Address::generate(&env);

    let result = client.try_create_proposal(
        &non_signer,
        &proposal_id,
        &target,
        &function,
        &args,
        &None,
    );
    assert_eq!(result, Err(Ok(GovernanceError::NotASigner)));
}

// ============================================================================
// Approval Tests
// ============================================================================

#[test]
fn test_approve_success() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);

    // First approval
    client.approve(&signer1, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.approval_count, 1);
    assert_eq!(proposal.status, ProposalStatus::Pending as u32);

    // Check approvals list
    let approvals = client.get_proposal_approvals(&proposal_id);
    assert_eq!(approvals.len(), 1);
}

#[test]
fn test_approve_reaches_threshold() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);

    client.approve(&signer1, &proposal_id);
    client.approve(&signer2, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.approval_count, 2);
    assert_eq!(proposal.status, ProposalStatus::Approved as u32);
}

#[test]
fn test_approve_duplicate_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);
    client.approve(&signer1, &proposal_id);

    // Second approval from same signer should fail
    let result = client.try_approve(&signer1, &proposal_id);
    assert_eq!(result, Err(Ok(GovernanceError::AlreadyApproved)));
}

#[test]
fn test_approve_nonexistent_proposal_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 999);

    let result = client.try_approve(&signer1, &proposal_id);
    assert_eq!(result, Err(Ok(GovernanceError::ProposalNotFound)));
}

// ============================================================================
// Revoke Tests
// ============================================================================

#[test]
fn test_revoke_approval_success() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);
    client.approve(&signer1, &proposal_id);

    // Revoke
    client.revoke_approval(&signer1, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.approval_count, 0);
    assert_eq!(proposal.status, ProposalStatus::Pending as u32);

    let approvals = client.get_proposal_approvals(&proposal_id);
    assert_eq!(approvals.len(), 0);
}

#[test]
fn test_revoke_reverts_to_pending() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);
    client.approve(&signer1, &proposal_id);
    client.approve(&signer2, &proposal_id);

    // Status should be Approved now
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved as u32);

    // Revoke one approval
    client.revoke_approval(&signer2, &proposal_id);

    // Status should revert to Pending
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending as u32);
    assert_eq!(proposal.approval_count, 1);
}

#[test]
fn test_revoke_without_approval_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);

    // Try to revoke without approving first
    let result = client.try_revoke_approval(&signer1, &proposal_id);
    assert_eq!(result, Err(Ok(GovernanceError::NotApproved)));
}

// ============================================================================
// Execution Tests
// ============================================================================

#[test]
fn test_execute_without_threshold_fails() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);
    client.approve(&signer1, &proposal_id);

    // Try to execute with only 1 approval (need 2)
    let result = client.try_execute(&signer1, &proposal_id);
    assert_eq!(result, Err(Ok(GovernanceError::InsufficientApprovals)));
}

#[test]
fn test_execute_before_time_delay_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    // Set execute_after to a future time
    let future_time = env.ledger().timestamp() + 1000;
    client.create_proposal(
        &signer1,
        &proposal_id,
        &target,
        &function,
        &args,
        &Some(future_time),
    );

    client.approve(&signer1, &proposal_id);
    client.approve(&signer2, &proposal_id);

    // Try to execute before the time delay
    let result = client.try_execute(&signer1, &proposal_id);
    assert_eq!(result, Err(Ok(GovernanceError::ExecutionTooEarly)));
}

#[test]
fn test_execute_cancelled_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);
    client.approve(&signer1, &proposal_id);
    client.approve(&signer2, &proposal_id);

    // Cancel the proposal
    client.cancel_proposal(&signer1, &proposal_id);

    // Try to execute cancelled proposal
    let result = client.try_execute(&signer1, &proposal_id);
    assert_eq!(result, Err(Ok(GovernanceError::ProposalCancelled)));
}

// ============================================================================
// Cancel Tests
// ============================================================================

#[test]
fn test_cancel_proposal_success() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);

    // Proposer cancels
    client.cancel_proposal(&signer1, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Cancelled as u32);
}

#[test]
fn test_cancel_not_proposer_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);

    // signer2 tries to cancel (not the proposer)
    let result = client.try_cancel_proposal(&signer2, &proposal_id);
    assert_eq!(result, Err(Ok(GovernanceError::Unauthorized)));
}

// ============================================================================
// Edge Cases
// ============================================================================

#[test]
fn test_1_of_1_threshold() {
    let (env, signer1, _, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());

    let contract_id = initialize_contract(&env, signers, 1);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);
    client.approve(&signer1, &proposal_id);

    // With 1-of-1, single approval should make it approved
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved as u32);
}

#[test]
fn test_n_of_n_threshold() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let contract_id = initialize_contract(&env, signers, 3);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);

    client.approve(&signer1, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending as u32);

    client.approve(&signer2, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending as u32);

    client.approve(&signer3, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved as u32);
}

#[test]
fn test_is_signer() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    assert!(client.is_signer(&signer1));
    assert!(client.is_signer(&signer2));
    assert!(!client.is_signer(&signer3)); // Not a signer
}

#[test]
fn test_get_nonexistent_proposal_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 999);

    let result = client.try_get_proposal(&proposal_id);
    assert_eq!(result, Err(Ok(GovernanceError::ProposalNotFound)));
}

#[test]
fn test_get_signers() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let contract_id = initialize_contract(&env, signers.clone(), 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let retrieved_signers = client.get_signers();
    assert_eq!(retrieved_signers.len(), 3);
}

#[test]
fn test_get_threshold() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    assert_eq!(client.get_threshold(), 2);
}

// ============================================================================
// Internal Governance Function Tests
// ============================================================================

#[test]
fn test_internal_add_signer_success() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);

    // Add a new signer
    client.internal_add_signer(&proposal_id, &signer3);

    assert!(client.is_signer(&signer3));
    assert_eq!(client.get_signer_count(), 3);
}

#[test]
fn test_internal_add_signer_already_exists_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);

    // Try to add existing signer
    let result = client.try_internal_add_signer(&proposal_id, &signer1);
    assert_eq!(result, Err(Ok(GovernanceError::SignerAlreadyExists)));
}

#[test]
fn test_internal_remove_signer_success() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);

    // Remove a signer
    client.internal_remove_signer(&proposal_id, &signer3);

    assert!(!client.is_signer(&signer3));
    assert_eq!(client.get_signer_count(), 2);
}

#[test]
fn test_internal_remove_last_signer_fails() {
    let (env, signer1, _, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());

    let contract_id = initialize_contract(&env, signers, 1);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);

    // Try to remove the last signer
    let result = client.try_internal_remove_signer(&proposal_id, &signer1);
    assert_eq!(result, Err(Ok(GovernanceError::CannotRemoveLastSigner)));
}

#[test]
fn test_internal_remove_signer_threshold_violation_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    // 2-of-2 threshold
    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);

    // Try to remove a signer when threshold would exceed signers
    let result = client.try_internal_remove_signer(&proposal_id, &signer1);
    assert_eq!(result, Err(Ok(GovernanceError::ThresholdExceedsSigners)));
}

#[test]
fn test_internal_update_threshold_success() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);

    // Update threshold from 2 to 3
    client.internal_update_threshold(&proposal_id, &3);

    assert_eq!(client.get_threshold(), 3);
}

#[test]
fn test_internal_update_threshold_zero_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);

    let result = client.try_internal_update_threshold(&proposal_id, &0);
    assert_eq!(result, Err(Ok(GovernanceError::InvalidThreshold)));
}

#[test]
fn test_internal_update_threshold_exceeds_signers_fails() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let proposal_id = generate_proposal_id(&env, 1);

    let result = client.try_internal_update_threshold(&proposal_id, &5);
    assert_eq!(result, Err(Ok(GovernanceError::ThresholdExceedsSigners)));
}

// ============================================================================
// Query Function Tests on Uninitialized Contract
// ============================================================================

#[test]
fn test_query_uninitialized_contract() {
    let (env, signer1, _, _) = create_test_env();

    let contract_id = env.register(GovernanceMultisig, ());
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    // is_signer should return false on uninitialized
    assert!(!client.is_signer(&signer1));

    // get_signers should fail
    let result = client.try_get_signers();
    assert_eq!(result, Err(Ok(GovernanceError::NotInitialized)));

    // get_threshold should fail
    let result = client.try_get_threshold();
    assert_eq!(result, Err(Ok(GovernanceError::NotInitialized)));

    // get_config should fail
    let result = client.try_get_config();
    assert_eq!(result, Err(Ok(GovernanceError::NotInitialized)));
}

// ============================================================================
// Proposal Workflow Complete Test
// ============================================================================

#[test]
fn test_complete_proposal_workflow() {
    let (env, signer1, signer2, signer3) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    // Verify initial state
    assert_eq!(client.get_signer_count(), 3);
    assert_eq!(client.get_threshold(), 2);

    // Create proposal
    let proposal_id = generate_proposal_id(&env, 1);
    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    client.create_proposal(&signer1, &proposal_id, &target, &function, &args, &None);

    // Verify pending state
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending as u32);
    assert_eq!(proposal.approval_count, 0);

    // First approval
    client.approve(&signer1, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending as u32);
    assert_eq!(proposal.approval_count, 1);

    // Second approval - reaches threshold
    client.approve(&signer2, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved as u32);
    assert_eq!(proposal.approval_count, 2);

    // Verify approvals list
    let approvals = client.get_proposal_approvals(&proposal_id);
    assert_eq!(approvals.len(), 2);
}

#[test]
fn test_multiple_proposals() {
    let (env, signer1, signer2, _) = create_test_env();
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let contract_id = initialize_contract(&env, signers, 2);
    let client = GovernanceMultisigClient::new(&env, &contract_id);

    let target = Address::generate(&env);
    let function = Symbol::new(&env, "test_func");
    let args = create_empty_args(&env);

    // Create multiple proposals
    let proposal_id_1 = generate_proposal_id(&env, 1);
    let proposal_id_2 = generate_proposal_id(&env, 2);
    let proposal_id_3 = generate_proposal_id(&env, 3);

    client.create_proposal(&signer1, &proposal_id_1, &target, &function, &args, &None);
    client.create_proposal(&signer2, &proposal_id_2, &target, &function, &args, &None);
    client.create_proposal(&signer1, &proposal_id_3, &target, &function, &args, &None);

    // Verify all proposals exist
    let p1 = client.get_proposal(&proposal_id_1);
    let p2 = client.get_proposal(&proposal_id_2);
    let p3 = client.get_proposal(&proposal_id_3);

    assert_eq!(p1.proposer, signer1);
    assert_eq!(p2.proposer, signer2);
    assert_eq!(p3.proposer, signer1);

    // Approve different proposals
    client.approve(&signer1, &proposal_id_1);
    client.approve(&signer2, &proposal_id_1);
    client.approve(&signer1, &proposal_id_2);

    // Verify states
    let p1 = client.get_proposal(&proposal_id_1);
    let p2 = client.get_proposal(&proposal_id_2);
    let p3 = client.get_proposal(&proposal_id_3);

    assert_eq!(p1.status, ProposalStatus::Approved as u32);
    assert_eq!(p2.status, ProposalStatus::Pending as u32);
    assert_eq!(p3.status, ProposalStatus::Pending as u32);
}
