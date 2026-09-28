use soroban_sdk::{
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    testutils::{Address as _, Ledger as _},
    Address, Bytes, Env, Vec, U256,
};

use crate::{Proof, VerifyingKey, ZkProof, ZkProofClient};

fn fr(env: &Env, n: u32) -> Fr {
    Fr::from_u256(U256::from_u32(env, n))
}

/// Build a verifying key and a matching Groth16 proof for one public input.
///
/// With base points P (G1) and Q (G2): alpha = aP, beta = bQ, gamma = delta = Q,
/// ic = [r0 P, r1 P]. Choosing B = Q, C = cP and A = (ab + r0 + r1*s + c) P
/// satisfies e(A, B) = e(alpha, beta) · e(vk_x, gamma) · e(C, delta).
fn groth16_fixture(env: &Env, input: u32, c: u32) -> (VerifyingKey, Bytes, Vec<Bytes>) {
    let bls = env.crypto().bls12_381();
    let dst = Bytes::from_slice(env, b"ARENAX-ZK-TEST");
    let p: G1Affine = bls.hash_to_g1(&Bytes::from_slice(env, b"g1"), &dst);
    let q: G2Affine = bls.hash_to_g2(&Bytes::from_slice(env, b"g2"), &dst);
    let (a, b, r0, r1, s) = (
        fr(env, 3),
        fr(env, 5),
        fr(env, 7),
        fr(env, 11),
        fr(env, input),
    );

    let mut ic = Vec::new(env);
    ic.push_back((p.clone() * r0.clone()).to_bytes());
    ic.push_back((p.clone() * r1.clone()).to_bytes());
    let vk = VerifyingKey {
        alpha_g1: (p.clone() * a.clone()).to_bytes(),
        beta_g2: (q.clone() * b.clone()).to_bytes(),
        gamma_g2: q.to_bytes(),
        delta_g2: q.to_bytes(),
        ic,
    };

    let x = a * b + r0 + r1 * s + fr(env, 9);
    let mut proof_data = Bytes::new(env);
    proof_data.append(&Bytes::from((p.clone() * x).to_bytes()));
    proof_data.append(&Bytes::from(q.to_bytes()));
    proof_data.append(&Bytes::from((p * fr(env, c)).to_bytes()));

    let mut public_inputs = Vec::new(env);
    public_inputs.push_back(Bytes::from(fr(env, input).to_bytes()));
    (vk, proof_data, public_inputs)
}

fn setup_verifier(env: &Env) -> (ZkProofClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(ZkProof, ());
    let client = ZkProofClient::new(env, &contract_id);
    client.initialize(&Address::generate(env));
    (client, Address::generate(env))
}

#[test]
fn test_valid_groth16_proof_verifies() {
    let env = Env::default();
    let (client, user) = setup_verifier(&env);
    let (vk, proof_data, inputs) = groth16_fixture(&env, 42, 9);
    client.set_verifying_key(&vk);

    let id = client.generate_proof(&user, &1u32, &proof_data, &inputs);
    assert!(client.verify_proof(&user, &id));
    assert!(client.get_proof(&id).verified);
}

#[test]
fn test_tampered_proof_rejected() {
    let env = Env::default();
    let (client, user) = setup_verifier(&env);
    // C does not match the scalar folded into A.
    let (vk, proof_data, inputs) = groth16_fixture(&env, 42, 10);
    client.set_verifying_key(&vk);

    let id = client.generate_proof(&user, &1u32, &proof_data, &inputs);
    assert!(!client.verify_proof(&user, &id));
    assert!(!client.get_proof(&id).verified);
}

#[test]
fn test_wrong_public_inputs_rejected() {
    let env = Env::default();
    let (client, user) = setup_verifier(&env);
    let (vk, proof_data, _) = groth16_fixture(&env, 42, 9);
    client.set_verifying_key(&vk);

    let mut wrong = Vec::new(&env);
    wrong.push_back(Bytes::from(fr(&env, 43).to_bytes()));
    let id = client.generate_proof(&user, &1u32, &proof_data, &wrong);
    assert!(!client.verify_proof(&user, &id));
    assert!(!client.get_proof(&id).verified);
}

#[test]
fn test_malformed_proof_rejected() {
    let env = Env::default();
    let (client, user) = setup_verifier(&env);
    let (vk, _, inputs) = groth16_fixture(&env, 42, 9);
    client.set_verifying_key(&vk);

    let id = client.generate_proof(
        &user,
        &1u32,
        &Bytes::from_array(&env, &[0, 1, 2, 3]),
        &inputs,
    );
    assert!(!client.verify_proof(&user, &id));
}

#[test]
#[should_panic]
fn test_set_verifying_key_requires_admin() {
    let env = Env::default();
    let contract_id = env.register(ZkProof, ());
    let client = ZkProofClient::new(&env, &contract_id);
    env.mock_all_auths();
    client.initialize(&Address::generate(&env));
    let (vk, _, _) = groth16_fixture(&env, 1, 9);

    // Clear mocked auths: the admin signature is no longer provided.
    env.set_auths(&[]);
    client.set_verifying_key(&vk);
}

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
    let (vk, proof_data, public_inputs) = groth16_fixture(&env, 42, 9);
    client.set_verifying_key(&vk);

    // Generate a private transaction proof
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
