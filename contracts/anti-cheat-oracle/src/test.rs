#![allow(clippy::duplicated_attributes)]
#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_initialize_and_add_oracle() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);

    let contract_id = env.register(AntiCheatOracle, ());
    let client = AntiCheatOracleClient::new(&env, &contract_id);

    client.initialize(&admin, &0u32, &0u64, &0u32);
    assert!(!client.is_authorized_oracle(&oracle));

    client.add_authorized_oracle(&oracle);
    assert!(client.is_authorized_oracle(&oracle));

    client.remove_authorized_oracle(&oracle);
    assert!(!client.is_authorized_oracle(&oracle));
}

#[test]
fn test_submit_flag_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let player = Address::generate(&env);

    let contract_id = env.register(AntiCheatOracle, ());
    let client = AntiCheatOracleClient::new(&env, &contract_id);
    client.initialize(&admin, &0u32, &0u64, &0u32);

    let result = client.try_submit_flag(&unauthorized, &player, &1u64, &2u32);
    assert_eq!(result, Err(Ok(AntiCheatError::OracleNotAuthorized)));
}

#[test]
fn test_submit_flag_invalid_severity() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let player = Address::generate(&env);

    let contract_id = env.register(AntiCheatOracle, ());
    let client = AntiCheatOracleClient::new(&env, &contract_id);
    client.initialize(&admin, &0u32, &0u64, &0u32);
    client.add_authorized_oracle(&oracle);

    assert_eq!(
        client.try_submit_flag(&oracle, &player, &1u64, &0u32),
        Err(Ok(AntiCheatError::InvalidSeverity))
    );
    assert_eq!(
        client.try_submit_flag(&oracle, &player, &1u64, &4u32),
        Err(Ok(AntiCheatError::InvalidSeverity))
    );
}

#[test]
fn test_submit_flag_and_get_confirmation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let player = Address::generate(&env);
    let match_id = 42u64;

    let contract_id = env.register(AntiCheatOracle, ());
    let client = AntiCheatOracleClient::new(&env, &contract_id);
    client.initialize(&admin, &0u32, &0u64, &0u32);
    client.add_authorized_oracle(&oracle);

    assert!(client.get_confirmation(&player, &match_id).is_none());

    client.submit_flag(&oracle, &player, &match_id, &2u32); // severity 2 = medium

    let conf = client.get_confirmation(&player, &match_id).unwrap();
    assert_eq!(conf.player, player);
    assert_eq!(conf.match_id, match_id);
    assert_eq!(conf.severity, 2);
    assert_eq!(conf.penalty_applied, 15); // PENALTY_MEDIUM
    assert_eq!(conf.oracle, oracle);
}

// Integration with Reputation Index is tested by calling submit_flag with
// set_reputation_contract set: the contract uses invoke_contract to call
// apply_anticheat_penalty. See reputation-index tests for penalty capping and no underflow.

// ── ZK proof batch verification (#1413) ──────────────────────────────────────

mod mock_zk_verifier {
    use crate::OracleBatchProof;
    use soroban_sdk::{contract, contractimpl, symbol_short, Address, Bytes, Env, Vec};

    /// Stand-in for the zk-proof contract: rejects (panics on) any proof whose
    /// bytes are `b"invalid"`, and counts accepted batches so tests can check
    /// that a failed batch left no trace.
    #[contract]
    pub struct MockZkVerifier;

    #[contractimpl]
    impl MockZkVerifier {
        pub fn batch_verify(env: Env, verifier: Address, batch: Vec<OracleBatchProof>) -> u64 {
            verifier.require_auth();
            let invalid = Bytes::from_slice(&env, b"invalid");
            for item in batch.iter() {
                if item.proof_data == invalid {
                    panic!("batch verification failed");
                }
            }
            let calls: u64 = env
                .storage()
                .instance()
                .get(&symbol_short!("calls"))
                .unwrap_or(0)
                + 1;
            env.storage().instance().set(&symbol_short!("calls"), &calls);
            calls
        }

        pub fn accepted_batches(env: Env) -> u64 {
            env.storage()
                .instance()
                .get(&symbol_short!("calls"))
                .unwrap_or(0)
        }
    }
}

use mock_zk_verifier::{MockZkVerifier, MockZkVerifierClient};

fn proof(env: &Env, bytes: &[u8]) -> crate::OracleBatchProof {
    let mut inputs = soroban_sdk::Vec::new(env);
    inputs.push_back(soroban_sdk::Bytes::from_slice(env, &[7u8; 32]));
    crate::OracleBatchProof {
        proof_data: soroban_sdk::Bytes::from_slice(env, bytes),
        public_inputs: inputs,
    }
}

fn setup_batch(
    env: &Env,
) -> (
    AntiCheatOracleClient<'_>,
    MockZkVerifierClient<'_>,
    Address,
) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let oracle = Address::generate(env);

    let oracle_id = env.register(AntiCheatOracle, ());
    let client = AntiCheatOracleClient::new(env, &oracle_id);
    client.initialize(&admin, &0u32, &0u64, &0u32);
    client.add_authorized_oracle(&oracle);

    let verifier_id = env.register(MockZkVerifier, ());
    client.set_zk_verifier(&verifier_id);
    (client, MockZkVerifierClient::new(env, &verifier_id), oracle)
}

#[test]
fn test_batch_verify_accepts_valid_batch() {
    let env = Env::default();
    let (client, verifier, oracle) = setup_batch(&env);

    let mut batch = soroban_sdk::Vec::new(&env);
    batch.push_back(proof(&env, b"proof-1"));
    batch.push_back(proof(&env, b"proof-2"));

    assert_eq!(client.batch_verify(&oracle, &batch), 1);
    assert_eq!(client.get_proof_batch_count(), 1);
    assert_eq!(verifier.accepted_batches(), 1);
}

#[test]
fn test_batch_with_one_invalid_proof_reverts_entire_batch() {
    let env = Env::default();
    let (client, verifier, oracle) = setup_batch(&env);

    let mut batch = soroban_sdk::Vec::new(&env);
    batch.push_back(proof(&env, b"proof-1"));
    batch.push_back(proof(&env, b"invalid"));
    batch.push_back(proof(&env, b"proof-3"));

    assert_eq!(
        client.try_batch_verify(&oracle, &batch),
        Err(Ok(AntiCheatError::ProofBatchVerificationFailed))
    );
    // The whole batch was reverted on both sides.
    assert_eq!(client.get_proof_batch_count(), 0);
    assert_eq!(verifier.accepted_batches(), 0);
}

#[test]
fn test_batch_size_bounds() {
    let env = Env::default();
    let (client, _verifier, oracle) = setup_batch(&env);

    let empty = soroban_sdk::Vec::new(&env);
    assert_eq!(
        client.try_batch_verify(&oracle, &empty),
        Err(Ok(AntiCheatError::EmptyProofBatch))
    );

    let mut oversized = soroban_sdk::Vec::new(&env);
    for _ in 0..(MAX_PROOF_BATCH_SIZE + 1) {
        oversized.push_back(proof(&env, b"proof"));
    }
    assert_eq!(
        client.try_batch_verify(&oracle, &oversized),
        Err(Ok(AntiCheatError::ProofBatchTooLarge))
    );
}

#[test]
fn test_batch_verify_requires_authorized_oracle() {
    let env = Env::default();
    let (client, _verifier, _oracle) = setup_batch(&env);
    let stranger = Address::generate(&env);

    let mut batch = soroban_sdk::Vec::new(&env);
    batch.push_back(proof(&env, b"proof-1"));
    assert_eq!(
        client.try_batch_verify(&stranger, &batch),
        Err(Ok(AntiCheatError::OracleNotAuthorized))
    );
}
