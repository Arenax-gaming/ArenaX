#![no_std]

mod error;
mod types;

use error::RngError;
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Vec};
use types::{DataKey, RequestStatus, RngRequest};

#[contract]
pub struct RandomGenerationContract;

#[contractimpl]
impl RandomGenerationContract {
    /// Initializes the RNG contract with an admin and trusted oracle
    pub fn initialize(env: Env, admin: Address, oracle: Address) -> Result<(), RngError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RngError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        env.storage().instance().set(&DataKey::RequestCount, &0u64);
        Ok(())
    }

    /// Requests a new random number utilizing a commit-reveal scheme
    pub fn request_random_number(
        env: Env,
        requester: Address,
        seed: u64,
        commitment: BytesN<32>,
    ) -> Result<u64, RngError> {
        requester.require_auth();

        let mut count: u64 = env.storage().instance().get(&DataKey::RequestCount).unwrap_or(0);
        count += 1;

        let request = RngRequest {
            id: count,
            requester: requester.clone(),
            seed,
            commitment: commitment.clone(),
            timestamp: env.ledger().timestamp(),
            status: RequestStatus::Pending,
            random_value: None,
        };

        env.storage().persistent().set(&DataKey::Request(count), &request);
        env.storage().instance().set(&DataKey::RequestCount, &count);

        // Audit trail via event emission
        env.events().publish(("RNG", "request_created"), (count, requester, commitment));

        Ok(count)
    }

    /// Oracle reveals the value and fulfills the randomness request
    pub fn fulfill_random_request(
        env: Env,
        request_id: u64,
        reveal: Bytes,
    ) -> Result<u64, RngError> {
        let oracle: Address = env.storage().instance().get(&DataKey::Oracle).ok_or(RngError::NotInitialized)?;
        oracle.require_auth();

        let mut request: RngRequest = env.storage().persistent().get(&DataKey::Request(request_id)).ok_or(RngError::RequestNotFound)?;

        if request.status != RequestStatus::Pending {
            return Err(RngError::RequestAlreadyFulfilled);
        }

        // Verify the cryptographically secure commitment
        let hash = env.crypto().sha256(&reveal);
        if hash != request.commitment {
            return Err(RngError::InvalidCommitment);
        }

        // Combine Oracle's reveal with Requester's seed to prevent manipulation
        let mut combined = Bytes::new(&env);
        combined.append(&reveal);
        combined.extend_from_array(&request.seed.to_be_bytes());

        let final_hash = env.crypto().sha256(&combined);
        let mut val_bytes = [0u8; 8];
        for i in 0..8 {
            val_bytes[i] = final_hash.get(i as u32).unwrap();
        }
        let random_value = u64::from_be_bytes(val_bytes);

        request.status = RequestStatus::Fulfilled;
        request.random_value = Some(random_value);

        env.storage().persistent().set(&DataKey::Request(request_id), &request);
        env.events().publish(("RNG", "request_fulfilled"), (request_id, random_value));

        Ok(random_value)
    }

    /// Publicly verifiable randomness checker using the proof (the reveal bytes)
    pub fn verify_randomness(env: Env, request_id: u64, proof: Bytes) -> Result<bool, RngError> {
        let request: RngRequest = env.storage().persistent().get(&DataKey::Request(request_id)).ok_or(RngError::RequestNotFound)?;
        
        if request.status != RequestStatus::Fulfilled {
            return Err(RngError::InvalidState);
        }

        let hash = env.crypto().sha256(&proof);
        Ok(hash == request.commitment)
    }

    /// Associates and securely stores randomness for a specific game and round
    pub fn set_game_randomness(env: Env, request_id: u64, game_id: BytesN<32>, round: u32) -> Result<(), RngError> {
        let request: RngRequest = env.storage().persistent().get(&DataKey::Request(request_id)).ok_or(RngError::RequestNotFound)?;
        if request.status != RequestStatus::Fulfilled {
            return Err(RngError::InvalidState);
        }
        
        let val = request.random_value.unwrap();
        env.storage().persistent().set(&DataKey::GameRng(game_id, round), &val);
        Ok(())
    }

    /// Retrieves game-specific RNG contexts
    pub fn get_game_randomness(env: Env, game_id: BytesN<32>, round: u32) -> Result<u64, RngError> {
        env.storage().persistent().get(&DataKey::GameRng(game_id, round)).ok_or(RngError::RequestNotFound)
    }

    /// Generates a fair and verifiable sequence of tournament seeds
    pub fn generate_tournament_seeds(
        env: Env,
        tournament_id: BytesN<32>,
        request_id: u64,
        participant_count: u32,
    ) -> Result<Vec<u64>, RngError> {
        let request: RngRequest = env.storage().persistent().get(&DataKey::Request(request_id)).ok_or(RngError::RequestNotFound)?;

        if request.status != RequestStatus::Fulfilled {
            return Err(RngError::InvalidState);
        }

        let base_rng = request.random_value.unwrap();
        let mut seeds = Vec::new(&env);

        // Expansion algorithm utilizing the secure base_rng
        for i in 0..participant_count {
            let mut payload = Bytes::new(&env);
            payload.extend_from_array(&base_rng.to_be_bytes());
            payload.extend_from_array(&i.to_be_bytes());
            
            let hash = env.crypto().sha256(&payload);
            let mut val_bytes = [0u8; 8];
            for j in 0..8 {
                val_bytes[j] = hash.get(j as u32).unwrap();
            }
            seeds.push_back(u64::from_be_bytes(val_bytes));
        }

        env.storage().persistent().set(&DataKey::TourneySeeds(tournament_id.clone()), &seeds);
        env.events().publish(("RNG", "tournament_seeds_generated"), (tournament_id, participant_count));
        
        Ok(seeds)
    }
    
    /// Query historical audit logs directly by returning the RngRequest details
    pub fn audit_randomness_history(env: Env, request_id: u64) -> Result<RngRequest, RngError> {
        env.storage().persistent().get(&DataKey::Request(request_id)).ok_or(RngError::RequestNotFound)
    }
}