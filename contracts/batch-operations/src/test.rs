#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(BatchOperations, ());
    let client = BatchOperationsClient::new(&env, &contract_id);
    env.mock_all_auths();
    client.initialize(&admin);
    (env, contract_id, admin)
}

fn client<'a>(env: &'a Env, contract_id: &'a Address) -> BatchOperationsClient<'a> {
    BatchOperationsClient::new(env, contract_id)
}

fn vec_addresses(env: &Env, n: usize) -> soroban_sdk::Vec<Address> {
    let mut v = soroban_sdk::Vec::new(env);
    for _ in 0..n {
        v.push_back(Address::generate(env));
    }
    v
}

fn vec_i128(env: &Env, vals: &[i128]) -> soroban_sdk::Vec<i128> {
    let mut v = soroban_sdk::Vec::new(env);
    for &x in vals {
        v.push_back(x);
    }
    v
}

fn vec_u32(env: &Env, vals: &[u32]) -> soroban_sdk::Vec<u32> {
    let mut v = soroban_sdk::Vec::new(env);
    for &x in vals {
        v.push_back(x);
    }
    v
}

/// Mint tokens to a fresh address and return it.
fn funded_sender(env: &Env, contract_id: &Address, amount: i128) -> Address {
    let c = client(env, contract_id);
    let sender = Address::generate(env);
    let mut r = soroban_sdk::Vec::new(env);
    r.push_back(sender.clone());
    let mut a = soroban_sdk::Vec::new(env);
    a.push_back(amount);
    c.batch_mint(&r, &a);
    sender
}

// ─── Initialize ───────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    assert_eq!(c.total_supply(), 0);
    assert_eq!(c.nft_count(), 0);
}

#[test]
fn test_double_initialize_fails() {
    let (env, contract_id, admin) = setup();
    let c = client(&env, &contract_id);
    assert_eq!(
        c.try_initialize(&admin),
        Err(Ok(BatchError::AlreadyInitialized))
    );
}

#[test]
fn test_calls_without_initialize_fail() {
    let env = Env::default();
    let contract_id = env.register(BatchOperations, ());
    let c = client(&env, &contract_id);
    env.mock_all_auths();
    let r = vec_addresses(&env, 1);
    let a = vec_i128(&env, &[100]);
    assert_eq!(
        c.try_batch_mint(&r, &a),
        Err(Ok(BatchError::NotInitialized))
    );
}

// ─── batch_mint ───────────────────────────────────────────────────────────────

#[test]
fn test_batch_mint_basic() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let recipients = {
        let mut v = soroban_sdk::Vec::new(&env);
        v.push_back(r1.clone());
        v.push_back(r2.clone());
        v
    };
    let amounts = vec_i128(&env, &[500, 300]);
    c.batch_mint(&recipients, &amounts);
    assert_eq!(c.balance(&r1), 500);
    assert_eq!(c.balance(&r2), 300);
    assert_eq!(c.total_supply(), 800);
}

#[test]
fn test_batch_mint_empty_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let empty_addr: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&env);
    let empty_amt: soroban_sdk::Vec<i128> = soroban_sdk::Vec::new(&env);
    assert_eq!(
        c.try_batch_mint(&empty_addr, &empty_amt),
        Err(Ok(BatchError::EmptyBatch))
    );
}

#[test]
fn test_batch_mint_length_mismatch_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let r = vec_addresses(&env, 2);
    let a = vec_i128(&env, &[100]);
    assert_eq!(
        c.try_batch_mint(&r, &a),
        Err(Ok(BatchError::LengthMismatch))
    );
}

#[test]
fn test_batch_mint_zero_amount_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let r = vec_addresses(&env, 2);
    let a = vec_i128(&env, &[100, 0]);
    assert_eq!(
        c.try_batch_mint(&r, &a),
        Err(Ok(BatchError::InvalidAmount))
    );
}

#[test]
fn test_batch_mint_negative_amount_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let r = vec_addresses(&env, 1);
    let a = vec_i128(&env, &[-50]);
    assert_eq!(
        c.try_batch_mint(&r, &a),
        Err(Ok(BatchError::InvalidAmount))
    );
}

#[test]
fn test_batch_mint_exceeds_max_size_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let n = (MAX_BATCH_SIZE + 1) as usize;
    let r = vec_addresses(&env, n);
    let amounts = {
        let mut v = soroban_sdk::Vec::new(&env);
        for _ in 0..n {
            v.push_back(1i128);
        }
        v
    };
    assert_eq!(
        c.try_batch_mint(&r, &amounts),
        Err(Ok(BatchError::BatchTooLarge))
    );
}

// ─── batch_transfer ───────────────────────────────────────────────────────────

#[test]
fn test_batch_transfer_basic() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let sender = funded_sender(&env, &contract_id, 1000);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let recipients = {
        let mut v = soroban_sdk::Vec::new(&env);
        v.push_back(r1.clone());
        v.push_back(r2.clone());
        v
    };
    let amounts = vec_i128(&env, &[300, 200]);
    c.batch_transfer(&sender, &recipients, &amounts);
    assert_eq!(c.balance(&sender), 500);
    assert_eq!(c.balance(&r1), 300);
    assert_eq!(c.balance(&r2), 200);
}

#[test]
fn test_batch_transfer_insufficient_balance_atomic_rollback() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let sender = funded_sender(&env, &contract_id, 100);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let recipients = {
        let mut v = soroban_sdk::Vec::new(&env);
        v.push_back(r1.clone());
        v.push_back(r2.clone());
        v
    };
    // Total 150 > 100 — entire batch must fail atomically.
    let amounts = vec_i128(&env, &[80, 70]);
    assert_eq!(
        c.try_batch_transfer(&sender, &recipients, &amounts),
        Err(Ok(BatchError::InsufficientBalance))
    );
    // State must be unchanged.
    assert_eq!(c.balance(&sender), 100);
    assert_eq!(c.balance(&r1), 0);
    assert_eq!(c.balance(&r2), 0);
}

#[test]
fn test_batch_transfer_length_mismatch_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let sender = funded_sender(&env, &contract_id, 500);
    let r = vec_addresses(&env, 2);
    let a = vec_i128(&env, &[100]);
    assert_eq!(
        c.try_batch_transfer(&sender, &r, &a),
        Err(Ok(BatchError::LengthMismatch))
    );
}

#[test]
fn test_batch_transfer_zero_amount_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let sender = funded_sender(&env, &contract_id, 500);
    let r = vec_addresses(&env, 1);
    let a = vec_i128(&env, &[0]);
    assert_eq!(
        c.try_batch_transfer(&sender, &r, &a),
        Err(Ok(BatchError::InvalidAmount))
    );
}

#[test]
fn test_batch_transfer_exceeds_max_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let sender = funded_sender(&env, &contract_id, 100_000);
    let n = (MAX_BATCH_SIZE + 1) as usize;
    let r = vec_addresses(&env, n);
    let amounts = {
        let mut v = soroban_sdk::Vec::new(&env);
        for _ in 0..n {
            v.push_back(1i128);
        }
        v
    };
    assert_eq!(
        c.try_batch_transfer(&sender, &r, &amounts),
        Err(Ok(BatchError::BatchTooLarge))
    );
}

// ─── batch_register_tournaments ──────────────────────────────────────────────

#[test]
fn test_batch_register_tournaments_basic() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let player = Address::generate(&env);
    let ids = vec_u32(&env, &[1, 2, 3]);
    let results = c.batch_register_tournaments(&player, &ids);
    assert_eq!(results.len(), 3);
    for i in 0..3u32 {
        let r = results.get(i).unwrap();
        assert!(r.success);
        assert_eq!(r.error_code, 0);
    }
    assert!(c.is_registered(&player, &1));
    assert!(c.is_registered(&player, &2));
    assert!(c.is_registered(&player, &3));
}

#[test]
fn test_batch_register_duplicate_partial_result() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let player = Address::generate(&env);
    // First registration.
    c.batch_register_tournaments(&player, &vec_u32(&env, &[5]));
    // Re-registering 5 alongside new id 6.
    let ids = vec_u32(&env, &[5, 6]);
    let results = c.batch_register_tournaments(&player, &ids);
    assert_eq!(results.len(), 2);
    let r0 = results.get(0).unwrap();
    let r1 = results.get(1).unwrap();
    assert!(!r0.success);
    assert_eq!(r0.error_code, BatchError::AlreadyRegistered as u32);
    assert!(r1.success);
    assert!(c.is_registered(&player, &6));
}

#[test]
fn test_batch_register_empty_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let player = Address::generate(&env);
    let empty: soroban_sdk::Vec<u32> = soroban_sdk::Vec::new(&env);
    assert_eq!(
        c.try_batch_register_tournaments(&player, &empty),
        Err(Ok(BatchError::EmptyBatch))
    );
}

#[test]
fn test_batch_register_exceeds_max_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let player = Address::generate(&env);
    let ids = {
        let mut v = soroban_sdk::Vec::new(&env);
        for i in 0..(MAX_BATCH_SIZE + 1) {
            v.push_back(i);
        }
        v
    };
    assert_eq!(
        c.try_batch_register_tournaments(&player, &ids),
        Err(Ok(BatchError::BatchTooLarge))
    );
}

// ─── batch_update_reputation ─────────────────────────────────────────────────

#[test]
fn test_batch_update_reputation_basic() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let players = {
        let mut v = soroban_sdk::Vec::new(&env);
        v.push_back(p1.clone());
        v.push_back(p2.clone());
        v
    };
    let deltas = vec_i128(&env, &[100, -30]);
    c.batch_update_reputation(&players, &deltas);
    assert_eq!(c.reputation(&p1), 100);
    assert_eq!(c.reputation(&p2), 0); // clamped at 0
}

#[test]
fn test_batch_update_reputation_atomic_zero_delta_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let players = {
        let mut v = soroban_sdk::Vec::new(&env);
        v.push_back(p1.clone());
        v.push_back(p2.clone());
        v
    };
    // Zero delta on p2 — entire batch must fail.
    let deltas = vec_i128(&env, &[50, 0]);
    assert_eq!(
        c.try_batch_update_reputation(&players, &deltas),
        Err(Ok(BatchError::InvalidDelta))
    );
    // p1 must not have been updated (atomic rollback).
    assert_eq!(c.reputation(&p1), 0);
}

#[test]
fn test_batch_update_reputation_length_mismatch_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let players = vec_addresses(&env, 2);
    let deltas = vec_i128(&env, &[10]);
    assert_eq!(
        c.try_batch_update_reputation(&players, &deltas),
        Err(Ok(BatchError::LengthMismatch))
    );
}

#[test]
fn test_batch_update_reputation_negative_clamps_to_zero() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let p = Address::generate(&env);
    let players = {
        let mut v = soroban_sdk::Vec::new(&env);
        v.push_back(p.clone());
        v
    };
    c.batch_update_reputation(&players, &vec_i128(&env, &[-999]));
    assert_eq!(c.reputation(&p), 0);
}

// ─── batch_unlock_achievements ───────────────────────────────────────────────

#[test]
fn test_batch_unlock_achievements_basic() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let player = Address::generate(&env);
    let ids = vec_u32(&env, &[0, 5, 63]);
    let results = c.batch_unlock_achievements(&player, &ids);
    assert_eq!(results.len(), 3);
    for i in 0..3u32 {
        assert!(results.get(i).unwrap().success);
    }
    let mask = c.achievement_mask(&player);
    assert_ne!(mask & (1u64 << 0), 0);
    assert_ne!(mask & (1u64 << 5), 0);
    assert_ne!(mask & (1u64 << 63), 0);
}

#[test]
fn test_batch_unlock_achievements_duplicate_partial() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let player = Address::generate(&env);
    c.batch_unlock_achievements(&player, &vec_u32(&env, &[3]));
    let ids = vec_u32(&env, &[3, 7]);
    let results = c.batch_unlock_achievements(&player, &ids);
    let r0 = results.get(0).unwrap();
    let r1 = results.get(1).unwrap();
    assert!(!r0.success);
    assert_eq!(r0.error_code, BatchError::AchievementAlreadyUnlocked as u32);
    assert!(r1.success);
}

#[test]
fn test_batch_unlock_achievements_out_of_range_partial() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let player = Address::generate(&env);
    // ID 64 is out of range (max is 63).
    let ids = vec_u32(&env, &[1, 64]);
    let results = c.batch_unlock_achievements(&player, &ids);
    assert!(results.get(0).unwrap().success);
    let r1 = results.get(1).unwrap();
    assert!(!r1.success);
    assert_eq!(r1.error_code, BatchError::InvalidAchievementId as u32);
}

#[test]
fn test_batch_unlock_achievements_bitmask_collapsed() {
    // 10 achievements → still a single u64 mask value stored.
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let player = Address::generate(&env);
    let ids = vec_u32(&env, &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    c.batch_unlock_achievements(&player, &ids);
    let mask = c.achievement_mask(&player);
    assert_eq!(mask, 0b11_1111_1111u64); // bits 0-9 set
}

#[test]
fn test_batch_unlock_achievements_empty_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let player = Address::generate(&env);
    let empty: soroban_sdk::Vec<u32> = soroban_sdk::Vec::new(&env);
    assert_eq!(
        c.try_batch_unlock_achievements(&player, &empty),
        Err(Ok(BatchError::EmptyBatch))
    );
}

// ─── batch_mint_nft ───────────────────────────────────────────────────────────

#[test]
fn test_batch_mint_nft_basic() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let o1 = Address::generate(&env);
    let o2 = Address::generate(&env);
    let owners = {
        let mut v = soroban_sdk::Vec::new(&env);
        v.push_back(o1.clone());
        v.push_back(o2.clone());
        v
    };
    let ids = c.batch_mint_nft(&owners);
    assert_eq!(ids.len(), 2);
    assert_eq!(ids.get(0).unwrap(), 0);
    assert_eq!(ids.get(1).unwrap(), 1);
    assert_eq!(c.nft_count(), 2);
    assert_eq!(c.nft_owner(&0).unwrap(), o1);
    assert_eq!(c.nft_owner(&1).unwrap(), o2);
}

#[test]
fn test_batch_mint_nft_sequential_ids() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let owners1 = vec_addresses(&env, 3);
    let owners2 = vec_addresses(&env, 2);
    let ids1 = c.batch_mint_nft(&owners1);
    let ids2 = c.batch_mint_nft(&owners2);
    assert_eq!(ids1.get(0).unwrap(), 0);
    assert_eq!(ids1.get(2).unwrap(), 2);
    assert_eq!(ids2.get(0).unwrap(), 3);
    assert_eq!(ids2.get(1).unwrap(), 4);
    assert_eq!(c.nft_count(), 5);
}

#[test]
fn test_batch_mint_nft_empty_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let empty: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&env);
    assert_eq!(
        c.try_batch_mint_nft(&empty),
        Err(Ok(BatchError::EmptyBatch))
    );
}

#[test]
fn test_batch_mint_nft_exceeds_max_fails() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let owners = vec_addresses(&env, (MAX_BATCH_SIZE + 1) as usize);
    assert_eq!(
        c.try_batch_mint_nft(&owners),
        Err(Ok(BatchError::BatchTooLarge))
    );
}

// ─── MAX_BATCH_SIZE boundary ──────────────────────────────────────────────────

#[test]
fn test_exact_max_batch_size_succeeds() {
    let (env, contract_id, _) = setup();
    let c = client(&env, &contract_id);
    let n = MAX_BATCH_SIZE as usize;
    let recipients = vec_addresses(&env, n);
    let amounts = {
        let mut v = soroban_sdk::Vec::new(&env);
        for _ in 0..n {
            v.push_back(1i128);
        }
        v
    };
    c.batch_mint(&recipients, &amounts);
    assert_eq!(c.total_supply(), MAX_BATCH_SIZE as i128);
}
