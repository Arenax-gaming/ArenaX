use super::*;
use soroban_sdk::{testutils::Address as _, vec, Bytes, BytesN, Env, Vec};

fn h(env: &Env, bytes: &[u8]) -> BytesN<32> {
    env.crypto().sha256(&Bytes::from_slice(env, bytes)).into()
}

#[test]
fn verify_single_leaf_tree() {
    let env = Env::default();
    let leaf = h(&env, b"alice");
    let proof: Vec<BytesN<32>> = vec![&env];
    // A tree with a single leaf has the leaf as the root.
    assert!(verify_proof(&env, &leaf, &leaf, &proof));
}

#[test]
fn verify_two_leaf_tree() {
    let env = Env::default();
    let a = h(&env, b"alice");
    let b = h(&env, b"bob");
    let root = hash_pair_sorted(&env, &a, &b);

    // Proof for alice = [b]
    let proof_a: Vec<BytesN<32>> = vec![&env, b.clone()];
    assert!(verify_proof(&env, &root, &a, &proof_a));

    // Proof for bob = [a]
    let proof_b: Vec<BytesN<32>> = vec![&env, a.clone()];
    assert!(verify_proof(&env, &root, &b, &proof_b));

    // Wrong sibling → fails.
    let bogus = h(&env, b"mallory");
    let proof_bogus: Vec<BytesN<32>> = vec![&env, bogus];
    assert!(!verify_proof(&env, &root, &a, &proof_bogus));
}

#[test]
fn verify_four_leaf_tree() {
    let env = Env::default();
    let a = h(&env, b"alice");
    let b = h(&env, b"bob");
    let c = h(&env, b"carol");
    let d = h(&env, b"dave");
    let ab = hash_pair_sorted(&env, &a, &b);
    let cd = hash_pair_sorted(&env, &c, &d);
    let root = hash_pair_sorted(&env, &ab, &cd);

    // Proof for alice = [b, cd]
    let proof_a: Vec<BytesN<32>> = vec![&env, b.clone(), cd.clone()];
    assert!(verify_proof(&env, &root, &a, &proof_a));

    // Proof for dave = [c, ab]
    let proof_d: Vec<BytesN<32>> = vec![&env, c.clone(), ab.clone()];
    assert!(verify_proof(&env, &root, &d, &proof_d));
}

#[test]
fn hash_pair_is_order_independent() {
    let env = Env::default();
    let a = h(&env, b"a");
    let b = h(&env, b"b");
    assert_eq!(
        hash_pair_sorted(&env, &a, &b),
        hash_pair_sorted(&env, &b, &a),
    );
}

#[test]
fn full_claim_flow_two_leaves() {
    let env = Env::default();
    let contract_id = env.register(MerkleAirdropRegistry, ());
    let client = MerkleAirdropRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin);

    // Build a two-leaf tree off-chain (leaves = sha256("alice"), sha256("bob")).
    let leaf_a = h(&env, b"alice");
    let leaf_b = h(&env, b"bob");
    let root = hash_pair_sorted(&env, &leaf_a, &leaf_b);

    let campaign_id = Bytes::from_slice(&env, b"airdrop_1");
    client.set_root(&campaign_id, &root);
    assert_eq!(client.get_root(&campaign_id), root);

    // Alice claims with proof [b].
    let proof_a: Vec<BytesN<32>> = vec![&env, leaf_b.clone()];
    assert!(client.verify(&campaign_id, &leaf_a, &proof_a));
    client.claim(&campaign_id, &alice, &leaf_a, &proof_a);
    assert!(client.is_claimed(&campaign_id, &leaf_a));

    // Bob still can claim independently.
    let proof_b: Vec<BytesN<32>> = vec![&env, leaf_a.clone()];
    client.claim(&campaign_id, &bob, &leaf_b, &proof_b);
    assert!(client.is_claimed(&campaign_id, &leaf_b));
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn double_claim_rejected() {
    let env = Env::default();
    let contract_id = env.register(MerkleAirdropRegistry, ());
    let client = MerkleAirdropRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin);

    let leaf_a = h(&env, b"alice");
    let leaf_b = h(&env, b"bob");
    let root = hash_pair_sorted(&env, &leaf_a, &leaf_b);
    let campaign_id = Bytes::from_slice(&env, b"airdrop_1");
    client.set_root(&campaign_id, &root);

    let proof: Vec<BytesN<32>> = vec![&env, leaf_b];
    client.claim(&campaign_id, &alice, &leaf_a, &proof);
    client.claim(&campaign_id, &alice, &leaf_a, &proof);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn invalid_proof_rejected() {
    let env = Env::default();
    let contract_id = env.register(MerkleAirdropRegistry, ());
    let client = MerkleAirdropRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin);

    let leaf_a = h(&env, b"alice");
    let leaf_b = h(&env, b"bob");
    let root = hash_pair_sorted(&env, &leaf_a, &leaf_b);
    let campaign_id = Bytes::from_slice(&env, b"airdrop_1");
    client.set_root(&campaign_id, &root);

    // Wrong sibling
    let bogus = h(&env, b"mallory");
    let bad_proof: Vec<BytesN<32>> = vec![&env, bogus];
    client.claim(&campaign_id, &alice, &leaf_a, &bad_proof);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn claim_without_root_set_rejected() {
    let env = Env::default();
    let contract_id = env.register(MerkleAirdropRegistry, ());
    let client = MerkleAirdropRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin);

    let leaf = h(&env, b"alice");
    let proof: Vec<BytesN<32>> = vec![&env];
    let campaign_id = Bytes::from_slice(&env, b"airdrop_404");
    client.claim(&campaign_id, &alice, &leaf, &proof);
}
