#![no_std]

mod storage;
mod types;
mod errors;
mod events;
mod validation;

use soroban_sdk::{contract, contractimpl, token, Address, Env, String, Vec};

pub use types::*;
pub use errors::Error;
use storage::Storage;
use events::Events;
use validation::Validation;

#[contract]
pub struct PrizeDistributionContract;

#[contractimpl]
impl PrizeDistributionContract {
    /// Initialize the contract with admin and token address
    pub fn initialize(env: Env, admin: Address, token_address: Address) -> Result<(), Error> {
        if Storage::has_admin(&env) {
            return Err(Error::InvalidParameter);
        }

        admin.require_auth();

        Storage::set_admin(&env, &admin);
        Storage::set_token_address(&env, &token_address);
        Storage::set_paused(&env, false);

        Events::emit_initialized(&env, &admin, &token_address);

        Ok(())
    }

    /// Create a new tournament prize pool
    pub fn create_prize_pool(
        env: Env,
        tournament_id: u64,
        entry_fee: i128,
        max_participants: u32,
        distribution_rules: DistributionRules,
    ) -> Result<(), Error> {
        Validation::require_not_paused(&env)?;
        
        let admin = Storage::get_admin(&env)?;
        admin.require_auth();

        Validation::validate_entry_fee(entry_fee)?;
        Validation::validate_max_participants(max_participants)?;
        Validation::validate_distribution_rules(&distribution_rules)?;

        if Storage::has_prize_pool(&env, tournament_id) {
            return Err(Error::PrizePoolAlreadyExists);
        }

        let prize_pool = PrizePool {
            tournament_id,
            total_amount: 0,
            entry_fee,
            max_participants,
            current_participants: 0,
            status: PrizePoolStatus::Active,
            created_at: env.ledger().timestamp(),
            admin: admin.clone(),
        };

        Storage::set_prize_pool(&env, tournament_id, &prize_pool);
        Storage::set_distribution_rules(&env, tournament_id, &distribution_rules);
        Storage::init_participants(&env, tournament_id);

        Events::emit_prize_pool_created(&env, tournament_id, entry_fee, max_participants);

        Ok(())
    }

    /// Add entry fee to prize pool
    pub fn add_entry_fee(
        env: Env,
        tournament_id: u64,
        participant: Address,
        amount: i128,
    ) -> Result<(), Error> {
        Validation::require_not_paused(&env)?;
        participant.require_auth();

        let mut prize_pool = Storage::get_prize_pool(&env, tournament_id)?;

        Validation::validate_prize_pool_active(&prize_pool)?;
        Validation::validate_entry_fee_amount(amount, prize_pool.entry_fee)?;
        Validation::validate_max_participants_not_reached(&prize_pool)?;

        let mut participants = Storage::get_participants(&env, tournament_id)?;
        Validation::validate_participant_not_exists(&participants, &participant)?;

        // Transfer tokens from participant to contract
        let token_address = Storage::get_token_address(&env)?;
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&participant, &env.current_contract_address(), &amount);

        // Update prize pool
        prize_pool.total_amount += amount;
        prize_pool.current_participants += 1;

        // Add participant
        let new_participant = Participant {
            address: participant.clone(),
            entry_fee_paid: amount,
        };
        participants.push_back(new_participant);

        // Save updated data
        Storage::set_prize_pool(&env, tournament_id, &prize_pool);
        Storage::set_participants(&env, tournament_id, &participants);

        Events::emit_entry_fee_added(&env, tournament_id, &participant, amount);

        Ok(())
    }

    /// Distribute prizes to winners
    pub fn distribute_prizes(
        env: Env,
        tournament_id: u64,
        winners: Vec<Winner>,
    ) -> Result<(), Error> {
        Validation::require_not_paused(&env)?;

        let admin = Storage::get_admin(&env)?;
        admin.require_auth();

        let mut prize_pool = Storage::get_prize_pool(&env, tournament_id)?;
        let distribution_rules = Storage::get_distribution_rules(&env, tournament_id)?;

        Validation::validate_prize_pool_active(&prize_pool)?;
        Validation::validate_min_participants_met(&prize_pool, &distribution_rules)?;
        Validation::validate_winners(&winners, prize_pool.total_amount)?;

        // Transfer prizes to winners
        let token_address = Storage::get_token_address(&env)?;
        let token_client = token::Client::new(&env, &token_address);

        let mut total_distributed: i128 = 0;
        for i in 0..winners.len() {
            let winner = winners.get(i).unwrap();
            token_client.transfer(
                &env.current_contract_address(),
                &winner.address,
                &winner.prize_amount,
            );
            total_distributed += winner.prize_amount;
        }

        // Update prize pool status
        prize_pool.status = PrizePoolStatus::Completed;
        Storage::set_prize_pool(&env, tournament_id, &prize_pool);

        Events::emit_prizes_distributed(&env, tournament_id, total_distributed);

        Ok(())
    }

    /// Refund entry fees for cancelled tournaments
    pub fn refund_entry_fees(
        env: Env,
        tournament_id: u64,
        reason: String,
    ) -> Result<(), Error> {
        Validation::require_not_paused(&env)?;

        let admin = Storage::get_admin(&env)?;
        admin.require_auth();

        let mut prize_pool = Storage::get_prize_pool(&env, tournament_id)?;
        Validation::validate_refund_allowed(&prize_pool)?;

        let participants = Storage::get_participants(&env, tournament_id)?;
        if participants.is_empty() {
            return Err(Error::ParticipantNotFound);
        }

        // Transfer refunds to all participants
        let token_address = Storage::get_token_address(&env)?;
        let token_client = token::Client::new(&env, &token_address);

        let mut total_refunded: i128 = 0;
        for i in 0..participants.len() {
            let participant = participants.get(i).unwrap();
            token_client.transfer(
                &env.current_contract_address(),
                &participant.address,
                &participant.entry_fee_paid,
            );
            total_refunded += participant.entry_fee_paid;
        }

        // Update prize pool status
        prize_pool.status = PrizePoolStatus::Refunded;
        prize_pool.total_amount = 0;
        Storage::set_prize_pool(&env, tournament_id, &prize_pool);

        Events::emit_refunds_processed(&env, tournament_id, total_refunded, &reason);

        Ok(())
    }

    /// Get prize pool status
    pub fn get_prize_pool(env: Env, tournament_id: u64) -> Result<PrizePool, Error> {
        Storage::get_prize_pool(&env, tournament_id)
    }

    /// Get distribution rules
    pub fn get_distribution_rules(
        env: Env,
        tournament_id: u64,
    ) -> Result<DistributionRules, Error> {
        Storage::get_distribution_rules(&env, tournament_id)
    }

    /// Get participants
    pub fn get_participants(env: Env, tournament_id: u64) -> Result<Vec<Participant>, Error> {
        Storage::get_participants(&env, tournament_id)
    }

    /// Update distribution rules (admin only, before tournament starts)
    pub fn update_distribution_rules(
        env: Env,
        tournament_id: u64,
        new_rules: DistributionRules,
    ) -> Result<(), Error> {
        Validation::require_not_paused(&env)?;

        let admin = Storage::get_admin(&env)?;
        admin.require_auth();

        let prize_pool = Storage::get_prize_pool(&env, tournament_id)?;

        // Only allow updates if no participants yet
        if prize_pool.current_participants > 0 {
            return Err(Error::InvalidPrizePoolStatus);
        }

        Validation::validate_distribution_rules(&new_rules)?;
        Storage::set_distribution_rules(&env, tournament_id, &new_rules);

        Events::emit_rules_updated(&env, tournament_id);

        Ok(())
    }

    /// Cancel a tournament (admin only)
    pub fn cancel_tournament(env: Env, tournament_id: u64) -> Result<(), Error> {
        Validation::require_not_paused(&env)?;

        let admin = Storage::get_admin(&env)?;
        admin.require_auth();

        let mut prize_pool = Storage::get_prize_pool(&env, tournament_id)?;
        Validation::validate_prize_pool_active(&prize_pool)?;

        prize_pool.status = PrizePoolStatus::Cancelled;
        Storage::set_prize_pool(&env, tournament_id, &prize_pool);

        Events::emit_tournament_cancelled(&env, tournament_id);

        Ok(())
    }

    /// Pause contract (admin only)
    pub fn pause_contract(env: Env) -> Result<(), Error> {
        let admin = Storage::get_admin(&env)?;
        admin.require_auth();

        Storage::set_paused(&env, true);
        Events::emit_contract_paused(&env);

        Ok(())
    }

    /// Unpause contract (admin only)
    pub fn unpause_contract(env: Env) -> Result<(), Error> {
        let admin = Storage::get_admin(&env)?;
        admin.require_auth();

        Storage::set_paused(&env, false);
        Events::emit_contract_unpaused(&env);

        Ok(())
    }

    /// Get contract admin
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        Storage::get_admin(&env)
    }

    /// Check if contract is paused
    pub fn is_paused(env: Env) -> bool {
        Storage::is_paused(&env)
    }
}