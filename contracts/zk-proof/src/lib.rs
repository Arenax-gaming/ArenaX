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

/// Upper bound on proofs per `batch_verify` call (#1413). A batch of n costs
/// one (n + 3)-pair pairing check plus n G1 MSMs; 8 keeps that comfortably
/// inside a single transaction's CPU/memory budget.
pub const MAX_BATCH_SIZE: u32 = 8;

/// Domain separator for the Fiat-Shamir batch weights.
const BATCH_TRANSCRIPT_DST: &[u8] = b"ARENAX-ZK-BATCH-V1";

/// One (proof, public inputs) pair submitted to `batch_verify`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchProof {
    pub proof_data: Bytes,
    pub public_inputs: Vec<Bytes>,
}

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
    BatchCounter,
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

    /// Batch-verify up to [`MAX_BATCH_SIZE`] (proof, public inputs) pairs in
    /// one invocation (#1413).
    ///
    /// The batch is accumulated into a single Groth16 pairing check using a
    /// random linear combination with Fiat-Shamir weights `r_i` derived from
    /// the whole batch (so a prover cannot pick proofs after seeing them):
    ///
    /// Π e(-r_i·A_i, B_i) · e((Σ r_i)·alpha, beta) · e(Σ r_i·vk_x_i, gamma)
    ///   · e(Σ r_i·C_i, delta) == 1
    ///
    /// All-or-nothing: if any proof is malformed or invalid the call panics,
    /// so the transaction — including every per-proof event — is reverted.
    /// On success one `BATCH_PROOF` event is emitted per proof plus a
    /// `BATCH_OK` summary, and the new batch id is returned.
    pub fn batch_verify(env: Env, verifier: Address, batch: Vec<BatchProof>) -> u64 {
        Self::require_not_paused(&env);
        verifier.require_auth();

        let size = batch.len();
        if size == 0 {
            panic!("empty batch");
        }
        if size > MAX_BATCH_SIZE {
            panic!("batch exceeds MAX_BATCH_SIZE");
        }

        let vk = Self::get_verifying_key(env.clone());
        if !Self::groth16_batch_verify(&env, &vk, &batch) {
            panic!("batch verification failed");
        }

        let batch_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BatchCounter)
            .unwrap_or(0u64)
            + 1;
        env.storage()
            .instance()
            .set(&DataKey::BatchCounter, &batch_id);

        for index in 0..size {
            events::emit_batch_proof_verified(&env, batch_id, index, &verifier);
        }
        events::emit_batch_verified(&env, batch_id, &verifier, size);

        batch_id
    }

    /// Number of batches that have passed `batch_verify`.
    pub fn get_batch_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::BatchCounter)
            .unwrap_or(0)
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
        let (a, b, c, vk_x) = match Self::parse_proof(env, vk, proof_data, public_inputs) {
            Some(parsed) => parsed,
            None => return false,
        };
        let bls = env.crypto().bls12_381();

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

    /// Decode a proof into (A, B, C) and fold its public inputs into
    /// vk_x = ic[0] + sum(input_i · ic[i + 1]). `None` if malformed.
    fn parse_proof(
        env: &Env,
        vk: &VerifyingKey,
        proof_data: &Bytes,
        public_inputs: &Vec<Bytes>,
    ) -> Option<(G1Affine, G2Affine, G1Affine, G1Affine)> {
        if proof_data.len() != PROOF_LEN || public_inputs.len() + 1 != vk.ic.len() {
            return None;
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
                    return None;
                }
                points.push_back(G1Affine::from_bytes(vk.ic.get_unchecked(i as u32 + 1)));
                scalars.push_back(Fr::from_bytes(Self::slice_n::<32>(env, &input, 0)));
            }
            vk_x = bls.g1_add(&vk_x, &bls.g1_msm(points, scalars));
        }
        Some((a, b, c, vk_x))
    }

    /// Fiat-Shamir weights: r_i = H(H(dst || batch) || i) mod r. Binding the
    /// weights to every proof and input means an invalid proof cannot be
    /// crafted to cancel out against the others.
    fn batch_weights(env: &Env, batch: &Vec<BatchProof>) -> Vec<Fr> {
        let mut transcript = Bytes::from_slice(env, BATCH_TRANSCRIPT_DST);
        for item in batch.iter() {
            transcript.extend_from_array(&item.proof_data.len().to_be_bytes());
            transcript.append(&item.proof_data);
            transcript.extend_from_array(&item.public_inputs.len().to_be_bytes());
            for input in item.public_inputs.iter() {
                transcript.extend_from_array(&input.len().to_be_bytes());
                transcript.append(&input);
            }
        }
        let seed: BytesN<32> = env.crypto().sha256(&transcript).to_bytes();

        let mut weights = Vec::new(env);
        for i in 0..batch.len() {
            let mut buf = Bytes::from(seed.clone());
            buf.extend_from_array(&i.to_be_bytes());
            let digest: BytesN<32> = env.crypto().sha256(&buf).to_bytes();
            weights.push_back(Fr::from_bytes(digest));
        }
        weights
    }

    /// Accumulated Groth16 check over the whole batch (see `batch_verify`).
    fn groth16_batch_verify(env: &Env, vk: &VerifyingKey, batch: &Vec<BatchProof>) -> bool {
        let bls = env.crypto().bls12_381();
        let weights = Self::batch_weights(env, batch);

        let mut g1 = Vec::new(env);
        let mut g2 = Vec::new(env);
        let mut weight_sum: Option<Fr> = None;
        let mut acc_vk_x: Option<G1Affine> = None;
        let mut acc_c: Option<G1Affine> = None;

        for (i, item) in batch.iter().enumerate() {
            let (a, b, c, vk_x) =
                match Self::parse_proof(env, vk, &item.proof_data, &item.public_inputs) {
                    Some(parsed) => parsed,
                    None => return false,
                };
            let r = weights.get_unchecked(i as u32);

            g1.push_back(-bls.g1_mul(&a, &r));
            g2.push_back(b);

            let weighted_vk_x = bls.g1_mul(&vk_x, &r);
            acc_vk_x = Some(match acc_vk_x {
                Some(acc) => bls.g1_add(&acc, &weighted_vk_x),
                None => weighted_vk_x,
            });
            let weighted_c = bls.g1_mul(&c, &r);
            acc_c = Some(match acc_c {
                Some(acc) => bls.g1_add(&acc, &weighted_c),
                None => weighted_c,
            });
            weight_sum = Some(match weight_sum {
                Some(sum) => sum + r,
                None => r,
            });
        }

        let (weight_sum, acc_vk_x, acc_c) = match (weight_sum, acc_vk_x, acc_c) {
            (Some(s), Some(v), Some(c)) => (s, v, c),
            _ => return false,
        };

        g1.push_back(bls.g1_mul(&G1Affine::from_bytes(vk.alpha_g1.clone()), &weight_sum));
        g2.push_back(G2Affine::from_bytes(vk.beta_g2.clone()));
        g1.push_back(acc_vk_x);
        g2.push_back(G2Affine::from_bytes(vk.gamma_g2.clone()));
        g1.push_back(acc_c);
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
