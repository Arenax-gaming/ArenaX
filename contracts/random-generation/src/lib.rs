#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, Vec};

mod error;
mod storage;
mod types;

use error::Error;
use storage::*;
use types::*;

#[contract]
pub struct RandomGenerationContract;

#[contractimpl]
impl RandomGenerationContract {
    pub fn init(env: Env, admin: Address) {
        if has_admin(&env) {
            panic!("{}", Error::AlreadyInitialized as u32);
        }
        set_admin(&env, &admin);
    }

    pub fn admin(env: Env) -> Address {
        get_admin(&env)
    }

    pub fn request_random_number(env: Env, requester: Address, seed: u64, commit: [u8; 32], callback: Option<Address>) -> u64 {
        requester.require_auth();
        
        let request_id = get_next_request_id(&env);
        let request = RNGRequest {
            requester: requester.clone(),
            seed,
            commit,
            callback,
            timestamp: env.ledger().timestamp(),
            fulfilled: false,
            random_value: None,
        };
        
        set_request(&env, request_id, &request);
        request_id
    }

    pub fn fulfill_random_request(env: Env, request_id: u64, random_value: u64, reveal: [u8; 32]) {
        let admin = get_admin(&env);
        admin.require_auth();
        
        let mut request = get_request(&env, request_id).ok_or(Error::RequestNotFound).unwrap();
        
        if request.fulfilled {
            panic!("{}", Error::RequestAlreadyFulfilled as u32);
        }
        
        let computed_commit = Self::hash_reveal(&env, &reveal);
        if computed_commit != request.commit {
            panic!("{}", Error::InvalidCommit as u32);
        }
        
        request.fulfilled = true;
        request.random_value = Some(random_value);
        set_request(&env, request_id, &request);
        
        let audit_entry = AuditEntry {
            request_id,
            requester: request.requester.clone(),
            seed: request.seed,
            random_value,
            timestamp: env.ledger().timestamp(),
        };
        add_audit_entry(&env, &audit_entry);
    }

    pub fn verify_randomness(env: Env, request_id: u64, reveal: [u8; 32]) -> bool {
        let request = get_request(&env, request_id).ok_or(Error::RequestNotFound).unwrap();
        
        let computed_commit = Self::hash_reveal(&env, &reveal);
        if computed_commit != request.commit {
            return false;
        }
        
        request.fulfilled
    }

    pub fn get_game_randomness(env: Env, game_id: u64, round: u64) -> u64 {
        if let Some(gr) = get_game_randomness(&env, game_id, round) {
            return gr.random_value;
        }
        
        let admin = get_admin(&env);
        let seed = game_id ^ round ^ env.ledger().timestamp();
        
        let request_id = get_next_request_id(&env);
        let commit = Self::generate_commit(&env, seed);
        
        let request = RNGRequest {
            requester: admin.clone(),
            seed,
            commit,
            callback: None,
            timestamp: env.ledger().timestamp(),
            fulfilled: false,
            random_value: None,
        };
        set_request(&env, request_id, &request);
        
        let random_value = Self::generate_random(&env, seed);
        
        let mut request = get_request(&env, request_id).unwrap();
        request.fulfilled = true;
        request.random_value = Some(random_value);
        set_request(&env, request_id, &request);
        
        let game_randomness = GameRandomness {
            game_id,
            round,
            random_value,
            request_id,
            timestamp: env.ledger().timestamp(),
        };
        set_game_randomness(&env, &game_randomness);
        
        let audit_entry = AuditEntry {
            request_id,
            requester: admin,
            seed,
            random_value,
            timestamp: env.ledger().timestamp(),
        };
        add_audit_entry(&env, &audit_entry);
        
        random_value
    }

    pub fn generate_tournament_seeds(env: Env, tournament_id: u64, entrants: Vec<Address>) -> Vec<(Address, u64)> {
        let admin = get_admin(&env);
        admin.require_auth();
        
        if entrants.is_empty() {
            panic!("{}", Error::EmptyEntrants as u32);
        }
        
        let seed = tournament_id ^ env.ledger().timestamp();
        let request_id = get_next_request_id(&env);
        let commit = Self::generate_commit(&env, seed);
        
        let request = RNGRequest {
            requester: admin.clone(),
            seed,
            commit,
            callback: None,
            timestamp: env.ledger().timestamp(),
            fulfilled: false,
            random_value: None,
        };
        set_request(&env, request_id, &request);
        
        let mut seeds = Vec::new(&env);
        let mut rng_state = seed;
        
        for entrant in entrants.iter() {
            rng_state = Self::next_rand(rng_state);
            seeds.push_back((entrant.clone(), rng_state));
        }
        
        let mut request = get_request(&env, request_id).unwrap();
        request.fulfilled = true;
        request.random_value = Some(rng_state);
        set_request(&env, request_id, &request);
        
        let seeding = TournamentSeeding {
            tournament_id,
            seeds: seeds.clone(),
            request_id,
            timestamp: env.ledger().timestamp(),
        };
        set_tournament_seeding(&env, &seeding);
        
        let audit_entry = AuditEntry {
            request_id,
            requester: admin,
            seed,
            random_value: rng_state,
            timestamp: env.ledger().timestamp(),
        };
        add_audit_entry(&env, &audit_entry);
        
        seeds
    }

    pub fn audit_randomness_history(env: Env, start: u64, end: u64) -> Vec<AuditEntry> {
        get_audit_entries(&env, start, end)
    }

    pub fn get_request(env: Env, request_id: u64) -> Option<RNGRequest> {
        get_request(&env, request_id)
    }

    pub fn get_tournament_seeding(env: Env, tournament_id: u64) -> Option<TournamentSeeding> {
        get_tournament_seeding(&env, tournament_id)
    }

    fn hash_reveal(env: &Env, reveal: &[u8; 32]) -> [u8; 32] {
        let hash = env.crypto().sha256(reveal);
        hash.to_array()
    }

    fn generate_commit(env: &Env, seed: u64) -> [u8; 32] {
        let bytes = seed.to_be_bytes();
        let hash = env.crypto().sha256(&bytes);
        hash.to_array()
    }

    fn generate_random(env: &Env, seed: u64) -> u64 {
        let bytes = seed.to_be_bytes();
        let hash = env.crypto().sha256(&bytes);
        let mut rand_bytes = [0u8; 8];
        rand_bytes.copy_from_slice(&hash.to_array()[0..8]);
        u64::from_be_bytes(rand_bytes)
    }

    fn next_rand(state: u64) -> u64 {
        state.wrapping_mul(1103515245).wrapping_add(12345)
    }
}

#[cfg(test)]
mod test;
