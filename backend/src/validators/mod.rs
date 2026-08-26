//! Centralized input sanitization for ArenaX.
//!
//! Previously, HTML/SQL/XSS sanitization was ad-hoc — different handlers
//! rolled their own escaping (or none at all). This module is the single
//! place to import sanitizers from; new handlers and models should use
//! these instead of writing bespoke escaping logic.
//!
//! - [`sanitize::escape_html`] / [`sanitize::sanitize_rich_text`] — XSS /
//!   HTML entity encoding for any user-supplied string that may end up
//!   rendered in HTML (bios, chat, tournament descriptions, etc).
//! - [`sanitize::sanitize_identifier`] — SQL-injection prevention for the
//!   rare case where a value is used as a table/column identifier rather
//!   than a bound parameter (identifiers can't be bound with `$1` in sqlx).
//!   Ordinary query *values* are already protected because this codebase
//!   uses `sqlx`'s compile-time-checked, parameterized queries throughout —
//!   never string-interpolated SQL — which is the primary SQL-injection
//!   defense.
//! - [`sanitize::escape_like_pattern`] — escapes `%`/`_` wildcards before a
//!   user-supplied value is bound into a `LIKE`/`ILIKE` clause.
//! - [`file_upload`] — filename, extension, MIME type, and size validation
//!   for uploaded files.

pub mod file_upload;
pub mod sanitize;

pub use file_upload::{validate_file_upload, FileUploadError, FileUploadRules};
pub use sanitize::{
    escape_html, escape_like_pattern, sanitize_identifier, sanitize_plain_text,
    sanitize_rich_text, SanitizeError,
};
