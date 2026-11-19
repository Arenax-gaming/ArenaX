//! Security module for ArenaX backend.
//!
//! Provides cryptographic data protection, data-at-rest encryption (Issue #951),
//! key rotation management, and access audit logging.

pub mod encryption;
pub mod rate_limit_abuse;

pub use encryption::{
    EncryptedField, EncryptionAuditEvent, EncryptionAuditLogger, EncryptionError,
    EncryptionKey, KeyRing, KeyVersion, PiiDataProtector,
};
pub use rate_limit_abuse::{
    clear_block, is_user_blocked, record_hit_and_maybe_block, BLOCK_DURATION_SECS,
    DETECTION_WINDOW_SECS, DISTINCT_IP_THRESHOLD,
};
