use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, Vec};

use crate::{Proof, ZkProof, ZkProofClient};

#[test]
fn test() {
    let env = Env::default();
    let contract_id = env.register(ZkProof, ());
    let client = ZkProofClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);

    // Initialize contract
    client.initialize(&admin);

    // Generate a private transaction proof
    let proof_data = Bytes::from_array(&env, &[0, 1, 2, 3]);
    let public_inputs = Vec::new(&env);
    let proof_id = client.generate_proof(&user, &1u32, &proof_data, &public_inputs);
    assert_eq!(proof_id, 1);

    // Get the proof
    let proof: Proof = client.get_proof(&proof_id);
    assert_eq!(proof.id, 1);
    assert_eq!(proof.proof_type, 1);
    assert_eq!(proof.generator, user);
    assert!(!proof.verified);

    // Verify the proof
    let verified = client.verify_proof(&verifier, &proof_id);
    assert!(verified);

    // Check proof is now verified
    let proof: Proof = client.get_proof(&proof_id);
    assert!(proof.verified);

    // Execute private transaction
    let tx_id = client.execute_private_transaction(&user, &proof_id);
    assert!(tx_id > 0);
}
