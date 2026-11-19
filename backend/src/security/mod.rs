//! Security module for ArenaX backend.
//!
//! Provides cryptographic data protection, data-at-rest encryption (Issue #951),
//! key rotation management, and access audit logging.
//!
//! Issue #1361 adds envelope encryption for Stellar secret keys: each secret is
//! protected by a randomly-generated per-record DEK, itself wrapped under a
//! master KEK loaded from the `STELLAR_KEK` environment variable.

pub mod encryption;
pub mod envelope_encryption;

pub use encryption::{
    EncryptedField, EncryptionAuditEvent, EncryptionAuditLogger, EncryptionError,
    EncryptionKey, KeyRing, KeyVersion, PiiDataProtector,
};

pub use envelope_encryption::{
    EnvelopeEncryption, EnvelopedSecret, EnvelopeError, RotationResult,
};
