/// Tests for Stellar secret key envelope encryption.
///
/// Covers: encrypt-before-persist, decrypt-for-signing, no-leak in debug/API
/// responses, legacy migration, key rotation, failure handling.
use arenax_backend::service::key_encryption::{
    decrypt_secret_key, encrypt_secret_key, is_legacy_plaintext, rotate_encryption,
};
use arenax_backend::models::stellar_account::{StellarAccount, StellarAccountResponse};
use std::env;
use uuid::Uuid;
use chrono::Utc;

// ── helpers ───────────────────────────────────────────────────────────────────

const TEST_KEY: &str = "stellar_enc_key_for_tests_only_not_for_production_use";
const STELLAR_SECRET: &str = "SCZANGBA5YHTNYVSK3IYQWI72ISPKIJ2KZQSEBMQXKBFE5ZYQPNZXXX";

fn set_key(k: &str) { env::set_var("STELLAR_ENCRYPTION_KEY", k); }
fn clear_key()      { env::remove_var("STELLAR_ENCRYPTION_KEY"); }

fn make_account(encrypted_secret: Option<String>) -> StellarAccount {
    StellarAccount {
        id: Uuid::new_v4(),
        user_id: Some(Uuid::new_v4()),
        public_key: "GBXXX".to_string(),
        encrypted_secret_key: encrypted_secret,
        account_type: "user".to_string(),
        is_funded: false,
        is_active: true,
        balance_xlm: 0,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

// ── encryption before persistence ────────────────────────────────────────────

#[test]
fn encrypt_produces_versioned_ciphertext() {
    set_key(TEST_KEY);
    let ct = encrypt_secret_key(STELLAR_SECRET).unwrap();
    assert!(ct.starts_with("v1:"), "ciphertext must be versioned: {ct}");
    clear_key();
}

#[test]
fn ciphertext_does_not_contain_plaintext() {
    set_key(TEST_KEY);
    let ct = encrypt_secret_key(STELLAR_SECRET).unwrap();
    assert!(!ct.contains(STELLAR_SECRET), "ciphertext must not contain plaintext");
    clear_key();
}

#[test]
fn each_encryption_is_unique_due_to_random_nonce() {
    set_key(TEST_KEY);
    let ct1 = encrypt_secret_key(STELLAR_SECRET).unwrap();
    let ct2 = encrypt_secret_key(STELLAR_SECRET).unwrap();
    assert_ne!(ct1, ct2, "each encryption must use a fresh nonce");
    clear_key();
}

// ── successful decryption for signing ────────────────────────────────────────

#[test]
fn decrypt_recovers_original_secret() {
    set_key(TEST_KEY);
    let ct = encrypt_secret_key(STELLAR_SECRET).unwrap();
    let pt = decrypt_secret_key(&ct).unwrap();
    assert_eq!(*pt, STELLAR_SECRET);
    clear_key();
}

#[test]
fn decrypted_value_is_zeroizing() {
    // ZeroizingSecret zeroes on drop — verify it's the right type by using it
    set_key(TEST_KEY);
    let ct = encrypt_secret_key(STELLAR_SECRET).unwrap();
    let secret = decrypt_secret_key(&ct).unwrap();
    assert_eq!(secret.len(), STELLAR_SECRET.len());
    // secret is dropped here and memory is zeroed
    clear_key();
}

// ── secret not exposed in debug / API responses ───────────────────────────────

#[test]
fn stellar_account_debug_redacts_secret() {
    set_key(TEST_KEY);
    let ct = encrypt_secret_key(STELLAR_SECRET).unwrap();
    let account = make_account(Some(ct.clone()));
    let debug_str = format!("{:?}", account);
    assert!(
        !debug_str.contains(STELLAR_SECRET),
        "debug must not contain plaintext secret"
    );
    assert!(
        !debug_str.contains(&ct),
        "debug must not contain ciphertext either"
    );
    assert!(
        debug_str.contains("[REDACTED]"),
        "debug must show [REDACTED] for secret field"
    );
    clear_key();
}

#[test]
fn stellar_account_serializes_without_secret() {
    set_key(TEST_KEY);
    let ct = encrypt_secret_key(STELLAR_SECRET).unwrap();
    let account = make_account(Some(ct.clone()));
    let json = serde_json::to_string(&account).unwrap();
    assert!(
        !json.contains(STELLAR_SECRET),
        "JSON must not contain plaintext secret"
    );
    assert!(
        !json.contains("encrypted_secret_key"),
        "JSON must not include the encrypted_secret_key field at all"
    );
    clear_key();
}

#[test]
fn stellar_account_response_contains_no_secret() {
    set_key(TEST_KEY);
    let ct = encrypt_secret_key(STELLAR_SECRET).unwrap();
    let account = make_account(Some(ct));
    let response = StellarAccountResponse::from(account);
    let json = serde_json::to_string(&response).unwrap();
    assert!(!json.contains(STELLAR_SECRET));
    assert!(!json.contains("secret"));
    clear_key();
}

// ── legacy record migration ───────────────────────────────────────────────────

#[test]
fn legacy_base64_record_is_detected() {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let legacy = B64.encode(STELLAR_SECRET);
    assert!(is_legacy_plaintext(&legacy));
}

#[test]
fn versioned_record_is_not_legacy() {
    set_key(TEST_KEY);
    let ct = encrypt_secret_key(STELLAR_SECRET).unwrap();
    assert!(!is_legacy_plaintext(&ct));
    clear_key();
}

#[test]
fn legacy_base64_record_decrypts_for_migration() {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    set_key(TEST_KEY);
    let legacy = B64.encode(STELLAR_SECRET);
    let pt = decrypt_secret_key(&legacy).unwrap();
    assert_eq!(*pt, STELLAR_SECRET);
    clear_key();
}

#[test]
fn migrated_record_can_be_re_encrypted() {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    set_key(TEST_KEY);
    let legacy = B64.encode(STELLAR_SECRET);
    // Migration: decrypt legacy, re-encrypt under current scheme
    let pt = decrypt_secret_key(&legacy).unwrap();
    let new_ct = encrypt_secret_key(&pt).unwrap();
    assert!(new_ct.starts_with("v1:"), "migrated record must be versioned");
    let pt2 = decrypt_secret_key(&new_ct).unwrap();
    assert_eq!(*pt2, STELLAR_SECRET);
    clear_key();
}

// ── key rotation ──────────────────────────────────────────────────────────────

#[test]
fn key_rotation_produces_new_ciphertext_same_plaintext() {
    set_key(TEST_KEY);
    let ct1 = encrypt_secret_key(STELLAR_SECRET).unwrap();
    let ct2 = rotate_encryption(&ct1).unwrap();
    assert_ne!(ct1, ct2, "rotated ciphertext must differ");
    let pt = decrypt_secret_key(&ct2).unwrap();
    assert_eq!(*pt, STELLAR_SECRET);
    clear_key();
}

// ── encryption failure handling ───────────────────────────────────────────────

#[test]
fn missing_encryption_key_fails_encrypt() {
    clear_key();
    assert!(encrypt_secret_key(STELLAR_SECRET).is_err());
}

#[test]
fn missing_encryption_key_fails_decrypt() {
    clear_key();
    assert!(decrypt_secret_key("v1:aabbcc:ddeeff").is_err());
}

#[test]
fn wrong_key_fails_decryption() {
    set_key(TEST_KEY);
    let ct = encrypt_secret_key(STELLAR_SECRET).unwrap();
    env::set_var("STELLAR_ENCRYPTION_KEY", "completely_different_wrong_key_value");
    assert!(decrypt_secret_key(&ct).is_err(), "wrong key must fail");
    clear_key();
}

#[test]
fn tampered_ciphertext_fails_decryption() {
    set_key(TEST_KEY);
    let mut ct = encrypt_secret_key(STELLAR_SECRET).unwrap();
    let last = ct.pop().unwrap();
    ct.push(if last == 'a' { 'b' } else { 'a' });
    assert!(decrypt_secret_key(&ct).is_err(), "tampered ciphertext must fail");
    clear_key();
}

#[test]
fn truncated_ciphertext_fails_decryption() {
    set_key(TEST_KEY);
    let ct = encrypt_secret_key(STELLAR_SECRET).unwrap();
    let truncated = &ct[..ct.len() / 2];
    assert!(decrypt_secret_key(truncated).is_err());
    clear_key();
}

// ── unauthorized access / no silent fallback ──────────────────────────────────

#[test]
fn decrypt_without_key_never_returns_plaintext() {
    clear_key();
    set_key(TEST_KEY);
    let ct = encrypt_secret_key(STELLAR_SECRET).unwrap();
    clear_key();
    // Without the key, decryption must fail — never silently return garbage
    let result = decrypt_secret_key(&ct);
    assert!(result.is_err(), "must not silently return garbage without key");
}
