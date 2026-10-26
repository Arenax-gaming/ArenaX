#![cfg(test)]

extern crate std;

use super::{compute_leaf, hash_sorted_pair, AirdropContract, AirdropContractClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token, Address, BytesN, Env, Vec};

fn setup() -> (
    Env,
    AirdropContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let recovery = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    let contract_id = env.register(AirdropContract, ());
    let client = AirdropContractClient::new(&env, &contract_id);

    let placeholder = BytesN::from_array(&env, &[0u8; 32]);
    client.initialize(
        &admin,
        &token_addr,
        &placeholder,
        &1_000_000i128,
        &50_000u64,
        &recovery,
    );
    token::StellarAssetClient::new(&env, &token_addr).mint(&contract_id, &1_000_000i128);

    (env, client, claimant, recovery, token_addr, contract_id)
}

fn proof_root(env: &Env, leaf: &BytesN<32>, proof: &Vec<BytesN<32>>) -> BytesN<32> {
    let mut current = leaf.clone();
    let mut i = 0u32;
    while i < proof.len() {
        let sibling = proof.get(i).unwrap();
        current = hash_sorted_pair(env, &current, &sibling);
        i += 1;
    }
    current
}

fn single_leaf_drop(env: &Env, client: &AirdropContractClient, claimant: &Address, amount: i128) {
    let leaf = compute_leaf(env, claimant, amount);
    let proof = Vec::new(env);
    let root = proof_root(env, &leaf, &proof);
    client.configure_airdrop(&root, &amount, &10_000u64);
}

#[test]
fn valid_proof_claims_tokens() {
    let (env, client, claimant, _, token_addr, _) = setup();
    let amount = 250i128;
    single_leaf_drop(&env, &client, &claimant, amount);

    let result = client.claim(&claimant, &Vec::new(&env), &amount);
    assert_eq!(result.amount, amount);
    assert!(client.has_claimed(&claimant));
    assert_eq!(
        token::Client::new(&env, &token_addr).balance(&claimant),
        amount
    );
    assert_eq!(client.get_claimed_amount(), amount);
}

#[test]
#[should_panic(expected = "invalid merkle proof")]
fn invalid_proof_is_rejected() {
    let (env, client, claimant, _, _, _) = setup();
    let amount = 250i128;
    single_leaf_drop(&env, &client, &claimant, amount);

    let mut bogus = [0u8; 32];
    bogus[0] = 1;
    let mut proof = Vec::new(&env);
    proof.push_back(BytesN::from_array(&env, &bogus));
    client.claim(&claimant, &proof, &amount);
}

#[test]
#[should_panic(expected = "already claimed")]
fn double_claim_is_rejected() {
    let (env, client, claimant, _, _, _) = setup();
    let amount = 250i128;
    single_leaf_drop(&env, &client, &claimant, amount);
    let proof = Vec::new(&env);
    client.claim(&claimant, &proof, &amount);
    client.claim(&claimant, &proof, &amount);
}

#[test]
#[should_panic(expected = "airdrop has expired")]
fn expired_claim_is_rejected() {
    let (env, client, claimant, _, _, _) = setup();
    let amount = 250i128;
    single_leaf_drop(&env, &client, &claimant, amount);
    env.ledger().set_timestamp(10_000);
    client.claim(&claimant, &Vec::new(&env), &amount);
}

#[test]
fn admin_recovers_unclaimed_tokens_after_expiry() {
    let (env, client, claimant, recovery, token_addr, contract_id) = setup();
    let amount = 250i128;
    single_leaf_drop(&env, &client, &claimant, amount);
    client.claim(&claimant, &Vec::new(&env), &amount);

    env.ledger().set_timestamp(10_000);
    let recovered = client.recover_unclaimed();
    assert_eq!(recovered, 1_000_000 - amount);
    assert_eq!(
        token::Client::new(&env, &token_addr).balance(&recovery),
        recovered
    );
    assert_eq!(
        token::Client::new(&env, &token_addr).balance(&contract_id),
        0
    );
}

/// Native (non-wasm) cost of `claim` with a depth-20 sorted Merkle proof.
///
/// Measured on soroban-sdk 23: 2_012_264 instructions, 7 memory reads,
/// 5 writes, 1_296 write bytes. Wasm execution and disk rent are not included.
/// The bounds below catch a large regression without pinning the host meter.
#[test]
fn depth_20_claim_is_measured() {
    let (env, client, claimant, _, _, _) = setup();
    let amount = 100i128;
    let leaf = compute_leaf(&env, &claimant, amount);

    let mut proof = Vec::new(&env);
    for level in 1u8..=20 {
        let mut bytes = [0u8; 32];
        bytes[0] = level;
        bytes[31] = 0xA5;
        proof.push_back(BytesN::from_array(&env, &bytes));
    }
    let root = proof_root(&env, &leaf, &proof);
    client.configure_airdrop(&root, &amount, &10_000u64);

    client.claim(&claimant, &proof, &amount);

    let resources = env.cost_estimate().resources();
    assert!(resources.instructions > 0, "claim must be metered");
    assert!(
        resources.memory_read_entries <= 20,
        "depth-20 claim read {} entries",
        resources.memory_read_entries
    );
    assert!(
        resources.write_entries <= 8,
        "depth-20 claim wrote {} entries",
        resources.write_entries
    );
}

// ── Per-token Merkle drops (#1416) ───────────────────────────────────────────

use super::AirdropError;

/// Off-chain style Merkle tree builder: sorted-pair hashing, odd nodes are
/// promoted unchanged. Returns (root, proof for every leaf).
fn build_tree(env: &Env, leaves: &[BytesN<32>]) -> (BytesN<32>, std::vec::Vec<Vec<BytesN<32>>>) {
    let mut proofs: std::vec::Vec<Vec<BytesN<32>>> = leaves.iter().map(|_| Vec::new(env)).collect();
    // positions[i] = index of leaf i's ancestor in the current level.
    let mut positions: std::vec::Vec<usize> = (0..leaves.len()).collect();
    let mut level: std::vec::Vec<BytesN<32>> = leaves.to_vec();

    while level.len() > 1 {
        let mut next = std::vec::Vec::new();
        for pair in level.chunks(2) {
            next.push(match pair {
                [l, r] => hash_sorted_pair(env, l, r),
                [only] => only.clone(),
                _ => unreachable!(),
            });
        }
        for (leaf, pos) in positions.iter_mut().enumerate() {
            let sibling = *pos ^ 1;
            if sibling < level.len() {
                proofs[leaf].push_back(level[sibling].clone());
            }
            *pos /= 2;
        }
        level = next;
    }
    (level[0].clone(), proofs)
}

fn token_drop_setup(
    amount: i128,
    eligible: usize,
) -> (
    Env,
    AirdropContractClient<'static>,
    Address,
    std::vec::Vec<Address>,
    std::vec::Vec<Vec<BytesN<32>>>,
) {
    let (env, client, _, _, _, contract_id) = setup();

    // A second token with its own snapshot, independent of `initialize`'s.
    let drop_token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    token::StellarAssetClient::new(&env, &drop_token).mint(&contract_id, &(amount * 10));

    let claimants: std::vec::Vec<Address> =
        (0..eligible).map(|_| Address::generate(&env)).collect();
    let leaves: std::vec::Vec<BytesN<32>> = claimants
        .iter()
        .map(|c| compute_leaf(&env, c, amount))
        .collect();
    let (root, proofs) = build_tree(&env, &leaves);

    client.set_token_drop(&drop_token, &root, &amount, &(amount * eligible as i128));
    (env, client, drop_token, claimants, proofs)
}

#[test]
fn token_drop_valid_proof_claims_tokens() {
    let amount = 400i128;
    let (env, client, drop_token, claimants, proofs) = token_drop_setup(amount, 5);

    let stored = client.get_token_drop(&drop_token).unwrap();
    assert_eq!(stored.amount, amount);
    assert_eq!(stored.claimed, 0);

    for (claimant, proof) in claimants.iter().zip(proofs.iter()) {
        let result = client.claim_token(&drop_token, claimant, proof);
        assert_eq!(result.amount, amount);
        assert!(client.has_claimed_token(&drop_token, claimant));
        assert_eq!(
            token::Client::new(&env, &drop_token).balance(claimant),
            amount
        );
    }
    assert_eq!(
        client.get_token_drop(&drop_token).unwrap().claimed,
        amount * 5
    );
}

#[test]
fn token_drop_second_claim_is_already_claimed() {
    let (_env, client, drop_token, claimants, proofs) = token_drop_setup(100, 4);

    client.claim_token(&drop_token, &claimants[2], &proofs[2]);
    assert_eq!(
        client.try_claim_token(&drop_token, &claimants[2], &proofs[2]),
        Err(Ok(AirdropError::AlreadyClaimed))
    );
}

#[test]
fn token_drop_rejects_invalid_proof_and_ineligible_address() {
    let (env, client, drop_token, claimants, proofs) = token_drop_setup(100, 4);

    // Someone else's proof.
    assert_eq!(
        client.try_claim_token(&drop_token, &claimants[0], &proofs[1]),
        Err(Ok(AirdropError::InvalidProof))
    );
    // Not in the tree at all.
    let outsider = Address::generate(&env);
    assert_eq!(
        client.try_claim_token(&drop_token, &outsider, &proofs[0]),
        Err(Ok(AirdropError::InvalidProof))
    );
    assert!(!client.has_claimed_token(&drop_token, &claimants[0]));
}

#[test]
fn token_drop_unknown_token_and_budget() {
    let (env, client, drop_token, claimants, proofs) = token_drop_setup(100, 3);

    let other = Address::generate(&env);
    assert_eq!(
        client.try_claim_token(&other, &claimants[0], &proofs[0]),
        Err(Ok(AirdropError::TokenDropNotFound))
    );

    // Shrink the budget to one claim: the second eligible claimant is refused.
    let drop = client.get_token_drop(&drop_token).unwrap();
    client.set_token_drop(&drop_token, &drop.merkle_root, &100i128, &100i128);
    client.claim_token(&drop_token, &claimants[0], &proofs[0]);
    assert_eq!(
        client.try_claim_token(&drop_token, &claimants[1], &proofs[1]),
        Err(Ok(AirdropError::InsufficientBalance))
    );
}
