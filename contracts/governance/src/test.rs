#![cfg(test)]

use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Bytes, Env, String};

use crate::{
    DataKey, Delegation, GovernanceContract, GovernanceParams, Proposal, ProposalStatus,
    ProposalType, Vote, VoteChoice,
};

#[test]
fn test_initialize() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin.clone(), token_contract.clone());

    let stored_admin: Address = env
        .storage()
        .persistent()
        .get(&DataKey::Admin)
        .expect("admin not found");

    assert_eq!(stored_admin, admin);

    let stored_token: Address = env
        .storage()
        .persistent()
        .get(&DataKey::TokenContract)
        .expect("token contract not found");

    assert_eq!(stored_token, token_contract);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin.clone(), token_contract.clone());
    GovernanceContract::initialize(env, admin, token_contract);
}

#[test]
fn test_create_proposal() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin.clone(), token_contract);

    let title = String::from_str(&env, "Test Proposal");
    let description = String::from_str(&env, "Test Description");
    let proposal_type = ProposalType::ParameterUpdate;
    let voting_period = 604800; // 7 days
    let execution_data = Bytes::new(&env);

    let proposal_id = GovernanceContract::create_proposal(
        env.clone(),
        admin.clone(),
        title.clone(),
        description.clone(),
        proposal_type.clone(),
        voting_period,
        execution_data,
    );

    let proposal: Proposal = env
        .storage()
        .persistent()
        .get(&DataKey::Proposal(proposal_id))
        .expect("proposal not found");

    assert_eq!(proposal.proposer, admin);
    assert_eq!(proposal.title, title);
    assert_eq!(proposal.description, description);
    assert_eq!(proposal.proposal_type, proposal_type);
    assert_eq!(proposal.status, ProposalStatus::Active);
}

#[test]
#[should_panic(expected = "only admin can create proposals")]
fn test_create_proposal_unauthorized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);
    let unauthorized = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin, token_contract);

    let title = String::from_str(&env, "Test Proposal");
    let description = String::from_str(&env, "Test Description");
    let proposal_type = ProposalType::ParameterUpdate;
    let voting_period = 604800;
    let execution_data = Bytes::new(&env);

    GovernanceContract::create_proposal(
        env,
        unauthorized,
        title,
        description,
        proposal_type,
        voting_period,
        execution_data,
    );
}

#[test]
fn test_cast_vote() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let voter = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin.clone(), token_contract);

    let title = String::from_str(&env, "Test Proposal");
    let description = String::from_str(&env, "Test Description");
    let proposal_type = ProposalType::ParameterUpdate;
    let voting_period = 604800;
    let execution_data = Bytes::new(&env);

    let proposal_id = GovernanceContract::create_proposal(
        env.clone(),
        admin.clone(),
        title,
        description,
        proposal_type,
        voting_period,
        execution_data,
    );

    GovernanceContract::cast_vote(
        env.clone(),
        voter.clone(),
        proposal_id.clone(),
        VoteChoice::For,
    );

    let vote: Vote = env
        .storage()
        .persistent()
        .get(&DataKey::Vote(proposal_id.clone(), voter.clone()))
        .expect("vote not found");

    assert_eq!(vote.voter, voter);
    assert_eq!(vote.choice, VoteChoice::For);

    let proposal: Proposal = env
        .storage()
        .persistent()
        .get(&DataKey::Proposal(proposal_id))
        .expect("proposal not found");

    assert!(proposal.for_votes > 0);
}

#[test]
#[should_panic(expected = "already voted")]
fn test_cast_vote_twice() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let voter = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin.clone(), token_contract);

    let title = String::from_str(&env, "Test Proposal");
    let description = String::from_str(&env, "Test Description");
    let proposal_type = ProposalType::ParameterUpdate;
    let voting_period = 604800;
    let execution_data = Bytes::new(&env);

    let proposal_id = GovernanceContract::create_proposal(
        env.clone(),
        admin,
        title,
        description,
        proposal_type,
        voting_period,
        execution_data,
    );

    GovernanceContract::cast_vote(
        env.clone(),
        voter.clone(),
        proposal_id.clone(),
        VoteChoice::For,
    );
    GovernanceContract::cast_vote(env, voter, proposal_id, VoteChoice::Against);
}

#[test]
fn test_tally_votes() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin.clone(), token_contract);

    let title = String::from_str(&env, "Test Proposal");
    let description = String::from_str(&env, "Test Description");
    let proposal_type = ProposalType::ParameterUpdate;
    let voting_period = 604800;
    let execution_data = Bytes::new(&env);

    let proposal_id = GovernanceContract::create_proposal(
        env.clone(),
        admin.clone(),
        title,
        description,
        proposal_type,
        voting_period,
        execution_data,
    );

    GovernanceContract::cast_vote(
        env.clone(),
        voter1.clone(),
        proposal_id.clone(),
        VoteChoice::For,
    );
    GovernanceContract::cast_vote(
        env.clone(),
        voter2.clone(),
        proposal_id.clone(),
        VoteChoice::For,
    );

    // Advance time past voting period
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + 604800 + 1);

    GovernanceContract::tally_votes(env.clone(), proposal_id.clone());

    let proposal: Proposal = env
        .storage()
        .persistent()
        .get(&DataKey::Proposal(proposal_id))
        .expect("proposal not found");

    assert_eq!(proposal.status, ProposalStatus::Passed);
}

#[test]
fn test_execute_proposal() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let voter = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin.clone(), token_contract);

    let title = String::from_str(&env, "Test Proposal");
    let description = String::from_str(&env, "Test Description");
    let proposal_type = ProposalType::ParameterUpdate;
    let voting_period = 604800;
    let execution_data = Bytes::new(&env);

    let proposal_id = GovernanceContract::create_proposal(
        env.clone(),
        admin.clone(),
        title,
        description,
        proposal_type,
        voting_period,
        execution_data,
    );

    GovernanceContract::cast_vote(
        env.clone(),
        voter.clone(),
        proposal_id.clone(),
        VoteChoice::For,
    );

    // Advance time past voting period and timelock
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + 604800 + 86400 + 1);

    GovernanceContract::tally_votes(env.clone(), proposal_id.clone());
    GovernanceContract::execute_proposal(env.clone(), proposal_id.clone());

    let proposal: Proposal = env
        .storage()
        .persistent()
        .get(&DataKey::Proposal(proposal_id))
        .expect("proposal not found");

    assert_eq!(proposal.status, ProposalStatus::Executed);
}

#[test]
#[should_panic(expected = "proposal is not passed")]
fn test_execute_proposal_not_passed() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin.clone(), token_contract);

    let title = String::from_str(&env, "Test Proposal");
    let description = String::from_str(&env, "Test Description");
    let proposal_type = ProposalType::ParameterUpdate;
    let voting_period = 604800;
    let execution_data = Bytes::new(&env);

    let proposal_id = GovernanceContract::create_proposal(
        env.clone(),
        admin,
        title,
        description,
        proposal_type,
        voting_period,
        execution_data,
    );

    GovernanceContract::execute_proposal(env, proposal_id);
}

#[test]
fn test_delegate_voting_power() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let delegator = Address::generate(&env);
    let delegatee = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin, token_contract);

    GovernanceContract::delegate_voting_power(env.clone(), delegator.clone(), delegatee.clone());

    let delegation: Delegation = env
        .storage()
        .persistent()
        .get(&DataKey::Delegation(delegator.clone()))
        .expect("delegation not found");

    assert_eq!(delegation.delegator, delegator);
    assert_eq!(delegation.delegatee, delegatee);
}

#[test]
#[should_panic(expected = "cannot delegate to self")]
fn test_delegate_voting_power_to_self() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let delegator = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin, token_contract);

    GovernanceContract::delegate_voting_power(env, delegator.clone(), delegator);
}

#[test]
fn test_cancel_proposal() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin.clone(), token_contract);

    let title = String::from_str(&env, "Test Proposal");
    let description = String::from_str(&env, "Test Description");
    let proposal_type = ProposalType::ParameterUpdate;
    let voting_period = 604800;
    let execution_data = Bytes::new(&env);

    let proposal_id = GovernanceContract::create_proposal(
        env.clone(),
        admin.clone(),
        title,
        description,
        proposal_type,
        voting_period,
        execution_data,
    );

    GovernanceContract::cancel_proposal(env.clone(), proposal_id.clone(), admin.clone());

    let proposal: Proposal = env
        .storage()
        .persistent()
        .get(&DataKey::Proposal(proposal_id))
        .expect("proposal not found");

    assert_eq!(proposal.status, ProposalStatus::Cancelled);
}

#[test]
#[should_panic(expected = "only admin can cancel proposals")]
fn test_cancel_proposal_unauthorized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin.clone(), token_contract);

    let title = String::from_str(&env, "Test Proposal");
    let description = String::from_str(&env, "Test Description");
    let proposal_type = ProposalType::ParameterUpdate;
    let voting_period = 604800;
    let execution_data = Bytes::new(&env);

    let proposal_id = GovernanceContract::create_proposal(
        env.clone(),
        admin.clone(),
        title,
        description,
        proposal_type,
        voting_period,
        execution_data,
    );

    GovernanceContract::cancel_proposal(env, proposal_id, unauthorized);
}

#[test]
fn test_update_governance_params() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin.clone(), token_contract);

    let new_params = GovernanceParams {
        min_voting_period: 86400,
        max_voting_period: 604800,
        quorum_threshold: 50,
        execution_threshold: 60,
        proposal_deposit: 2000,
        timelock_period: 172800,
    };

    GovernanceContract::update_governance_params(env.clone(), admin.clone(), new_params.clone());

    let stored_params: GovernanceParams = env
        .storage()
        .persistent()
        .get(&DataKey::GovernanceParams)
        .expect("params not found");

    assert_eq!(stored_params.quorum_threshold, 50);
    assert_eq!(stored_params.execution_threshold, 60);
}

#[test]
#[should_panic(expected = "only admin can update parameters")]
fn test_update_governance_params_unauthorized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin, token_contract);

    let new_params = GovernanceParams {
        min_voting_period: 86400,
        max_voting_period: 604800,
        quorum_threshold: 50,
        execution_threshold: 60,
        proposal_deposit: 2000,
        timelock_period: 172800,
    };

    GovernanceContract::update_governance_params(env, unauthorized, new_params);
}

#[test]
fn test_get_proposal() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin.clone(), token_contract);

    let title = String::from_str(&env, "Test Proposal");
    let description = String::from_str(&env, "Test Description");
    let proposal_type = ProposalType::ParameterUpdate;
    let voting_period = 604800;
    let execution_data = Bytes::new(&env);

    let proposal_id = GovernanceContract::create_proposal(
        env.clone(),
        admin.clone(),
        title.clone(),
        description.clone(),
        proposal_type.clone(),
        voting_period,
        execution_data,
    );

    let proposal = GovernanceContract::get_proposal(env, proposal_id);

    assert_eq!(proposal.title, title);
    assert_eq!(proposal.description, description);
    assert_eq!(proposal.proposal_type, proposal_type);
}

#[test]
fn test_get_governance_params() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_contract = Address::generate(&env);

    GovernanceContract::initialize(env.clone(), admin, token_contract);

    let params = GovernanceContract::get_governance_params(env);

    assert_eq!(params.quorum_threshold, 40);
    assert_eq!(params.execution_threshold, 51);
}
