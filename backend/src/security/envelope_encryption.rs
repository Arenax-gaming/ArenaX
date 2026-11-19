//! Envelope encryption for Stellar secret keys at rest — Issue #1361.
//!
//! # Design
//! Each secret is protected by two-layer envelope encryption:
//!
//! ```text
//! plaintext
//!   └─ encrypted with DEK (AES-256-GCM, random per record) → secret_ciphertext
//!        DEK bytes
//!          └─ encrypted with KEK (AES-256-GCM, loaded from env) → dek_ciphertext
//! ```
//!
//! Stored on disk / in the database: `EnvelopedSecret { dek_ciphertext, secret_ciphertext }`.
//!
//! # Key rotation (KEK)
//! To rotate the KEK, call `rotate_kek(old_enc, new_enc, records)`. It decrypts
//! every DEK with the old KEK and re-encrypts it with the new KEK. The
//! `secret_ciphertext` is **never touched** — only the DEK wrapper changes,
//! so the operation is O(n) in the number of rows with no ciphertext re-encryption.
//!
//! # Environment variable
//! Set `STELLAR_KEK` to a 64-character lowercase hex string (32 bytes).
//! On first boot without the variable, a random key is generated and a warning
//! is emitted — this is acceptable in development but must never happen in
//! production.

use aes_gcm::{
    aead::{generic_array::GenericArray, Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::warn;
use zeroize::Zeroize;

// ── Errors ────────────────────────────────────────────────────────────────────

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum EnvelopeError {
    #[error("Failed to encrypt: {0}")]
    EncryptFailed(String),
    #[error("Failed to decrypt: authentication tag mismatch or corrupt ciphertext")]
    DecryptFailed,
    #[error("Invalid envelope format: {0}")]
    InvalidFormat(String),
    #[error("Invalid key: {0}")]
    InvalidKey(String),
    #[error("JSON error: {0}")]
    Json(String),
}

// ── Wire format ───────────────────────────────────────────────────────────────

/// The on-disk / database representation of an envelope-encrypted secret.
///
/// Both fields use the format `<prefix>:<nonce_hex>$<ciphertext_hex>`:
/// - `dek_ciphertext` prefix is `"kek"` — the DEK encrypted under the KEK.
/// - `secret_ciphertext` prefix is `"enc"` — the plaintext encrypted under the DEK.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EnvelopedSecret {
    /// DEK bytes encrypted under the KEK.
    pub dek_ciphertext: String,
    /// Plaintext bytes encrypted under the DEK.
    pub secret_ciphertext: String,
}

// ── Rotation result ──────────────────────────────────────────────────────────

/// Outcome of one row during a KEK rotation.
#[derive(Debug, Clone)]
pub struct RotationResult {
    /// Arbitrary row identifier (e.g. stellar_account primary key as string).
    pub row_id: String,
    /// The re-wrapped envelope on success, or the error message on failure.
    pub result: Result<EnvelopedSecret, String>,
}

// ── Encryption key (zeroized on drop) ────────────────────────────────────────

struct Aes256Key([u8; 32]);

impl Drop for Aes256Key {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

// ── Core engine ──────────────────────────────────────────────────────────────

/// Envelope encryption engine keyed by a KEK loaded from the environment.
pub struct EnvelopeEncryption {
    kek: Aes256Key,
}

impl EnvelopeEncryption {
    // ── Construction ─────────────────────────────────────────────────────────

    /// Load the KEK from `STELLAR_KEK` (64-char hex → 32 bytes).
    /// Falls back to a random key in development (emits a WARN).
    pub fn from_env() -> Self {
        match std::env::var("STELLAR_KEK") {
            Ok(hex) => match Self::from_hex(&hex) {
                Ok(enc) => enc,
                Err(e) => {
                    warn!(
                        error = %e,
                        "STELLAR_KEK is set but invalid; falling back to a random KEK. \
                         This MUST NOT happen in production."
                    );
                    Self::generate()
                }
            },
            Err(_) => {
                warn!(
                    "STELLAR_KEK is not set; using a random KEK. \
                     Key rotation and cross-restart decryption will fail. \
                     Set STELLAR_KEK=<64 hex chars> in production."
                );
                Self::generate()
            }
        }
    }

    /// Build from a 64-character lowercase hex string.
    pub fn from_hex(hex: &str) -> Result<Self, EnvelopeError> {
        let bytes = hex::decode(hex.trim())
            .map_err(|e| EnvelopeError::InvalidKey(format!("bad hex: {e}")))?;
        if bytes.len() != 32 {
            return Err(EnvelopeError::InvalidKey(format!(
                "expected 32 bytes, got {}",
                bytes.len()
            )));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        Ok(Self { kek: Aes256Key(key) })
    }

    /// Generate a random 256-bit KEK (dev / test use only).
    pub fn generate() -> Self {
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        Self { kek: Aes256Key(key) }
    }

    // ── Primitive helpers ─────────────────────────────────────────────────────

    /// Encrypt `plaintext` under `key_bytes` (AES-256-GCM).
    /// Returns `"<prefix>:<nonce_hex>$<ct_hex>"`.
    fn aead_seal(key_bytes: &[u8; 32], prefix: &str, plaintext: &[u8]) -> Result<String, EnvelopeError> {
        let cipher = Aes256Gcm::new(GenericArray::from_slice(key_bytes));
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| EnvelopeError::EncryptFailed(e.to_string()))?;
        Ok(format!("{}:{}${}", prefix, hex::encode(nonce_bytes), hex::encode(ct)))
    }

    /// Decrypt an envelope produced by `aead_seal`.
    fn aead_open(key_bytes: &[u8; 32], envelope: &str) -> Result<Vec<u8>, EnvelopeError> {
        // Format: "<prefix>:<nonce_hex>$<ct_hex>"
        let after_prefix = envelope
            .splitn(2, ':')
            .nth(1)
            .ok_or_else(|| EnvelopeError::InvalidFormat("missing prefix separator".into()))?;
        let (nonce_hex, ct_hex) = after_prefix
            .split_once('$')
            .ok_or_else(|| EnvelopeError::InvalidFormat("missing nonce/ct separator".into()))?;

        let nonce_bytes = hex::decode(nonce_hex)
            .map_err(|e| EnvelopeError::InvalidFormat(format!("nonce hex: {e}")))?;
        if nonce_bytes.len() != 12 {
            return Err(EnvelopeError::InvalidFormat(format!(
                "nonce length {} != 12",
                nonce_bytes.len()
            )));
        }
        let ct_bytes = hex::decode(ct_hex)
            .map_err(|e| EnvelopeError::InvalidFormat(format!("ct hex: {e}")))?;

        let cipher = Aes256Gcm::new(GenericArray::from_slice(key_bytes));
        let nonce = Nonce::from_slice(&nonce_bytes);
        cipher
            .decrypt(nonce, ct_bytes.as_ref())
            .map_err(|_| EnvelopeError::DecryptFailed)
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// Seal `plaintext` into an `EnvelopedSecret`.
    ///
    /// 1. Generate a random 256-bit DEK.
    /// 2. Encrypt `plaintext` with the DEK → `secret_ciphertext`.
    /// 3. Encrypt the raw DEK bytes with the KEK → `dek_ciphertext`.
    pub fn seal(&self, plaintext: &[u8]) -> Result<EnvelopedSecret, EnvelopeError> {
        // Generate random DEK
        let mut dek_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut dek_bytes);

        // Encrypt plaintext with DEK
        let secret_ciphertext = Self::aead_seal(&dek_bytes, "enc", plaintext)?;

        // Encrypt DEK bytes with KEK
        let dek_ciphertext = Self::aead_seal(&self.kek.0, "kek", &dek_bytes)?;

        // Zero DEK immediately
        dek_bytes.zeroize();

        Ok(EnvelopedSecret { dek_ciphertext, secret_ciphertext })
    }

    /// Convenience wrapper: seal a UTF-8 string.
    pub fn seal_str(&self, plaintext: &str) -> Result<EnvelopedSecret, EnvelopeError> {
        self.seal(plaintext.as_bytes())
    }

    /// Open an `EnvelopedSecret` and return the original plaintext bytes.
    ///
    /// 1. Decrypt `dek_ciphertext` with the KEK to recover the raw DEK.
    /// 2. Decrypt `secret_ciphertext` with the DEK to recover the plaintext.
    pub fn open(&self, enveloped: &EnvelopedSecret) -> Result<Vec<u8>, EnvelopeError> {
        // Recover DEK
        let mut dek_bytes_vec = Self::aead_open(&self.kek.0, &enveloped.dek_ciphertext)?;
        if dek_bytes_vec.len() != 32 {
            dek_bytes_vec.zeroize();
            return Err(EnvelopeError::InvalidFormat(format!(
                "DEK must be 32 bytes, got {}",
                dek_bytes_vec.len()
            )));
        }
        let mut dek = [0u8; 32];
        dek.copy_from_slice(&dek_bytes_vec);
        dek_bytes_vec.zeroize();

        // Decrypt plaintext with DEK
        let plaintext = Self::aead_open(&dek, &enveloped.secret_ciphertext)?;
        dek.zeroize();
        Ok(plaintext)
    }

    /// Convenience wrapper: open and return a UTF-8 string.
    pub fn open_str(&self, enveloped: &EnvelopedSecret) -> Result<String, EnvelopeError> {
        let bytes = self.open(enveloped)?;
        String::from_utf8(bytes)
            .map_err(|e| EnvelopeError::InvalidFormat(format!("UTF-8: {e}")))
    }

    /// Re-wrap the DEK under a new KEK without touching the secret ciphertext.
    ///
    /// `self` is the **old** KEK that can decrypt `enveloped.dek_ciphertext`.
    /// `new_enc` is the **new** KEK that the re-wrapped DEK will be sealed under.
    ///
    /// The returned `EnvelopedSecret` has the same `secret_ciphertext` but a
    /// fresh `dek_ciphertext` sealed under `new_enc`.
    pub fn rewrap_dek(
        &self,
        enveloped: &EnvelopedSecret,
        new_enc: &EnvelopeEncryption,
    ) -> Result<EnvelopedSecret, EnvelopeError> {
        // Decrypt DEK with old KEK
        let mut dek_bytes_vec = Self::aead_open(&self.kek.0, &enveloped.dek_ciphertext)?;
        if dek_bytes_vec.len() != 32 {
            dek_bytes_vec.zeroize();
            return Err(EnvelopeError::InvalidFormat("DEK must be 32 bytes".into()));
        }
        let mut dek = [0u8; 32];
        dek.copy_from_slice(&dek_bytes_vec);
        dek_bytes_vec.zeroize();

        // Re-encrypt DEK with new KEK
        let new_dek_ciphertext = Self::aead_seal(&new_enc.kek.0, "kek", &dek)?;
        dek.zeroize();

        Ok(EnvelopedSecret {
            dek_ciphertext: new_dek_ciphertext,
            // Secret ciphertext is unchanged — this is the whole point
            secret_ciphertext: enveloped.secret_ciphertext.clone(),
        })
    }
}

// ── Batch rotation ───────────────────────────────────────────────────────────

/// Re-wrap every record's DEK from `old_enc`'s KEK to `new_enc`'s KEK.
///
/// Returns one `RotationResult` per input row. A per-row failure (e.g. corrupt
/// DEK ciphertext) is captured in `result: Err(...)` and does not abort the
/// rest of the batch — the caller should log failures and schedule a retry.
pub fn rotate_kek(
    old_enc: &EnvelopeEncryption,
    new_enc: &EnvelopeEncryption,
    records: &[(String, EnvelopedSecret)],
) -> Vec<RotationResult> {
    records
        .iter()
        .map(|(row_id, enveloped)| {
            let result = old_enc
                .rewrap_dek(enveloped, new_enc)
                .map_err(|e| e.to_string());
            RotationResult { row_id: row_id.clone(), result }
        })
        .collect()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn enc() -> EnvelopeEncryption {
        EnvelopeEncryption::generate()
    }

    // ── AC 1 & 2: seal / open roundtrip ──────────────────────────────────────

    #[test]
    fn seal_open_roundtrip_bytes() {
        let enc = enc();
        let plaintext = b"SBUYER2EXAMPLESTELLARSECRETKEY000000000000000000000000000";
        let enveloped = enc.seal(plaintext).unwrap();
        assert!(enveloped.dek_ciphertext.starts_with("kek:"));
        assert!(enveloped.secret_ciphertext.starts_with("enc:"));
        let recovered = enc.open(&enveloped).unwrap();
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn seal_open_roundtrip_str() {
        let enc = enc();
        let secret = "SSTELLARSECRETKEYEXAMPLE1234567890ABCDEFGHIJKLMNOPQRSTUV";
        let enveloped = enc.seal_str(secret).unwrap();
        let recovered = enc.open_str(&enveloped).unwrap();
        assert_eq!(recovered, secret);
    }

    #[test]
    fn wrong_kek_fails_open() {
        let enc1 = enc();
        let enc2 = enc();
        let enveloped = enc1.seal_str("secret").unwrap();
        // enc2 has a different KEK — DEK unwrap must fail
        let result = enc2.open(&enveloped);
        assert!(result.is_err());
    }

    #[test]
    fn tampered_dek_ciphertext_fails_open() {
        let enc = enc();
        let mut enveloped = enc.seal_str("stellar-secret").unwrap();
        // Corrupt the last byte of dek_ciphertext
        let last = enveloped.dek_ciphertext.pop().unwrap();
        enveloped.dek_ciphertext.push(if last == 'a' { 'b' } else { 'a' });
        assert!(enc.open(&enveloped).is_err());
    }

    // ── AC 3: rotating KEK re-wraps DEKs without touching ciphertext ──────────

    #[test]
    fn rotate_kek_preserves_plaintext() {
        let kek1 = enc();
        let kek2 = enc();
        let secret = "STELEPHONEBOOK999SECRETKEYABCDEFGHIJKLMNOPQRSTUVWXYZ01234";

        // Seal under kek1
        let enveloped = kek1.seal_str(secret).unwrap();
        let original_secret_ct = enveloped.secret_ciphertext.clone();

        // Re-wrap to kek2
        let rewrapped = kek1.rewrap_dek(&enveloped, &kek2).unwrap();

        // secret_ciphertext must be byte-for-byte identical
        assert_eq!(
            rewrapped.secret_ciphertext, original_secret_ct,
            "secret_ciphertext must not change during KEK rotation"
        );
        // dek_ciphertext must be different (new KEK)
        assert_ne!(rewrapped.dek_ciphertext, enveloped.dek_ciphertext);

        // Open with new KEK — plaintext must be unchanged
        let recovered = kek2.open_str(&rewrapped).unwrap();
        assert_eq!(recovered, secret, "plaintext must survive KEK rotation");
    }

    // ── AC 4: batch rotation script ──────────────────────────────────────────

    #[test]
    fn rotate_kek_batch_reports_success_per_row() {
        let kek1 = enc();
        let kek2 = enc();

        let records: Vec<(String, EnvelopedSecret)> = (0..5)
            .map(|i| {
                let enveloped = kek1.seal_str(&format!("secret-{i}")).unwrap();
                (format!("row-{i}"), enveloped)
            })
            .collect();

        let results = rotate_kek(&kek1, &kek2, &records);
        assert_eq!(results.len(), 5);

        for (i, r) in results.iter().enumerate() {
            assert_eq!(r.row_id, format!("row-{i}"));
            assert!(r.result.is_ok(), "row-{i} should succeed");
            // Verify each re-wrapped envelope is openable with kek2
            let re = r.result.as_ref().unwrap();
            let plain = kek2.open_str(re).unwrap();
            assert_eq!(plain, format!("secret-{i}"));
        }
    }

    #[test]
    fn rotate_kek_batch_captures_per_row_failure_without_aborting() {
        let kek1 = enc();
        let kek2 = enc();
        let kek_other = enc(); // wrong KEK — produces corrupt envelopes

        // row-0: sealed under kek_other (kek1 cannot open it)
        // row-1: sealed under kek1 (valid)
        let bad = kek_other.seal_str("bad-secret").unwrap();
        let good = kek1.seal_str("good-secret").unwrap();

        let records = vec![
            ("row-0".to_string(), bad),
            ("row-1".to_string(), good),
        ];

        let results = rotate_kek(&kek1, &kek2, &records);
        assert_eq!(results.len(), 2);
        // row-0 must fail
        assert!(results[0].result.is_err(), "corrupt DEK must fail");
        // row-1 must succeed
        assert!(results[1].result.is_ok(), "valid DEK must succeed");
    }

    // ── AC 5: JSON serialization roundtrip ───────────────────────────────────

    #[test]
    fn enveloped_secret_json_roundtrip() {
        let enc = enc();
        let enveloped = enc.seal_str("STELLAR_SECRET_KEY_FOR_SERIALIZATION_TEST").unwrap();
        let json = serde_json::to_string(&enveloped).unwrap();
        let restored: EnvelopedSecret = serde_json::from_str(&json).unwrap();
        assert_eq!(enveloped, restored);
        // Still openable after roundtrip
        let plain = enc.open_str(&restored).unwrap();
        assert_eq!(plain, "STELLAR_SECRET_KEY_FOR_SERIALIZATION_TEST");
    }
}
