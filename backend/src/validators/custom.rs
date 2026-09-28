//! Reusable custom validators.
//!
//! Every validator returns a [`validator::ValidationError`] with a stable
//! `code` and structured `params`. The codes are the keys used by the
//! [`crate::validators::i18n`] catalog, so error messages can be localized
//! without changing call sites.
//!
//! The single-argument validators (`validate_username`, `validate_password`,
//! …) are compatible with the `validator` crate's `#[validate(custom = "...")]`
//! attribute:
//!
//! ```ignore
//! #[derive(validator::Validate)]
//! struct RegisterRequest {
//!     #[validate(custom = "crate::validators::custom::validate_username")]
//!     username: String,
//! }
//! ```

use std::borrow::Cow;

use uuid::Uuid;
use validator::ValidationError;

/// Minimum username length in characters.
pub const USERNAME_MIN: usize = 3;
/// Maximum username length in characters.
pub const USERNAME_MAX: usize = 32;

/// Minimum password length in characters.
pub const PASSWORD_MIN: usize = 8;
/// Maximum password length in characters.
pub const PASSWORD_MAX: usize = 128;

/// Minimum reference (idempotency key) length.
pub const REFERENCE_MIN: usize = 8;
/// Maximum reference (idempotency key) length.
pub const REFERENCE_MAX: usize = 128;

/// Minimum phone number digit count (E.164).
pub const PHONE_MIN_DIGITS: usize = 7;
/// Maximum phone number digit count (E.164).
pub const PHONE_MAX_DIGITS: usize = 15;

/// Stellar public keys (ed25519/muxed) are 56 base32 characters.
pub const STELLAR_ADDRESS_LEN: usize = 56;

/// Validate a username: 3–32 characters, letters/digits/`_`/`-`/`.` only.
pub fn validate_username(value: &str) -> Result<(), ValidationError> {
    let len = value.chars().count();
    if !(USERNAME_MIN..=USERNAME_MAX).contains(&len) {
        let mut err = ValidationError::new("username");
        err.add_param(Cow::from("min"), &USERNAME_MIN);
        err.add_param(Cow::from("max"), &USERNAME_MAX);
        return Err(err);
    }
    let allowed =
        value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    if !allowed {
        return Err(ValidationError::new("username_charset"));
    }
    Ok(())
}

/// Validate a password: 8–128 characters with at least one uppercase letter,
/// one lowercase letter and one digit.
pub fn validate_password(value: &str) -> Result<(), ValidationError> {
    let len = value.chars().count();
    if !(PASSWORD_MIN..=PASSWORD_MAX).contains(&len) {
        let mut err = ValidationError::new("password");
        err.add_param(Cow::from("min"), &PASSWORD_MIN);
        err.add_param(Cow::from("max"), &PASSWORD_MAX);
        return Err(err);
    }
    let has_lower = value.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = value.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = value.chars().any(|c| c.is_ascii_digit());
    if !(has_lower && has_upper && has_digit) {
        return Err(ValidationError::new("password_complexity"));
    }
    Ok(())
}

/// Validate that a string is a well-formed UUID.
pub fn validate_uuid(value: &str) -> Result<(), ValidationError> {
    if Uuid::parse_str(value).is_err() {
        return Err(ValidationError::new("uuid"));
    }
    Ok(())
}

/// Validate a currency code: 3–10 letters/digits (e.g. `NGN`, `XLM`, `ARENAX_TOKEN`).
pub fn validate_currency(value: &str) -> Result<(), ValidationError> {
    let valid = (3..=10).contains(&value.len())
        && value.chars().all(|c| c.is_ascii_alphanumeric());
    if !valid {
        return Err(ValidationError::new("currency"));
    }
    Ok(())
}

/// Validate a Stellar account address: 56 base32 characters starting with `G`/`C`.
pub fn validate_stellar_address(value: &str) -> Result<(), ValidationError> {
    let valid = value.len() == STELLAR_ADDRESS_LEN
        && (value.starts_with('G') || value.starts_with('C'))
        && value.chars().all(|c| c.is_ascii_alphanumeric());
    if !valid {
        return Err(ValidationError::new("stellar_address"));
    }
    Ok(())
}

/// Validate a phone number in E.164-ish form: optional leading `+`, 7–15 digits.
pub fn validate_phone_number(value: &str) -> Result<(), ValidationError> {
    let body = value.strip_prefix('+').unwrap_or(value);
    let valid = (PHONE_MIN_DIGITS..=PHONE_MAX_DIGITS).contains(&body.len())
        && body.chars().all(|c| c.is_ascii_digit())
        && value.chars().all(|c| c.is_ascii_digit() || c == '+')
        && value.matches('+').count() <= 1;
    if !valid {
        return Err(ValidationError::new("phone_number"));
    }
    Ok(())
}

/// Validate a "safe" free-text string: no control characters and at most
/// `max_len` bytes. Mirrors [`crate::middleware::security::validate_safe_string`]
/// but returns a structured, localizable error.
pub fn validate_safe_string(value: &str, max_len: usize) -> Result<(), ValidationError> {
    if value.len() > max_len {
        let mut err = ValidationError::new("safe_string_length");
        err.add_param(Cow::from("max"), &max_len);
        return Err(err);
    }
    if value.chars().any(|c| c.is_control()) {
        return Err(ValidationError::new("safe_string_control"));
    }
    Ok(())
}

/// Validate a positive integer amount.
pub fn validate_positive_amount(amount: i64) -> Result<(), ValidationError> {
    if amount <= 0 {
        return Err(ValidationError::new("positive_amount"));
    }
    Ok(())
}

/// Validate a reference / idempotency key: 8–128 chars, letters/digits/`_`/`-`.
///
/// Matches the rules enforced by `IdempotencyService::validate_key_format`.
pub fn validate_reference(value: &str) -> Result<(), ValidationError> {
    let valid = (REFERENCE_MIN..=REFERENCE_MAX).contains(&value.len())
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !valid {
        let mut err = ValidationError::new("reference");
        err.add_param(Cow::from("min"), &REFERENCE_MIN);
        err.add_param(Cow::from("max"), &REFERENCE_MAX);
        return Err(err);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn username_validates_length_and_charset() {
        assert!(validate_username("player_one").is_ok());
        assert!(validate_username("abc").is_ok());
        assert!(validate_username("a-b.c").is_ok());

        let err = validate_username("ab").unwrap_err();
        assert_eq!(err.code.as_ref(), "username");
        assert!(err.params.contains_key("min"));
        assert!(err.params.contains_key("max"));

        assert!(validate_username("has space").is_err());
        assert!(validate_username("emoji😀").is_err());

        let long = "a".repeat(33);
        assert!(validate_username(&long).is_err());
    }

    #[test]
    fn password_validates_length_and_complexity() {
        assert!(validate_password("StrongPass1").is_ok());

        let err = validate_password("weak").unwrap_err();
        assert_eq!(err.code.as_ref(), "password");

        let err = validate_password("alllowercase1").unwrap_err();
        assert_eq!(err.code.as_ref(), "password_complexity");

        assert!(validate_password("NODIGITS").is_err());
    }

    #[test]
    fn uuid_validates() {
        assert!(validate_uuid("550e8400-e29b-41d4-a716-446655440000").is_ok());
        assert!(validate_uuid("not-a-uuid").is_err());
    }

    #[test]
    fn currency_validates() {
        assert!(validate_currency("NGN").is_ok());
        assert!(validate_currency("ARENAX_TOKEN").is_ok());
        assert!(validate_currency("NG").is_err());
        assert!(validate_currency("has space").is_err());
    }

    #[test]
    fn stellar_address_validates() {
        let addr = format!("G{}", "A".repeat(55));
        assert!(validate_stellar_address(&addr).is_ok());

        let err = validate_stellar_address("SHORT").unwrap_err();
        assert_eq!(err.code.as_ref(), "stellar_address");

        assert!(validate_stellar_address(&format!("X{}", "A".repeat(55))).is_err());
    }

    #[test]
    fn phone_number_validates() {
        assert!(validate_phone_number("+2348012345678").is_ok());
        assert!(validate_phone_number("08012345678").is_ok());
        assert!(validate_phone_number("+1").is_err());
        assert!(validate_phone_number("abc12345678").is_err());
        assert!(validate_phone_number("++2348012345678").is_err());
    }

    #[test]
    fn safe_string_validates() {
        assert!(validate_safe_string("hello world", 255).is_ok());

        let err = validate_safe_string("hello", 3).unwrap_err();
        assert_eq!(err.code.as_ref(), "safe_string_length");

        let err = validate_safe_string("bad\u{0007}control", 255).unwrap_err();
        assert_eq!(err.code.as_ref(), "safe_string_control");
    }

    #[test]
    fn positive_amount_validates() {
        assert!(validate_positive_amount(1).is_ok());
        let err = validate_positive_amount(0).unwrap_err();
        assert_eq!(err.code.as_ref(), "positive_amount");
        assert!(validate_positive_amount(-5).is_err());
    }

    #[test]
    fn reference_validates() {
        assert!(validate_reference("valid_key_123").is_ok());
        assert!(validate_reference("key-with-hyphens").is_ok());
        assert!(validate_reference("12345678").is_ok());

        let err = validate_reference("short").unwrap_err();
        assert_eq!(err.code.as_ref(), "reference");

        assert!(validate_reference("").is_err());
        assert!(validate_reference("key with spaces").is_err());
        assert!(validate_reference("key@with#symbols").is_err());
    }
}
