use soroban_sdk::{Address, Env, Vec};
use crate::types::{DataKey, DistributionRules, Participant, PrizePool};
use crate::errors::Error;

pub struct Storage;

impl Storage {
    // Admin operations
    pub fn has_admin(env: &Env) -> bool {
        env.storage().instance().has(&DataKey::Admin)
    }

    pub fn set_admin(env: &Env, admin: &Address) {
        env.storage().instance().set(&DataKey::Admin, admin);
    }

    pub fn get_admin(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::Unauthorized)
    }

    // Pause operations
    pub fn set_paused(env: &Env, paused: bool) {
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    pub fn is_paused(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // Token operations
    pub fn set_token_address(env: &Env, token_address: &Address) {
        env.storage().instance().set(&DataKey::TokenAddress, token_address);
    }

    pub fn get_token_address(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .ok_or(Error::InvalidParameter)
    }

    // Prize pool operations
    pub fn has_prize_pool(env: &Env, tournament_id: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::PrizePool(tournament_id))
    }

    pub fn set_prize_pool(env: &Env, tournament_id: u64, prize_pool: &PrizePool) {
        env.storage()
            .persistent()
            .set(&DataKey::PrizePool(tournament_id), prize_pool);
    }

    pub fn get_prize_pool(env: &Env, tournament_id: u64) -> Result<PrizePool, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::PrizePool(tournament_id))
            .ok_or(Error::PrizePoolNotFound)
    }

    // Distribution rules operations
    pub fn set_distribution_rules(
        env: &Env,
        tournament_id: u64,
        rules: &DistributionRules,
    ) {
        env.storage()
            .persistent()
            .set(&DataKey::DistributionRules(tournament_id), rules);
    }

    pub fn get_distribution_rules(
        env: &Env,
        tournament_id: u64,
    ) -> Result<DistributionRules, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::DistributionRules(tournament_id))
            .ok_or(Error::PrizePoolNotFound)
    }

    // Participants operations
    pub fn init_participants(env: &Env, tournament_id: u64) {
        let participants: Vec<Participant> = Vec::new(env);
        env.storage()
            .persistent()
            .set(&DataKey::Participants(tournament_id), &participants);
    }

    pub fn set_participants(
        env: &Env,
        tournament_id: u64,
        participants: &Vec<Participant>,
    ) {
        env.storage()
            .persistent()
            .set(&DataKey::Participants(tournament_id), participants);
    }

    pub fn get_participants(
        env: &Env,
        tournament_id: u64,
    ) -> Result<Vec<Participant>, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Participants(tournament_id))
            .ok_or(Error::PrizePoolNotFound)
    }
}
