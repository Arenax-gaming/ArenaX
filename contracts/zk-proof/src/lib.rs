#![no_std]

use arenax_events::zk_proof as events;
use soroban_sdk::{
    contract, contractimpl, contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    symbol_short, Address, Bytes, BytesN, Env, Vec,
};

// Proof type constants
pub const PROOF_TYPE_PRIVATE_TX: u32 = 1;
pub const PROOF_TYPE_ANONYMOUS_VOTE: u32 = 2;
pub const PROOF_TYPE_CONFIDENTIAL_DATA: u32 = 3;

/// Serialized Groth16 proof: A (G1, 96 bytes) || B (G2, 192 bytes) || C (G1, 96 bytes),
/// all points uncompressed as accepted by the Soroban BLS12-381 host functions.
pub const G1_LEN: u32 = 96;
pub const G2_LEN: u32 = 192;
pub const PROOF_LEN: u32 = G1_LEN * 2 + G2_LEN;
/// Each public input is a 32-byte big-endian BLS12-381 scalar.
pub const PUBLIC_INPUT_LEN: u32 = 32;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    ProofCounter,
    Proof(u64),
    PrivateTx(u64),
    AnonymousVote(u64),
    ConfidentialData(u64),
    Paused,
    VerifyingKey,
}

/// Groth16 verifying key over BLS12-381. `ic` holds one point per public
/// input plus the constant term at index 0.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifyingKey {
    pub alpha_g1: BytesN<96>,
    pub beta_g2: BytesN<192>,
    pub gamma_g2: BytesN<192>,
    pub delta_g2: BytesN<192>,
    pub ic: Vec<BytesN<96>>,
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
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    /// Generate a new ZK proof (off-chain proof data submitted on-chain)
    pub fn generate_proof(
        env: Env,
        generator: Address,
        proof_type: u32,
        proof_data: Bytes,
        public_inputs: Vec<Bytes>,
    ) -> u64 {
        Self::require_not_paused(&env);
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

    /// Set or replace the Groth16 verifying key (admin only).
    pub fn set_verifying_key(env: Env, vk: VerifyingKey) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        if vk.ic.is_empty() {
            panic!("verifying key must contain at least one IC point");
        }
        env.storage().instance().set(&DataKey::VerifyingKey, &vk);
    }

    pub fn get_verifying_key(env: Env) -> VerifyingKey {
        env.storage()
            .instance()
            .get(&DataKey::VerifyingKey)
            .expect("verifying key not set")
    }

    /// Verify a stored proof with the Groth16 pairing check against the
    /// admin-set verifying key. Returns `false` without touching storage when
    /// the proof is malformed or fails verification.
    ///
    /// Cost: one 4-pair BLS12-381 pairing check plus one G1 MSM of size n
    /// (n = public inputs), all executed as native host functions.
    pub fn verify_proof(env: Env, verifier: Address, proof_id: u64) -> bool {
        Self::require_not_paused(&env);
        verifier.require_auth();

        let key = DataKey::Proof(proof_id);
        let mut proof: Proof = env
            .storage()
            .persistent()
            .get(&key)
            .expect("proof not found");
        let vk = Self::get_verifying_key(env.clone());

        if !Self::groth16_verify(&env, &vk, &proof.proof_data, &proof.public_inputs) {
            return false;
        }

        proof.verified = true;
        env.storage().persistent().set(&key, &proof);

        events::emit_proof_verified(&env, proof_id, &verifier, proof.proof_type);

        true
    }

    /// Execute a private transaction using a verified ZK proof
    pub fn execute_private_transaction(env: Env, executor: Address, proof_id: u64) -> u64 {
        Self::require_not_paused(&env);
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
        Self::require_not_paused(&env);
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
        Self::require_not_paused(&env);
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

    /// Pause or resume the contract (admin only, emergency stop).
    ///
    /// Deliberately NOT guarded by `require_not_paused` — unpausing must stay
    /// reachable while paused. The flag lives in instance storage, which
    /// persists across wasm upgrades of this contract at the same address.
    pub fn set_paused(env: Env, paused: bool) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage().instance().set(&DataKey::Paused, &paused);

        if paused {
            arenax_events::emergency_pause::emit_paused(
                &env,
                &env.current_contract_address(),
                &admin,
                &symbol_short!("ADMIN"),
            );
        } else {
            arenax_events::emergency_pause::emit_unpaused(
                &env,
                &env.current_contract_address(),
                &admin,
            );
        }
    }

    /// Check if the contract is paused (read; works while paused).
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Groth16 check: e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1,
    /// where vk_x = ic[0] + sum(input_i · ic[i + 1]).
    fn groth16_verify(
        env: &Env,
        vk: &VerifyingKey,
        proof_data: &Bytes,
        public_inputs: &Vec<Bytes>,
    ) -> bool {
        if proof_data.len() != PROOF_LEN || public_inputs.len() + 1 != vk.ic.len() {
            return false;
        }
        let bls = env.crypto().bls12_381();

        let a = G1Affine::from_bytes(Self::slice_n::<96>(env, proof_data, 0));
        let b = G2Affine::from_bytes(Self::slice_n::<192>(env, proof_data, G1_LEN));
        let c = G1Affine::from_bytes(Self::slice_n::<96>(env, proof_data, G1_LEN + G2_LEN));

        let mut vk_x = G1Affine::from_bytes(vk.ic.get_unchecked(0));
        if !public_inputs.is_empty() {
            let mut points = Vec::new(env);
            let mut scalars = Vec::new(env);
            for (i, input) in public_inputs.iter().enumerate() {
                if input.len() != PUBLIC_INPUT_LEN {
                    return false;
                }
                points.push_back(G1Affine::from_bytes(vk.ic.get_unchecked(i as u32 + 1)));
                scalars.push_back(Fr::from_bytes(Self::slice_n::<32>(env, &input, 0)));
            }
            vk_x = bls.g1_add(&vk_x, &bls.g1_msm(points, scalars));
        }

        let mut g1 = Vec::new(env);
        g1.push_back(-a);
        g1.push_back(G1Affine::from_bytes(vk.alpha_g1.clone()));
        g1.push_back(vk_x);
        g1.push_back(c);
        let mut g2 = Vec::new(env);
        g2.push_back(b);
        g2.push_back(G2Affine::from_bytes(vk.beta_g2.clone()));
        g2.push_back(G2Affine::from_bytes(vk.gamma_g2.clone()));
        g2.push_back(G2Affine::from_bytes(vk.delta_g2.clone()));

        bls.pairing_check(g1, g2)
    }

    fn slice_n<const N: usize>(env: &Env, bytes: &Bytes, start: u32) -> BytesN<N> {
        let mut buf = [0u8; N];
        bytes
            .slice(start..start + N as u32)
            .copy_into_slice(&mut buf);
        BytesN::from_array(env, &buf)
    }

    fn require_not_paused(env: &Env) {
        if Self::is_paused(env.clone()) {
            panic!("contract is paused");
        }
    }
}

#[cfg(test)]
mod test;
