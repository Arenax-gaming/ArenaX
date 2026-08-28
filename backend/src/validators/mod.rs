//! Central validation layer for the ArenaX backend.
//!
//! Previously, request validation was scattered across handlers, models and
//! middleware with no consistent abstraction. This module provides a single,
//! typed place for all input validation:
//!
//! - [`Validator`] / [`DeriveValidator`] — type-safe validators that wrap the
//!   derive-based `validator::Validate` impls used across the DTOs.
//! - [`custom`] — reusable custom validators (username, password, UUIDs,
//!   Stellar addresses, currency codes, phone numbers, …). These return
//!   `validator::ValidationError` so they can be used both programmatically and
//!   with `#[validate(custom = "...")]` attributes.
//! - [`json_schema`] — JSON Schema (draft-07) validation with a registry of
//!   schemas for the main request payloads.
//! - [`i18n`] — error-message localization: translates `ValidationErrors` into
//!   per-field, localized messages (English, French, Spanish, German, Swahili,
//!   Portuguese).
//! - [`async_validator`] — async validation support for checks that need I/O
//!   (e.g. uniqueness lookups against the database).
//!
//! # Example
//!
//! ```ignore
//! use crate::validators::{validate, i18n::{Locale, localize_validation_errors}};
//!
//! let dto = CreateMatchDTO { player_a: "short".into(), .. };
//! if let Err(errors) = validate(&dto) {
//!     let body = localize_validation_errors(&errors, Locale::En);
//!     // -> { "player_a": ["Must be exactly 56 characters long"] }
//! }
//! ```

pub mod async_validator;
pub mod custom;
pub mod i18n;
pub mod json_schema;

use std::marker::PhantomData;

use validator::{Validate, ValidationErrors};

pub use async_validator::{AsyncRule, AsyncValidator, AsyncValidatorSet, BoxFuture};
pub use json_schema::{JsonSchemaError, JsonSchemaValidator};

/// A type-safe validator.
///
/// Implementations validate a single typed value and return aggregated,
/// structured [`ValidationErrors`] — the same error type used by the
/// `validator` crate, so results can be localized with [`i18n`] or turned into
/// an `ApiError` by the HTTP layer.
pub trait Validator<T> {
    /// Validate `value`, returning `Ok(())` or aggregated field errors.
    fn validate(&self, value: &T) -> Result<(), ValidationErrors>;
}

/// Adapter that runs the derive-based [`Validate`] impl of `T`.
///
/// Any DTO that derives `validator::Validate` automatically becomes a
/// type-safe [`Validator`] through this adapter:
///
/// ```ignore
/// let validator = DeriveValidator::<CreateMatchDTO>::new();
/// validator.validate(&dto)?;
/// ```
#[derive(Debug, Clone, Copy, Default)]
pub struct DeriveValidator<T>(PhantomData<T>);

impl<T> DeriveValidator<T> {
    /// Create a new derive-backed validator for `T`.
    pub fn new() -> Self {
        Self(PhantomData)
    }
}

impl<T: Validate> Validator<T> for DeriveValidator<T> {
    fn validate(&self, value: &T) -> Result<(), ValidationErrors> {
        value.validate()
    }
}

/// Consistent entry point for validating any DTO that derives `validator::Validate`.
///
/// This is the single function handlers and services should call instead of
/// reaching for `validator::Validate::validate` directly, so validation always
/// flows through this layer.
pub fn validate<T: Validate>(value: &T) -> Result<(), ValidationErrors> {
    value.validate()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, validator::Validate)]
    struct CreateUserInput {
        #[validate(length(min = 3, max = 32), custom = "validate_username")]
        username: String,
        #[validate(email)]
        email: String,
    }

    use crate::validators::custom::validate_username;

    #[test]
    fn derive_validator_runs_validate() {
        let validator = DeriveValidator::<CreateUserInput>::new();

        let ok = CreateUserInput {
            username: "player_one".to_string(),
            email: "player@example.com".to_string(),
        };
        assert!(validator.validate(&ok).is_ok());

        let bad = CreateUserInput {
            username: "x".to_string(),
            email: "not-an-email".to_string(),
        };
        let errors = validator.validate(&bad).unwrap_err();
        assert!(errors.field_errors("username").is_some());
        assert!(errors.field_errors("email").is_some());
    }

    #[test]
    fn validate_entry_point_matches_derive() {
        let ok = CreateUserInput {
            username: "player_one".to_string(),
            email: "player@example.com".to_string(),
        };
        assert!(validate(&ok).is_ok());

        let bad = CreateUserInput {
            username: "x".to_string(),
            email: "player@example.com".to_string(),
        };
        assert!(validate(&bad).is_err());
    }
}
