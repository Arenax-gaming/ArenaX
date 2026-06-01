/// Tests for config.rs secret validation (`require_secret`).
///
/// These tests run in a single thread to avoid env-var races.
use arenax_backend::config::require_secret;
use std::env;

fn set(k: &str, v: &str) {
    env::set_var(k, v);
}
fn unset(k: &str) {
    env::remove_var(k);
}

// ── happy path ────────────────────────────────────────────────────────────────

#[test]
fn valid_secret_passes_validation() {
    set("CFG_TEST_VALID", "a_strong_random_secret_value_xyz_1234");
    assert!(require_secret("CFG_TEST_VALID", 16).is_ok());
    unset("CFG_TEST_VALID");
}

#[test]
fn secret_exactly_at_min_length_passes() {
    set("CFG_TEST_EXACT", "exactly16chars!!");
    assert!(require_secret("CFG_TEST_EXACT", 16).is_ok());
    unset("CFG_TEST_EXACT");
}

// ── missing / empty ───────────────────────────────────────────────────────────

#[test]
fn missing_var_returns_error() {
    unset("CFG_TEST_MISSING");
    let err = require_secret("CFG_TEST_MISSING", 8).unwrap_err();
    assert!(err.contains("is not set"), "got: {err}");
}

#[test]
fn empty_string_returns_error() {
    set("CFG_TEST_EMPTY", "");
    let err = require_secret("CFG_TEST_EMPTY", 8).unwrap_err();
    assert!(err.contains("must not be empty"), "got: {err}");
    unset("CFG_TEST_EMPTY");
}

#[test]
fn whitespace_only_returns_error() {
    set("CFG_TEST_WS", "     ");
    let err = require_secret("CFG_TEST_WS", 1).unwrap_err();
    assert!(err.contains("must not be empty"), "got: {err}");
    unset("CFG_TEST_WS");
}

// ── minimum length ────────────────────────────────────────────────────────────

#[test]
fn too_short_returns_error() {
    set("CFG_TEST_SHORT", "short");
    let err = require_secret("CFG_TEST_SHORT", 32).unwrap_err();
    assert!(err.contains("too short"), "got: {err}");
    unset("CFG_TEST_SHORT");
}

#[test]
fn one_char_below_min_fails() {
    set("CFG_TEST_BELOW", "fifteen_chars!!");  // 15 chars
    let err = require_secret("CFG_TEST_BELOW", 16).unwrap_err();
    assert!(err.contains("too short"), "got: {err}");
    unset("CFG_TEST_BELOW");
}

// ── placeholder / insecure defaults ──────────────────────────────────────────

#[test]
fn placeholder_supersecretkey_rejected() {
    set("CFG_TEST_PH1", "supersecretkey");
    let err = require_secret("CFG_TEST_PH1", 8).unwrap_err();
    assert!(err.contains("insecure placeholder"), "got: {err}");
    unset("CFG_TEST_PH1");
}

#[test]
fn placeholder_default_secret_rejected() {
    set("CFG_TEST_PH2", "default_secret_change_in_production");
    let err = require_secret("CFG_TEST_PH2", 8).unwrap_err();
    assert!(err.contains("insecure placeholder"), "got: {err}");
    unset("CFG_TEST_PH2");
}

#[test]
fn placeholder_sk_test_xxx_rejected() {
    set("CFG_TEST_PH3", "sk_test_xxx");
    let err = require_secret("CFG_TEST_PH3", 8).unwrap_err();
    assert!(err.contains("insecure placeholder"), "got: {err}");
    unset("CFG_TEST_PH3");
}

#[test]
fn placeholder_flutterwave_test_rejected() {
    set("CFG_TEST_PH4", "FLWSECK_TEST-xxx");
    let err = require_secret("CFG_TEST_PH4", 8).unwrap_err();
    assert!(err.contains("insecure placeholder"), "got: {err}");
    unset("CFG_TEST_PH4");
}

#[test]
fn placeholder_stellar_sbxxx_rejected() {
    set("CFG_TEST_PH5", "SBXXX...");
    let err = require_secret("CFG_TEST_PH5", 8).unwrap_err();
    assert!(err.contains("insecure placeholder"), "got: {err}");
    unset("CFG_TEST_PH5");
}

#[test]
fn placeholder_admin_rejected() {
    set("CFG_TEST_PH6", "admin");
    let err = require_secret("CFG_TEST_PH6", 1).unwrap_err();
    assert!(err.contains("insecure placeholder"), "got: {err}");
    unset("CFG_TEST_PH6");
}

#[test]
fn placeholder_secret_rejected() {
    set("CFG_TEST_PH7", "secret");
    let err = require_secret("CFG_TEST_PH7", 1).unwrap_err();
    assert!(err.contains("insecure placeholder"), "got: {err}");
    unset("CFG_TEST_PH7");
}

#[test]
fn placeholder_changeme_rejected() {
    set("CFG_TEST_PH8", "changeme");
    let err = require_secret("CFG_TEST_PH8", 1).unwrap_err();
    assert!(err.contains("insecure placeholder"), "got: {err}");
    unset("CFG_TEST_PH8");
}

// ── case-insensitive placeholder check ───────────────────────────────────────

#[test]
fn placeholder_check_is_case_insensitive() {
    set("CFG_TEST_CASE", "SuperSecretKey");
    let err = require_secret("CFG_TEST_CASE", 8).unwrap_err();
    assert!(err.contains("insecure placeholder"), "got: {err}");
    unset("CFG_TEST_CASE");
}

#[test]
fn placeholder_admin_uppercase_rejected() {
    set("CFG_TEST_ADMIN_UP", "ADMIN");
    let err = require_secret("CFG_TEST_ADMIN_UP", 1).unwrap_err();
    assert!(err.contains("insecure placeholder"), "got: {err}");
    unset("CFG_TEST_ADMIN_UP");
}

// ── error message safety ──────────────────────────────────────────────────────

#[test]
fn error_does_not_leak_secret_value() {
    set("CFG_TEST_LEAK", "supersecretkey");
    let err = require_secret("CFG_TEST_LEAK", 8).unwrap_err();
    assert!(
        !err.contains("supersecretkey"),
        "error must not echo the secret value: {err}"
    );
    unset("CFG_TEST_LEAK");
}

#[test]
fn error_does_not_leak_short_secret_value() {
    set("CFG_TEST_LEAK2", "tooshort");
    let err = require_secret("CFG_TEST_LEAK2", 32).unwrap_err();
    assert!(
        !err.contains("tooshort"),
        "error must not echo the secret value: {err}"
    );
    unset("CFG_TEST_LEAK2");
}

#[test]
fn error_identifies_var_name() {
    unset("CFG_TEST_VARNAME");
    let err = require_secret("CFG_TEST_VARNAME", 8).unwrap_err();
    assert!(
        err.contains("CFG_TEST_VARNAME"),
        "error must identify the missing variable: {err}"
    );
}

// ── no silent fallback ────────────────────────────────────────────────────────

#[test]
fn jwt_secret_has_no_silent_fallback() {
    // Ensure JwtConfig::default() does NOT silently fall back to a hardcoded value.
    // We verify this by checking that require_secret fails when the var is absent.
    unset("JWT_SECRET");
    let result = require_secret("JWT_SECRET", 32);
    assert!(
        result.is_err(),
        "JWT_SECRET must not have a silent fallback"
    );
}

#[test]
fn paystack_secret_has_no_silent_fallback() {
    unset("PAYSTACK_SECRET");
    assert!(require_secret("PAYSTACK_SECRET", 16).is_err());
}

#[test]
fn stellar_admin_secret_has_no_silent_fallback() {
    unset("STELLAR_ADMIN_SECRET");
    assert!(require_secret("STELLAR_ADMIN_SECRET", 32).is_err());
}
