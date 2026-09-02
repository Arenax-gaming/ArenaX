use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Bytes, Env, Vec,
};

use crate::{Proof, ZkProof, ZkProofClient};

#[test]
fn test() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10_000);
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

#[test]
fn test_pause_round_trip() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ZkProof, ());
    let client = ZkProofClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    assert!(!client.is_paused());
    client.set_paused(&true);
    assert!(client.is_paused());
    client.set_paused(&false);
    assert!(!client.is_paused());
}

#[test]
#[should_panic]
fn test_pause_unauthorized() {
    let env = Env::default();
    let contract_id = env.register(ZkProof, ());
    let client = ZkProofClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    // No mocked auths: the admin signature requirement is not satisfied.
    client.set_paused(&true);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_generate_proof_blocked_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ZkProof, ());
    let client = ZkProofClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);
    client.set_paused(&true);

    let proof_data = Bytes::from_array(&env, &[0, 1, 2, 3]);
    client.generate_proof(&user, &1u32, &proof_data, &Vec::new(&env));
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_verify_proof_blocked_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ZkProof, ());
    let client = ZkProofClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);

    client.initialize(&admin);
    let proof_data = Bytes::from_array(&env, &[0, 1, 2, 3]);
    let proof_id = client.generate_proof(&user, &1u32, &proof_data, &Vec::new(&env));

    client.set_paused(&true);
    client.verify_proof(&verifier, &proof_id);
}

#[test]
fn test_reads_work_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10_000);
    let contract_id = env.register(ZkProof, ());
    let client = ZkProofClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);
    let proof_data = Bytes::from_array(&env, &[0, 1, 2, 3]);
    let proof_id = client.generate_proof(&user, &1u32, &proof_data, &Vec::new(&env));

    client.set_paused(&true);

    // Read entry points must stay available during an emergency stop.
    assert!(client.is_paused());
    let proof: Proof = client.get_proof(&proof_id);
    assert_eq!(proof.id, proof_id);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_unpause_restores_mutations() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ZkProof, ());
    let client = ZkProofClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);
    client.set_paused(&true);
    client.set_paused(&false);

    let proof_data = Bytes::from_array(&env, &[9, 9, 9]);
    let proof_id = client.generate_proof(&user, &2u32, &proof_data, &Vec::new(&env));
    assert_eq!(proof_id, 1);
}
