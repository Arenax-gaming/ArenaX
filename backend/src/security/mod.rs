//! Security module for ArenaX backend.
//!
//! Provides cryptographic data protection, data-at-rest encryption (Issue #951),
//! key rotation management, and access audit logging.

pub mod encryption;

pub use encryption::{
    EncryptedField, EncryptionAuditEvent, EncryptionAuditLogger, EncryptionError,
    EncryptionKey, KeyRing, KeyVersion, PiiDataProtector,
};
