use soroban_sdk::{contractevent, Address, Env};

#[contractevent(topics = ["ZKProof", "VERIFIED"])]
pub struct ProofVerified {
    pub proof_id: u64,
    pub verifier: Address,
    pub proof_type: u32,
}

#[contractevent(topics = ["ZKProof", "GENERATED"])]
pub struct ProofGenerated {
    pub proof_id: u64,
    pub generator: Address,
    pub proof_type: u32,
}

#[contractevent(topics = ["ZKProof", "PRIVATE_TX"])]
pub struct PrivateTransaction {
    pub tx_id: u64,
    pub proof_id: u64,
}

#[contractevent(topics = ["ZKProof", "ANON_VOTE"])]
pub struct AnonymousVote {
    pub vote_id: u64,
    pub proof_id: u64,
}

pub fn emit_proof_verified(env: &Env, proof_id: u64, verifier: &Address, proof_type: u32) {
    ProofVerified {
        proof_id,
        verifier: verifier.clone(),
        proof_type,
    }
    .publish(env);
}

pub fn emit_proof_generated(env: &Env, proof_id: u64, generator: &Address, proof_type: u32) {
    ProofGenerated {
        proof_id,
        generator: generator.clone(),
        proof_type,
    }
    .publish(env);
}

pub fn emit_private_transaction(env: &Env, tx_id: u64, proof_id: u64) {
    PrivateTransaction { tx_id, proof_id }.publish(env);
}

pub fn emit_anonymous_vote(env: &Env, vote_id: u64, proof_id: u64) {
    AnonymousVote { vote_id, proof_id }.publish(env);
}

/// One proof inside a batch passed the accumulated Groth16 check (#1413).
#[contractevent(topics = ["ZKProof", "BATCH_PROOF"])]
pub struct BatchProofVerified {
    pub batch_id: u64,
    pub index: u32,
    pub verifier: Address,
}

/// A whole batch passed the accumulated Groth16 check (#1413).
#[contractevent(topics = ["ZKProof", "BATCH_OK"])]
pub struct BatchVerified {
    pub batch_id: u64,
    pub verifier: Address,
    pub size: u32,
}

pub fn emit_batch_proof_verified(env: &Env, batch_id: u64, index: u32, verifier: &Address) {
    BatchProofVerified {
        batch_id,
        index,
        verifier: verifier.clone(),
    }
    .publish(env);
}

pub fn emit_batch_verified(env: &Env, batch_id: u64, verifier: &Address, size: u32) {
    BatchVerified {
        batch_id,
        verifier: verifier.clone(),
        size,
    }
    .publish(env);
}
