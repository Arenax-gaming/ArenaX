//! Startup validation tests for secret-bearing environment variables (#1161).
//!
//! `Config::from_env()` is what `main.rs` calls before serving traffic, so a
//! failure here is exactly "the application refuses to start".
//!
//! Environment variables are process-global, so every assertion lives inside a
//! single `#[test]` that mutates them sequentially. Splitting these into
//! separate tests would let the test harness run them in parallel and race on
//! the same variables.

use arenax_backend::config::Config;
use std::env;

/// Build a value guaranteed to clear `MIN_SECRET_LENGTH` without relying on a
/// hand-counted literal.
fn strong(prefix: &str) -> String {
    format!("{prefix}-0123456789abcdef0123456789abcdef")
}

/// Values that are valid and required, but are not secrets themselves.
fn set_non_secret_env() {
    let vars = [
        ("DATABASE_URL", "postgres://user:pass@localhost:5432/arenax"),
        ("REDIS_URL", "redis://localhost:6379"),
        ("S3_ENDPOINT", "http://localhost:9000"),
        ("S3_ACCESS_KEY", "minio"),
        ("S3_BUCKET", "arenax"),
        ("JWT_EXPIRES_IN", "15m"),
        ("STELLAR_NETWORK_URL", "https://horizon-testnet.stellar.org"),
        ("SOROBAN_CONTRACT_PRIZE", "CAXXX"),
        ("SOROBAN_CONTRACT_REPUTATION", "CBXXX_REPUTATION"),
        ("SOROBAN_CONTRACT_ARENAX_TOKEN", "CCXXX"),
        ("AI_MODEL_PATH", "./models/anti_cheat.tflite"),
        ("PORT", "8080"),
        ("HOST", "0.0.0.0"),
        ("RATE_LIMIT_REQUESTS", "100"),
        ("RATE_LIMIT_WINDOW", "60"),
    ];

    for (key, value) in vars {
        env::set_var(key, value);
    }
}

/// Every required secret set to a strong value.
fn set_strong_secrets() {
    env::set_var("JWT_SECRET", strong("jwt"));
    env::set_var("PAYSTACK_SECRET", strong("sk_test_paystack"));
    env::set_var("FLUTTERWAVE_SECRET", strong("FLWSECK_TEST_flw"));
    env::set_var("S3_SECRET_KEY", strong("s3"));
    env::set_var("STELLAR_ADMIN_SECRET", strong("STELLAR_ADMIN"));
}

#[test]
fn config_from_env_refuses_missing_or_weak_secrets() {
    set_non_secret_env();

    // ── Baseline: a fully strong configuration loads ──────────────────────
    set_strong_secrets();
    env::remove_var("JWT_REFRESH_SECRET");
    Config::from_env().expect("a fully-populated, strong configuration must load");

    // ── JWT_SECRET missing entirely ───────────────────────────────────────
    env::remove_var("JWT_SECRET");
    let err = Config::from_env().expect_err("missing JWT_SECRET must abort startup");
    assert!(
        err.to_string().contains("JWT_SECRET"),
        "error should name the missing variable, got: {err}"
    );
    set_strong_secrets();

    // ── JWT_SECRET set to the legacy hardcoded default ────────────────────
    env::set_var("JWT_SECRET", "default_secret_change_in_production");
    let err = Config::from_env().expect_err("the legacy default secret must abort startup");
    assert!(
        err.to_string().contains("JWT_SECRET"),
        "error should name the offending variable, got: {err}"
    );

    // ── JWT_SECRET below the entropy floor ────────────────────────────────
    // Note: this value is not on the placeholder deny-list, so it must be
    // rejected specifically by the length rule.
    env::set_var("JWT_SECRET", "short-but-not-a-known-placeholder");
    let err = Config::from_env().expect_err("a short JWT_SECRET must abort startup");
    assert!(
        err.to_string().contains("at least 32 characters"),
        "error should explain the length requirement, got: {err}"
    );

    // ── A placeholder value is rejected even when it is long enough ───────
    env::set_var("JWT_SECRET", "supersecretkey");
    let err = Config::from_env().expect_err("a placeholder JWT_SECRET must abort startup");
    assert!(
        err.to_string().contains("JWT_SECRET"),
        "error should name the offending variable, got: {err}"
    );

    // ── Recovery: a strong secret is accepted again ───────────────────────
    env::set_var("JWT_SECRET", strong("jwt"));

    // ── JWT_REFRESH_SECRET is guarded too (when supplied) ─────────────────
    env::set_var("JWT_REFRESH_SECRET", "weak");
    let err = Config::from_env().expect_err("a weak JWT_REFRESH_SECRET must abort startup");
    assert!(
        err.to_string().contains("JWT_REFRESH_SECRET"),
        "error should name the offending variable, got: {err}"
    );

    env::set_var("JWT_REFRESH_SECRET", strong("jwt_refresh"));

    // ── Other secret-bearing variables are guarded as well ────────────────
    env::set_var("PAYSTACK_SECRET", "sk_test_123");
    let err = Config::from_env().expect_err("a weak PAYSTACK_SECRET must abort startup");
    assert!(
        err.to_string().contains("PAYSTACK_SECRET"),
        "error should name the offending variable, got: {err}"
    );
    env::set_var("PAYSTACK_SECRET", strong("sk_test_paystack"));

    let expected_refresh = strong("jwt_refresh");
    let config = Config::from_env().expect("strong configuration must load again");
    assert_eq!(config.auth.jwt_expires_in, "15m");
    assert_eq!(
        config.auth.jwt_refresh_secret.as_deref(),
        Some(expected_refresh.as_str())
    );
}
