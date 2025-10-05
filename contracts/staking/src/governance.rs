//! Governance functionality for the ArenaX Staking Contract

use soroban_sdk::{Address, Env, String, Vec};
use crate::types::*;

impl crate::StakingContract {
    /// Create a governance proposal
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
        voting_period: u64,
        proposal_type: ProposalType,
        execution_data: Vec<u8>,
    ) -> Result<u64, StakingError> {
        proposer.require_auth();

        let mut config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        if config.is_paused {
            return Err(StakingError::ContractPaused);
        }

        // Check proposer has minimum stake
        let proposer_voting_power = Self::get_voting_power(env.clone(), proposer.clone())?;
        if proposer_voting_power < config.min_proposal_stake {
            return Err(StakingError::InsufficientVotingPower);
        }

        // Validate voting period
        if voting_period < config.min_voting_period || voting_period > config.max_voting_period {
            return Err(StakingError::InvalidParameters);
        }

        let current_time = env.ledger().timestamp();
        let proposal_id = config.total_proposals_created + 1;

        // Calculate quorum based on total staked tokens
        let total_voting_power = Self::get_total_voting_power(&env)?;
        let quorum_required = (total_voting_power * config.default_quorum as i128) / 10000;

        let proposal = Proposal {
            proposal_id,
            proposer: proposer.clone(),
            title: title.clone(),
            description,
            created_at: current_time,
            voting_deadline: current_time + voting_period,
            execution_deadline: current_time + voting_period + 86400, // 24 hours execution window
            votes_for: 0,
            votes_against: 0,
            quorum_required,
            status: ProposalStatus::Active,
            proposal_type: proposal_type.clone(),
            execution_data,
        };

        // Store proposal
        env.storage()
            .persistent()
            .set(&StorageKey::Proposal(proposal_id), &proposal);

        // Update config
        config.total_proposals_created = proposal_id;
        env.storage()
            .persistent()
            .set(&StorageKey::Config, &config);

        // Emit event
        let event = StakingEvent::ProposalCreated {
            proposal_id,
            proposer,
            proposal_type,
            timestamp: current_time,
        };
        env.events().publish(("governance_event", "proposal_created"), event);

        Ok(proposal_id)
    }

    /// Cast a vote on a proposal
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        vote_for: bool,
    ) -> Result<(), StakingError> {
        voter.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        if config.is_paused {
            return Err(StakingError::ContractPaused);
        }

        let mut proposal: Proposal = env.storage()
            .persistent()
            .get(&StorageKey::Proposal(proposal_id))
            .ok_or(StakingError::ProposalNotFound)?;

        let current_time = env.ledger().timestamp();

        // Check if voting is still active
        if current_time > proposal.voting_deadline {
            return Err(StakingError::VotingEnded);
        }

        if proposal.status != ProposalStatus::Active {
            return Err(StakingError::InvalidProposal);
        }

        // Check if already voted
        let vote_key = StorageKey::Vote(proposal_id, voter.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(StakingError::AlreadyVoted);
        }

        // Get voter's voting power
        let voting_power = Self::get_voting_power(env.clone(), voter.clone())?;
        if voting_power <= 0 {
            return Err(StakingError::InsufficientVotingPower);
        }

        // Record the vote
        let vote = Vote {
            voter: voter.clone(),
            proposal_id,
            vote_for,
            voting_power,
            voted_at: current_time,
        };

        env.storage().persistent().set(&vote_key, &vote);

        // Update proposal vote counts
        if vote_for {
            proposal.votes_for += voting_power;
        } else {
            proposal.votes_against += voting_power;
        }

        env.storage()
            .persistent()
            .set(&StorageKey::Proposal(proposal_id), &proposal);

        // Emit event
        let event = StakingEvent::VoteCast {
            proposal_id,
            voter,
            vote_for,
            voting_power,
            timestamp: current_time,
        };
        env.events().publish(("governance_event", "vote_cast"), event);

        Ok(())
    }

    /// Execute a passed proposal
    pub fn execute_proposal(
        env: Env,
        executor: Address,
        proposal_id: u64,
    ) -> Result<(), StakingError> {
        executor.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        let mut proposal: Proposal = env.storage()
            .persistent()
            .get(&StorageKey::Proposal(proposal_id))
            .ok_or(StakingError::ProposalNotFound)?;

        let current_time = env.ledger().timestamp();

        // Check if proposal can be executed
        if current_time <= proposal.voting_deadline {
            return Err(StakingError::VotingEnded);
        }

        if current_time > proposal.execution_deadline {
            proposal.status = ProposalStatus::Expired;
            env.storage()
                .persistent()
                .set(&StorageKey::Proposal(proposal_id), &proposal);
            return Err(StakingError::InvalidProposal);
        }

        // Check if proposal passed
        let total_votes = proposal.votes_for + proposal.votes_against;
        if total_votes < proposal.quorum_required {
            proposal.status = ProposalStatus::Failed;
            env.storage()
                .persistent()
                .set(&StorageKey::Proposal(proposal_id), &proposal);
            return Err(StakingError::InvalidProposal);
        }

        if proposal.votes_for <= proposal.votes_against {
            proposal.status = ProposalStatus::Failed;
            env.storage()
                .persistent()
                .set(&StorageKey::Proposal(proposal_id), &proposal);
            return Err(StakingError::InvalidProposal);
        }

        // Execute proposal based on type
        match proposal.proposal_type {
            ProposalType::Emergency => {
                // Handle emergency proposals (pause/unpause)
                Self::execute_emergency_proposal(&env, &proposal)?;
            },
            ProposalType::ParameterUpdate => {
                // Handle parameter updates
                Self::execute_parameter_update(&env, &proposal)?;
            },
            ProposalType::PoolUpdate => {
                // Handle pool parameter updates
                Self::execute_pool_update(&env, &proposal)?;
            },
            _ => {
                // For other proposal types, mark as executed but don't perform automatic actions
                // These may require manual intervention or external contract calls
            }
        }

        proposal.status = ProposalStatus::Executed;
        env.storage()
            .persistent()
            .set(&StorageKey::Proposal(proposal_id), &proposal);

        // Emit event
        let event = StakingEvent::ProposalExecuted {
            proposal_id,
            timestamp: current_time,
        };
        env.events().publish(("governance_event", "proposal_executed"), event);

        Ok(())
    }

    /// Get proposal information
    pub fn get_proposal(
        env: Env,
        proposal_id: u64,
    ) -> Result<Proposal, StakingError> {
        env.storage()
            .persistent()
            .get(&StorageKey::Proposal(proposal_id))
            .ok_or(StakingError::ProposalNotFound)
    }

    /// Get vote information
    pub fn get_vote(
        env: Env,
        proposal_id: u64,
        voter: Address,
    ) -> Result<Vote, StakingError> {
        let vote_key = StorageKey::Vote(proposal_id, voter);
        env.storage()
            .persistent()
            .get(&vote_key)
            .ok_or(StakingError::ProposalNotFound)
    }

    /// Internal helper to get total voting power
    fn get_total_voting_power(env: &Env) -> Result<i128, StakingError> {
        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        let mut total_voting_power = 0i128;

        // Sum up all pool totals (simplified approach)
        for pool_id in 1..=config.total_pools_created {
            if let Some(pool) = env.storage().persistent().get::<StorageKey, StakingPool>(&StorageKey::Pool(pool_id)) {
                total_voting_power += pool.total_staked * pool.governance_multiplier as i128 / 10000;
            }
        }

        Ok(total_voting_power)
    }

    /// Execute emergency proposals
    fn execute_emergency_proposal(
        env: &Env,
        proposal: &Proposal,
    ) -> Result<(), StakingError> {
        // Parse execution data to determine emergency action
        if proposal.execution_data.is_empty() {
            return Err(StakingError::InvalidParameters);
        }

        let mut config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        // Simple encoding: first byte determines action
        // 0x01 = pause contract, 0x02 = unpause contract, 0x03 = enable emergency withdrawal
        match proposal.execution_data.get(0) {
            Some(1) => {
                config.is_paused = true;
            },
            Some(2) => {
                config.is_paused = false;
            },
            Some(3) => {
                config.emergency_withdrawal_enabled = true;
            },
            Some(4) => {
                config.emergency_withdrawal_enabled = false;
            },
            _ => return Err(StakingError::InvalidParameters),
        }

        env.storage().persistent().set(&StorageKey::Config, &config);
        Ok(())
    }

    /// Execute parameter update proposals
    fn execute_parameter_update(
        env: &Env,
        proposal: &Proposal,
    ) -> Result<(), StakingError> {
        // This would contain logic to update various contract parameters
        // For security, parameter updates should be carefully validated
        
        // For now, we'll just mark it as executed
        // In a full implementation, you'd parse the execution_data to determine
        // which parameters to update and their new values
        Ok(())
    }

    /// Execute pool update proposals
    fn execute_pool_update(
        env: &Env,
        proposal: &Proposal,
    ) -> Result<(), StakingError> {
        // This would contain logic to update pool parameters
        // Pool updates might include changing APY, lock periods, etc.
        
        // For now, we'll just mark it as executed
        Ok(())
    }
}