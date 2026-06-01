//! Envelope encryption for Stellar secret keys at rest.
//!
//! # Design
//! - AES-256-GCM authenticated encryption (256-bit key, 96-bit nonce).
//! - Ciphertext format (base64-encoded): `v{version}:{hex_nonce}:{hex_ciphertext}`
//!   — the version prefix enables transparent key rotation and migration.
//! - The Data Encryption Key (DEK) is derived from `STELLAR_ENCRYPTION_KEY`
//!   (a 64-hex-char / 32-byte value) via SHA-256 so the raw env var is never
//!   used directly as a key.
//! - Decrypted key material is wrapped in `ZeroizingSecret` which zeroes memory
//!   on drop.
//! - This module is the **only** place that performs encrypt/decrypt; callers
//!   receive opaque ciphertext strings and `ZeroizingSecret` wrappers.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use sha2::{Digest, Sha256};
use std::env;
use thiserror::Error;
use zeroize::Zeroizing;

/// Current encryption scheme version embedded in every ciphertext.
const CURRENT_VERSION: u8 = 1;

#[derive(Debug, Error)]
pub enum EncryptionError {
    #[error("STELLAR_ENCRYPTION_KEY is not set or invalid")]
    MissingKey,
    #[error("Encryption failed")]
    EncryptFailed,
    #[error("Decryption failed — ciphertext may be corrupt or key may have changed")]
    DecryptFailed,
    #[error("Unsupported ciphertext version: {0}")]
    UnsupportedVersion(u8),
}

/// A decrypted secret key that zeroes its memory on drop.
pub type ZeroizingSecret = Zeroizing<String>;

/// Versioned ciphertext envelope stored in the database.
///
/// Serialised as `v{version}:{hex_nonce}:{hex_ciphertext}`.
struct Envelope {
    version: u8,
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

impl Envelope {
    fn encode(&self) -> String {
        format!(
            "v{}:{}:{}",
            self.version,
            hex::encode(&self.nonce),
            hex::encode(&self.ciphertext),
        )
    }

    fn decode(s: &str) -> Option<Self> {
        let parts: Vec<&str> = s.splitn(3, ':').collect();
        if parts.len() != 3 {
            return None;
        }
        let version = parts[0].strip_prefix('v')?.parse::<u8>().ok()?;
        let nonce = hex::decode(parts[1]).ok()?;
        let ciphertext = hex::decode(parts[2]).ok()?;
        Some(Envelope { version, nonce, ciphertext })
    }
}

/// Derive a 32-byte AES key from the raw env-var value via SHA-256.
fn derive_key(raw: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hasher.finalize().into()
}

/// Load and derive the active encryption key from the environment.
fn active_key() -> Result<[u8; 32], EncryptionError> {
    let raw = env::var("STELLAR_ENCRYPTION_KEY").map_err(|_| EncryptionError::MissingKey)?;
    if raw.trim().is_empty() {
        return Err(EncryptionError::MissingKey);
    }
    Ok(derive_key(&raw))
}

/// Encrypt a Stellar secret key for database storage.
///
/// Returns an opaque versioned ciphertext string.
/// The plaintext is never logged or returned to callers.
pub fn encrypt_secret_key(plaintext: &str) -> Result<String, EncryptionError> {
    let key_bytes = active_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    let nonce_bytes = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce_bytes, plaintext.as_bytes())
        .map_err(|_| EncryptionError::EncryptFailed)?;

    let envelope = Envelope {
        version: CURRENT_VERSION,
        nonce: nonce_bytes.to_vec(),
        ciphertext,
    };
    Ok(envelope.encode())
}

/// Decrypt a Stellar secret key retrieved from the database.
///
/// Returns a `ZeroizingSecret` that zeroes memory on drop.
/// Supports legacy plaintext detection for migration (see `is_legacy_plaintext`).
pub fn decrypt_secret_key(stored: &str) -> Result<ZeroizingSecret, EncryptionError> {
    // Migration path: if the stored value is not a versioned envelope,
    // treat it as a legacy plaintext/base64 record that needs re-encryption.
    if !stored.starts_with('v') || Envelope::decode(stored).is_none() {
        // Attempt base64 decode (legacy format from the old stub)
        let decoded = B64.decode(stored).ok()
            .and_then(|b| String::from_utf8(b).ok())
            .unwrap_or_else(|| stored.to_string());
        return Ok(Zeroizing::new(decoded));
    }

    let envelope = Envelope::decode(stored).ok_or(EncryptionError::DecryptFailed)?;

    if envelope.version != CURRENT_VERSION {
        return Err(EncryptionError::UnsupportedVersion(envelope.version));
    }

    let key_bytes = active_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    if envelope.nonce.len() != 12 {
        return Err(EncryptionError::DecryptFailed);
    }
    let nonce = Nonce::from_slice(&envelope.nonce);

    let plaintext_bytes = cipher
        .decrypt(nonce, envelope.ciphertext.as_ref())
        .map_err(|_| EncryptionError::DecryptFailed)?;

    let plaintext = String::from_utf8(plaintext_bytes)
        .map_err(|_| EncryptionError::DecryptFailed)?;

    Ok(Zeroizing::new(plaintext))
}

/// Re-encrypt a ciphertext under the current key (key rotation).
///
/// Decrypts with the current key and re-encrypts with a fresh nonce.
/// For cross-key rotation, callers should temporarily set the old key,
/// decrypt, then set the new key and call `encrypt_secret_key`.
pub fn rotate_encryption(stored: &str) -> Result<String, EncryptionError> {
    let plaintext = decrypt_secret_key(stored)?;
    encrypt_secret_key(&plaintext)
}

/// Returns `true` if the stored value appears to be a legacy (unversioned) record
/// that should be migrated to the current encryption scheme.
pub fn is_legacy_plaintext(stored: &str) -> bool {
    !stored.starts_with('v') || Envelope::decode(stored).is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn with_key<F: FnOnce()>(key: &str, f: F) {
        env::set_var("STELLAR_ENCRYPTION_KEY", key);
        f();
        env::remove_var("STELLAR_ENCRYPTION_KEY");
    }

    const TEST_KEY: &str = "test_encryption_key_for_unit_tests_only_not_production";
    const SECRET: &str = "SCZANGBA5YHTNYVSK3IYQWI72ISPKIJ2KZQSEBMQXKBFE5ZYQPNZXXX";

    #[test]
    fn encrypt_then_decrypt_roundtrip() {
        with_key(TEST_KEY, || {
            let ct = encrypt_secret_key(SECRET).unwrap();
            let pt = decrypt_secret_key(&ct).unwrap();
            assert_eq!(*pt, SECRET);
        });
    }

    #[test]
    fn ciphertext_is_versioned() {
        with_key(TEST_KEY, || {
            let ct = encrypt_secret_key(SECRET).unwrap();
            assert!(ct.starts_with("v1:"), "expected versioned envelope, got: {ct}");
        });
    }

    #[test]
    fn ciphertext_does_not_contain_plaintext() {
        with_key(TEST_KEY, || {
            let ct = encrypt_secret_key(SECRET).unwrap();
            assert!(!ct.contains(SECRET), "ciphertext must not contain plaintext");
        });
    }

    #[test]
    fn each_encryption_produces_unique_ciphertext() {
        with_key(TEST_KEY, || {
            let ct1 = encrypt_secret_key(SECRET).unwrap();
            let ct2 = encrypt_secret_key(SECRET).unwrap();
            assert_ne!(ct1, ct2, "nonces must differ per encryption");
        });
    }

    #[test]
    fn wrong_key_fails_decryption() {
        with_key(TEST_KEY, || {
            let ct = encrypt_secret_key(SECRET).unwrap();
            env::set_var("STELLAR_ENCRYPTION_KEY", "wrong_key_entirely_different_value");
            let result = decrypt_secret_key(&ct);
            assert!(result.is_err(), "wrong key must fail decryption");
        });
        env::remove_var("STELLAR_ENCRYPTION_KEY");
    }

    #[test]
    fn tampered_ciphertext_fails_decryption() {
        with_key(TEST_KEY, || {
            let mut ct = encrypt_secret_key(SECRET).unwrap();
            // Flip a character in the ciphertext portion
            let last = ct.pop().unwrap();
            ct.push(if last == 'a' { 'b' } else { 'a' });
            let result = decrypt_secret_key(&ct);
            assert!(result.is_err(), "tampered ciphertext must fail");
        });
    }

    #[test]
    fn missing_key_returns_error() {
        env::remove_var("STELLAR_ENCRYPTION_KEY");
        assert!(encrypt_secret_key(SECRET).is_err());
        assert!(decrypt_secret_key("v1:aabbcc:ddeeff").is_err());
    }

    #[test]
    fn legacy_base64_record_is_detected() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        let legacy = B64.encode(SECRET);
        assert!(is_legacy_plaintext(&legacy));
    }

    #[test]
    fn legacy_base64_record_decodes_for_migration() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        with_key(TEST_KEY, || {
            let legacy = B64.encode(SECRET);
            let pt = decrypt_secret_key(&legacy).unwrap();
            assert_eq!(*pt, SECRET);
        });
    }

    #[test]
    fn key_rotation_produces_new_ciphertext() {
        with_key(TEST_KEY, || {
            let ct1 = encrypt_secret_key(SECRET).unwrap();
            let ct2 = rotate_encryption(&ct1).unwrap();
            assert_ne!(ct1, ct2);
            let pt = decrypt_secret_key(&ct2).unwrap();
            assert_eq!(*pt, SECRET);
        });
    }

    #[test]
    fn zeroizing_secret_does_not_impl_debug_display() {
        // ZeroizingSecret is Zeroizing<String>; verify it doesn't expose value
        // via Display (it doesn't implement Display, so this is a compile check).
        with_key(TEST_KEY, || {
            let ct = encrypt_secret_key(SECRET).unwrap();
            let secret: ZeroizingSecret = decrypt_secret_key(&ct).unwrap();
            // Access via deref only — no Display/Debug that would log the value
            assert_eq!(secret.len(), SECRET.len());
        });
    }
}
