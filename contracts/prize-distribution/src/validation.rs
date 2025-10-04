use soroban_sdk::{Address, Env, Vec};
use crate::types::{DistributionRules, Participant, PrizePool, PrizePoolStatus, Winner};
use crate::errors::Error;
use crate::storage::Storage;

pub struct Validation;

impl Validation {
    pub fn require_not_paused(env: &Env) -> Result<(), Error> {
        if Storage::is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    pub fn validate_entry_fee(entry_fee: i128) -> Result<(), Error> {
        if entry_fee <= 0 {
            return Err(Error::InvalidParameter);
        }
        Ok(())
    }

    pub fn validate_max_participants(max_participants: u32) -> Result<(), Error> {
        if max_participants == 0 {
            return Err(Error::InvalidParameter);
        }
        Ok(())
    }

    pub fn validate_distribution_rules(rules: &DistributionRules) -> Result<(), Error> {
        let total_percentage = rules.first_place_percentage
            + rules.second_place_percentage
            + rules.third_place_percentage;

        if total_percentage != 100 {
            return Err(Error::InvalidDistributionRules);
        }

        if rules.min_participants == 0 {
            return Err(Error::InvalidDistributionRules);
        }

        Ok(())
    }

    pub fn validate_prize_pool_active(prize_pool: &PrizePool) -> Result<(), Error> {
        if prize_pool.status != PrizePoolStatus::Active {
            return Err(Error::InvalidPrizePoolStatus);
        }
        Ok(())
    }

    pub fn validate_entry_fee_amount(
        amount: i128,
        expected_fee: i128,
    ) -> Result<(), Error> {
        if amount != expected_fee {
            return Err(Error::InvalidEntryFee);
        }
        Ok(())
    }

    pub fn validate_max_participants_not_reached(
        prize_pool: &PrizePool,
    ) -> Result<(), Error> {
        if prize_pool.current_participants >= prize_pool.max_participants {
            return Err(Error::MaxParticipantsReached);
        }
        Ok(())
    }

    pub fn validate_participant_not_exists(
        participants: &Vec<Participant>,
        participant: &Address,
    ) -> Result<(), Error> {
        for i in 0..participants.len() {
            if participants.get(i).unwrap().address == *participant {
                return Err(Error::AlreadyParticipated);
            }
        }
        Ok(())
    }

    pub fn validate_min_participants_met(
        prize_pool: &PrizePool,
        distribution_rules: &DistributionRules,
    ) -> Result<(), Error> {
        if prize_pool.current_participants < distribution_rules.min_participants {
            return Err(Error::MinParticipantsNotMet);
        }
        Ok(())
    }

    pub fn validate_winners(
        winners: &Vec<Winner>,
        total_amount: i128,
    ) -> Result<(), Error> {
        if winners.is_empty() {
            return Err(Error::NoWinners);
        }

        if winners.len() > 3 {
            return Err(Error::InvalidWinnerList);
        }

        let mut total_distributed: i128 = 0;
        for i in 0..winners.len() {
            let winner = winners.get(i).unwrap();
            total_distributed += winner.prize_amount;
        }

        if total_distributed > total_amount {
            return Err(Error::InsufficientFunds);
        }

        Ok(())
    }

    pub fn validate_refund_allowed(prize_pool: &PrizePool) -> Result<(), Error> {
        if prize_pool.status != PrizePoolStatus::Active
            && prize_pool.status != PrizePoolStatus::Cancelled
        {
            return Err(Error::RefundNotAllowed);
        }
        Ok(())
    }
}

