#![no_std]

use arenax_events::zk_proof as events;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, Vec};

// Proof type constants
pub const PROOF_TYPE_PRIVATE_TX: u32 = 1;
pub const PROOF_TYPE_ANONYMOUS_VOTE: u32 = 2;
pub const PROOF_TYPE_CONFIDENTIAL_DATA: u32 = 3;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    ProofCounter,
    Proof(u64),
    PrivateTx(u64),
    AnonymousVote(u64),
    ConfidentialData(u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proof {
    pub id: u64,
    pub proof_type: u32,
    pub generator: Address,
    pub verified: bool,
    pub proof_data: Bytes,
    pub public_inputs: Vec<Bytes>,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrivateTransaction {
    pub id: u64,
    pub proof_id: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AnonymousVote {
    pub id: u64,
    pub proof_id: u64,
    pub timestamp: u64,
}

#[contract]
pub struct ZkProof;

#[contractimpl]
impl ZkProof {
    /// Initialize the ZK proof contract with an admin
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ProofCounter, &0u64);
    }

    /// Generate a new ZK proof (off-chain proof data submitted on-chain)
    pub fn generate_proof(
        env: Env,
        generator: Address,
        proof_type: u32,
        proof_data: Bytes,
        public_inputs: Vec<Bytes>,
    ) -> u64 {
        generator.require_auth();

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProofCounter)
            .unwrap_or(0);
        counter += 1;

        let proof = Proof {
            id: counter,
            proof_type,
            generator: generator.clone(),
            verified: false,
            proof_data,
            public_inputs,
            timestamp: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Proof(counter), &proof);
        env.storage()
            .instance()
            .set(&DataKey::ProofCounter, &counter);

        events::emit_proof_generated(&env, counter, &generator, proof_type);

        counter
    }

    /// Verify a ZK proof
    pub fn verify_proof(env: Env, verifier: Address, proof_id: u64) -> bool {
        verifier.require_auth();

        let key = DataKey::Proof(proof_id);
        let mut proof: Proof = env
            .storage()
            .persistent()
            .get(&key)
            .expect("proof not found");

        // In a real implementation, we would verify the proof here
        // For now, we just mark it as verified (placeholder)
        proof.verified = true;
        env.storage().persistent().set(&key, &proof);

        events::emit_proof_verified(&env, proof_id, &verifier, proof.proof_type);

        true
    }

    /// Execute a private transaction using a verified ZK proof
    pub fn execute_private_transaction(env: Env, executor: Address, proof_id: u64) -> u64 {
        executor.require_auth();

        let proof_key = DataKey::Proof(proof_id);
        let proof: Proof = env
            .storage()
            .persistent()
            .get(&proof_key)
            .expect("proof not found");

        if !proof.verified {
            panic!("proof not verified");
        }
        if proof.proof_type != PROOF_TYPE_PRIVATE_TX {
            panic!("invalid proof type for private transaction");
        }

        let tx_id = env.ledger().timestamp();
        let private_tx = PrivateTransaction {
            id: tx_id,
            proof_id,
            timestamp: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::PrivateTx(tx_id), &private_tx);
        events::emit_private_transaction(&env, tx_id, proof_id);

        tx_id
    }

    /// Cast an anonymous vote using a verified ZK proof
    pub fn cast_anonymous_vote(env: Env, voter: Address, proof_id: u64) -> u64 {
        voter.require_auth();

        let proof_key = DataKey::Proof(proof_id);
        let proof: Proof = env
            .storage()
            .persistent()
            .get(&proof_key)
            .expect("proof not found");

        if !proof.verified {
            panic!("proof not verified");
        }
        if proof.proof_type != PROOF_TYPE_ANONYMOUS_VOTE {
            panic!("invalid proof type for anonymous vote");
        }

        let vote_id = env.ledger().timestamp();
        let anonymous_vote = AnonymousVote {
            id: vote_id,
            proof_id,
            timestamp: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::AnonymousVote(vote_id), &anonymous_vote);
        events::emit_anonymous_vote(&env, vote_id, proof_id);

        vote_id
    }

    /// Store confidential data using a verified ZK proof
    pub fn store_confidential_data(env: Env, owner: Address, proof_id: u64, data: Bytes) -> u64 {
        owner.require_auth();

        let proof_key = DataKey::Proof(proof_id);
        let proof: Proof = env
            .storage()
            .persistent()
            .get(&proof_key)
            .expect("proof not found");

        if !proof.verified {
            panic!("proof not verified");
        }
        if proof.proof_type != PROOF_TYPE_CONFIDENTIAL_DATA {
            panic!("invalid proof type for confidential data");
        }

        let data_id = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::ConfidentialData(data_id), &data);

        data_id
    }

    /// Get a proof by ID
    pub fn get_proof(env: Env, proof_id: u64) -> Proof {
        env.storage()
            .persistent()
            .get(&DataKey::Proof(proof_id))
            .expect("proof not found")
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }
}

#[cfg(test)]
mod test;
