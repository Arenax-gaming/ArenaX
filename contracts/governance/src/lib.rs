#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, String};

mod test;

// Proposal types
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalType {
    ParameterUpdate,
    TreasuryAllocation,
    RuleChange,
    EmergencyAction,
    Other,
}

// Vote choices
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VoteChoice {
    For,
    Against,
    Abstain,
}

// Proposal status
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Active,
    Passed,
    Rejected,
    Executed,
    Cancelled,
    Expired,
}

// Proposal data structure
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub proposal_id: BytesN<32>,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub proposal_type: ProposalType,
    pub voting_start: u64,
    pub voting_end: u64,
    pub status: ProposalStatus,
    pub for_votes: u128,
    pub against_votes: u128,
    pub abstain_votes: u128,
    pub total_voting_power: u128,
    pub execution_data: Bytes,
    pub created_at: u64,
}

// Vote data structure
#[contracttype]
#[derive(Clone, Debug)]
pub struct Vote {
    pub voter: Address,
    pub proposal_id: BytesN<32>,
    pub choice: VoteChoice,
    pub voting_power: u128,
    pub voted_at: u64,
}

// Delegation data structure
#[contracttype]
#[derive(Clone, Debug)]
pub struct Delegation {
    pub delegator: Address,
    pub delegatee: Address,
    pub voting_power: u128,
    pub delegated_at: u64,
}

// Governance parameters
#[contracttype]
#[derive(Clone, Debug)]
pub struct GovernanceParams {
    pub min_voting_period: u64,
    pub max_voting_period: u64,
    pub quorum_threshold: u32,    // Percentage (0-100)
    pub execution_threshold: u32, // Percentage (0-100)
    pub proposal_deposit: u128,
    pub timelock_period: u64,
}

// Storage keys
#[contracttype]
pub enum DataKey {
    Admin,
    Proposal(BytesN<32>),
    Vote(BytesN<32>, Address),
    Delegation(Address),
    GovernanceParams,
    ProposalCounter,
    TokenContract,
}

// Governance contract
#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    // Initialize the governance contract
    pub fn initialize(env: Env, admin: Address, token_contract: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        env.storage().persistent().set(&DataKey::Admin, &admin);

        env.storage()
            .persistent()
            .set(&DataKey::TokenContract, &token_contract);

        // Set default governance parameters
        let params = GovernanceParams {
            min_voting_period: 604800,  // 7 days
            max_voting_period: 2592000, // 30 days
            quorum_threshold: 40,       // 40% quorum
            execution_threshold: 51,    // 51% to pass
            proposal_deposit: 1000,     // 1000 tokens
            timelock_period: 86400,     // 1 day timelock
        };

        env.storage()
            .persistent()
            .set(&DataKey::GovernanceParams, &params);

        env.storage()
            .persistent()
            .set(&DataKey::ProposalCounter, &0u32);
    }

    // Create a new proposal
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
        proposal_type: ProposalType,
        voting_period: u64,
        execution_data: Bytes,
    ) -> BytesN<32> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");

        // Verify proposer is authorized (for now, only admin can propose)
        if proposer != admin {
            panic!("only admin can create proposals");
        }

        let params: GovernanceParams = env
            .storage()
            .persistent()
            .get(&DataKey::GovernanceParams)
            .expect("params not found");

        // Validate voting period
        if voting_period < params.min_voting_period || voting_period > params.max_voting_period {
            panic!("invalid voting period");
        }

        // Generate proposal ID
        let counter: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalCounter)
            .unwrap_or(0);
        let new_counter = counter + 1;
        env.storage()
            .persistent()
            .set(&DataKey::ProposalCounter, &new_counter);

        let proposal_id = Self::generate_proposal_id(&env, new_counter);

        let current_time = env.ledger().timestamp();

        let proposal = Proposal {
            proposal_id: proposal_id.clone(),
            proposer: proposer.clone(),
            title: title.clone(),
            description: description.clone(),
            proposal_type: proposal_type.clone(),
            voting_start: current_time,
            voting_end: current_time + voting_period,
            status: ProposalStatus::Active,
            for_votes: 0,
            against_votes: 0,
            abstain_votes: 0,
            total_voting_power: 0,
            execution_data: execution_data.clone(),
            created_at: current_time,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id.clone()), &proposal);

        // Emit event
        arenax_events::governance::proposal_created(
            &env,
            &proposer,
            &proposal_id,
            &title,
            &description,
            proposal_type as u32,
        );

        proposal_id
    }

    // Cast a vote on a proposal
    pub fn cast_vote(env: Env, voter: Address, proposal_id: BytesN<32>, choice: VoteChoice) {
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id.clone()))
            .expect("proposal not found");

        // Check if proposal is active
        if proposal.status != ProposalStatus::Active {
            panic!("proposal is not active");
        }

        // Check if voting period has ended
        let current_time = env.ledger().timestamp();
        if current_time > proposal.voting_end {
            panic!("voting period has ended");
        }

        // Check if already voted
        let vote_key = DataKey::Vote(proposal_id.clone(), voter.clone());
        if env.storage().persistent().has(&vote_key) {
            panic!("already voted");
        }

        // Calculate voting power
        let voting_power = Self::calculate_voting_power(&env, &voter, &proposal_id);

        // Record the vote
        let vote = Vote {
            voter: voter.clone(),
            proposal_id: proposal_id.clone(),
            choice: choice.clone(),
            voting_power,
            voted_at: current_time,
        };

        env.storage().persistent().set(&vote_key, &vote);

        // Update proposal vote counts
        match choice {
            VoteChoice::For => proposal.for_votes += voting_power,
            VoteChoice::Against => proposal.against_votes += voting_power,
            VoteChoice::Abstain => proposal.abstain_votes += voting_power,
        }

        proposal.total_voting_power += voting_power;

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id.clone()), &proposal);

        // Emit event
        arenax_events::governance::vote_cast(
            &env,
            &voter,
            &proposal_id,
            choice as u32,
            voting_power,
        );
    }

    // Calculate voting power for a voter
    pub fn calculate_voting_power(env: &Env, voter: &Address, _proposal_id: &BytesN<32>) -> u128 {
        // Get token contract
        let _token_contract: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TokenContract)
            .expect("token contract not found");

        // For now, return a simple calculation based on address
        // In production, this would query the token contract for actual balance
        let mut power: u128 = 100; // Base voting power

        // Check for delegated power
        let delegation_key = DataKey::Delegation(voter.clone());
        if env.storage().persistent().has(&delegation_key) {
            let delegation: Delegation = env
                .storage()
                .persistent()
                .get(&delegation_key)
                .expect("delegation not found");
            power += delegation.voting_power;
        }

        power
    }

    // Tally votes for a proposal
    pub fn tally_votes(env: Env, proposal_id: BytesN<32>) {
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id.clone()))
            .expect("proposal not found");

        let params: GovernanceParams = env
            .storage()
            .persistent()
            .get(&DataKey::GovernanceParams)
            .expect("params not found");

        let current_time = env.ledger().timestamp();

        // Check if voting period has ended
        if current_time <= proposal.voting_end {
            panic!("voting period has not ended");
        }

        // Check quorum
        let quorum_threshold = (proposal.total_voting_power * params.quorum_threshold as u128) / 100;
        if proposal.total_voting_power < quorum_threshold {
            proposal.status = ProposalStatus::Rejected;
        } else {
            // Check if proposal passed
            let total_votes = proposal.for_votes + proposal.against_votes;
            if total_votes > 0 {
                let for_percentage = (proposal.for_votes * 100) / total_votes;
                if for_percentage >= params.execution_threshold as u128 {
                    proposal.status = ProposalStatus::Passed;
                } else {
                    proposal.status = ProposalStatus::Rejected;
                }
            } else {
                proposal.status = ProposalStatus::Rejected;
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id.clone()), &proposal);

        // Emit event
        arenax_events::governance::proposal_tallied(
            &env,
            &proposal_id,
            proposal.status as u32,
            proposal.for_votes,
            proposal.against_votes,
            proposal.abstain_votes,
        );
    }

    // Execute a passed proposal
    pub fn execute_proposal(env: Env, proposal_id: BytesN<32>) {
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id.clone()))
            .expect("proposal not found");

        let params: GovernanceParams = env
            .storage()
            .persistent()
            .get(&DataKey::GovernanceParams)
            .expect("params not found");

        let current_time = env.ledger().timestamp();

        // Check if proposal is passed
        if proposal.status != ProposalStatus::Passed {
            panic!("proposal is not passed");
        }

        // Check timelock
        if current_time < proposal.voting_end + params.timelock_period {
            panic!("timelock period has not passed");
        }

        // Execute proposal (placeholder - actual execution depends on proposal type)
        proposal.status = ProposalStatus::Executed;

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id.clone()), &proposal);

        // Emit event
        arenax_events::governance::proposal_executed(&env, &proposal_id);
    }

    // Delegate voting power
    pub fn delegate_voting_power(env: Env, delegator: Address, delegatee: Address) {
        if delegator == delegatee {
            panic!("cannot delegate to self");
        }

        let voting_power =
            Self::calculate_voting_power(&env, &delegator, &BytesN::from_array(&env, &[0u8; 32]));

        let delegation = Delegation {
            delegator: delegator.clone(),
            delegatee: delegatee.clone(),
            voting_power,
            delegated_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Delegation(delegator.clone()), &delegation);

        // Emit event
        arenax_events::governance::voting_power_delegated(
            &env,
            &delegator,
            &delegatee,
            voting_power,
        );
    }

    // Cancel a proposal
    pub fn cancel_proposal(env: Env, proposal_id: BytesN<32>, caller: Address) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if caller != admin {
            panic!("only admin can cancel proposals");
        }

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id.clone()))
            .expect("proposal not found");

        if proposal.status != ProposalStatus::Active {
            panic!("proposal is not active");
        }

        proposal.status = ProposalStatus::Cancelled;

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id.clone()), &proposal);

        // Emit event
        arenax_events::governance::proposal_cancelled(&env, &proposal_id);
    }

    // Update governance parameters
    pub fn update_governance_params(env: Env, caller: Address, params: GovernanceParams) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if caller != admin {
            panic!("only admin can update parameters");
        }

        env.storage()
            .persistent()
            .set(&DataKey::GovernanceParams, &params);

        // Emit event
        arenax_events::governance::governance_params_updated(&env);
    }

    // Get proposal details
    pub fn get_proposal(env: Env, proposal_id: BytesN<32>) -> Proposal {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found")
    }

    // Get governance parameters
    pub fn get_governance_params(env: Env) -> GovernanceParams {
        env.storage()
            .persistent()
            .get(&DataKey::GovernanceParams)
            .expect("params not found")
    }

    // Get vote details
    pub fn get_vote(env: Env, proposal_id: BytesN<32>, voter: Address) -> Vote {
        env.storage()
            .persistent()
            .get(&DataKey::Vote(proposal_id, voter))
            .expect("vote not found")
    }

    // Get delegation details
    pub fn get_delegation(env: Env, delegator: Address) -> Delegation {
        env.storage()
            .persistent()
            .get(&DataKey::Delegation(delegator))
            .expect("delegation not found")
    }

    // Helper function to generate proposal ID
    fn generate_proposal_id(env: &Env, counter: u32) -> BytesN<32> {
        let mut bytes = [0u8; 32];
        bytes[0..4].copy_from_slice(&counter.to_be_bytes());
        BytesN::from_array(env, &bytes)
    }
}
