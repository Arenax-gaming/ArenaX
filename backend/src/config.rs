use serde::Deserialize;
use std::env;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub database: DatabaseConfig,
    pub redis: RedisConfig,
    pub storage: StorageConfig,
    pub payments: PaymentsConfig,
    pub auth: AuthConfig,
    pub stellar: StellarConfig,
    pub ai: AiConfig,
    pub server: ServerConfig,
    pub rate_limit: RateLimitConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RedisConfig {
    pub url: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StorageConfig {
    pub s3_endpoint: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,
    pub s3_bucket: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PaymentsConfig {
    pub paystack_secret: String,
    pub flutterwave_secret: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AuthConfig {
    pub jwt_secret: String,
    pub jwt_expires_in: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StellarConfig {
    pub network_url: String,
    pub admin_secret: String,
    pub soroban_contract_prize: String,
    pub soroban_contract_reputation: String,
    pub soroban_contract_arenax_token: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AiConfig {
    pub model_path: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ServerConfig {
    pub port: u16,
    pub host: String,
    pub rust_log: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RateLimitConfig {
    pub requests: u32,
    pub window: u64,
}

// ── Placeholder / insecure default detection ──────────────────────────────────

/// Known placeholder and insecure default values that must never reach production.
const INSECURE_PLACEHOLDERS: &[&str] = &[
    "supersecretkey",
    "default_secret_change_in_production",
    "changeme",
    "secret",
    "password",
    "admin",
    "test",
    "example",
    "sk_test_xxx",
    "FLWSECK_TEST-xxx",
    "SBXXX...",
    "CAXXX...",
    "CBXXX...",
    "CCXXX...",
    "replace_with_a_very_long_random_secret_at_least_32_chars",
    "32_character_hex_string_here",
    "your-secret",
    "your_secret",
];

/// Validates that a secret env var is present, non-empty, meets a minimum
/// length, and is not a known placeholder value.
///
/// Returns `Err` with a descriptive message (no secret value included) on
/// failure so the caller can surface it as a startup error.
pub fn require_secret(var_name: &str, min_len: usize) -> Result<String, String> {
    let value = env::var(var_name)
        .map_err(|_| format!("Required secret '{}' is not set", var_name))?;

    if value.trim().is_empty() {
        return Err(format!("Required secret '{}' must not be empty", var_name));
    }

    if value.len() < min_len {
        return Err(format!(
            "Required secret '{}' is too short (minimum {} characters)",
            var_name, min_len
        ));
    }

    let lower = value.to_lowercase();
    for placeholder in INSECURE_PLACEHOLDERS {
        if lower == placeholder.to_lowercase() || value == *placeholder {
            return Err(format!(
                "Required secret '{}' contains a known insecure placeholder value. \
                 Set a strong, randomly-generated secret.",
                var_name
            ));
        }
    }

    Ok(value)
}

impl Config {
    pub fn from_env() -> Result<Self, anyhow::Error> {
        dotenvy::dotenv().ok();

        // ── Non-secret vars (? is fine) ───────────────────────────────────────
        let database_url = env::var("DATABASE_URL")?;
        let redis_url = env::var("REDIS_URL")?;
        let s3_endpoint = env::var("S3_ENDPOINT")?;
        let s3_access_key = env::var("S3_ACCESS_KEY")?;
        let s3_bucket = env::var("S3_BUCKET")?;
        let stellar_network_url = env::var("STELLAR_NETWORK_URL")?;
        let soroban_contract_prize = env::var("SOROBAN_CONTRACT_PRIZE")?;
        let soroban_contract_reputation = env::var("SOROBAN_CONTRACT_REPUTATION")?;
        let soroban_contract_arenax_token = env::var("SOROBAN_CONTRACT_ARENAX_TOKEN")?;
        let ai_model_path = env::var("AI_MODEL_PATH")?;
        let port: u16 = env::var("PORT")?.parse()?;
        let host = env::var("HOST")?;
        // RUST_LOG is not a secret — a safe default is acceptable.
        let rust_log = env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
        let rate_limit_requests: u32 = env::var("RATE_LIMIT_REQUESTS")?.parse()?;
        let rate_limit_window: u64 = env::var("RATE_LIMIT_WINDOW")?.parse()?;
        let jwt_expires_in = env::var("JWT_EXPIRES_IN")?;

        // ── Secret vars — strict validation, no fallbacks ─────────────────────
        let jwt_secret = require_secret("JWT_SECRET", 32)
            .map_err(|e| anyhow::anyhow!(e))?;

        let s3_secret_key = require_secret("S3_SECRET_KEY", 8)
            .map_err(|e| anyhow::anyhow!(e))?;

        let paystack_secret = require_secret("PAYSTACK_SECRET", 16)
            .map_err(|e| anyhow::anyhow!(e))?;

        let flutterwave_secret = require_secret("FLUTTERWAVE_SECRET", 16)
            .map_err(|e| anyhow::anyhow!(e))?;

        // Stellar secret keys start with 'S' and are 56 chars (Stellar keypair encoding).
        let stellar_admin_secret = require_secret("STELLAR_ADMIN_SECRET", 32)
            .map_err(|e| anyhow::anyhow!(e))?;

        Ok(Config {
            database: DatabaseConfig { url: database_url },
            redis: RedisConfig { url: redis_url },
            storage: StorageConfig {
                s3_endpoint,
                s3_access_key,
                s3_secret_key,
                s3_bucket,
            },
            payments: PaymentsConfig {
                paystack_secret,
                flutterwave_secret,
            },
            auth: AuthConfig {
                jwt_secret,
                jwt_expires_in,
            },
            stellar: StellarConfig {
                network_url: stellar_network_url,
                admin_secret: stellar_admin_secret,
                soroban_contract_prize,
                soroban_contract_reputation,
                soroban_contract_arenax_token,
            },
            ai: AiConfig {
                model_path: ai_model_path,
            },
            server: ServerConfig {
                port,
                host,
                rust_log,
            },
            rate_limit: RateLimitConfig {
                requests: rate_limit_requests,
                window: rate_limit_window,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn set(k: &str, v: &str) {
        env::set_var(k, v);
    }
    fn unset(k: &str) {
        env::remove_var(k);
    }

    // ── require_secret ────────────────────────────────────────────────────────

    #[test]
    fn valid_secret_passes() {
        set("TEST_SECRET_VALID", "a_very_strong_random_secret_value_xyz");
        assert!(require_secret("TEST_SECRET_VALID", 16).is_ok());
        unset("TEST_SECRET_VALID");
    }

    #[test]
    fn missing_var_fails() {
        unset("TEST_SECRET_MISSING");
        let err = require_secret("TEST_SECRET_MISSING", 8).unwrap_err();
        assert!(err.contains("is not set"), "got: {err}");
    }

    #[test]
    fn empty_var_fails() {
        set("TEST_SECRET_EMPTY", "");
        let err = require_secret("TEST_SECRET_EMPTY", 8).unwrap_err();
        assert!(err.contains("must not be empty"), "got: {err}");
        unset("TEST_SECRET_EMPTY");
    }

    #[test]
    fn whitespace_only_fails() {
        set("TEST_SECRET_WS", "   ");
        let err = require_secret("TEST_SECRET_WS", 1).unwrap_err();
        assert!(err.contains("must not be empty"), "got: {err}");
        unset("TEST_SECRET_WS");
    }

    #[test]
    fn too_short_fails() {
        set("TEST_SECRET_SHORT", "abc");
        let err = require_secret("TEST_SECRET_SHORT", 16).unwrap_err();
        assert!(err.contains("too short"), "got: {err}");
        unset("TEST_SECRET_SHORT");
    }

    #[test]
    fn placeholder_supersecretkey_fails() {
        set("TEST_SECRET_PH", "supersecretkey");
        let err = require_secret("TEST_SECRET_PH", 8).unwrap_err();
        assert!(err.contains("insecure placeholder"), "got: {err}");
        unset("TEST_SECRET_PH");
    }

    #[test]
    fn placeholder_default_secret_fails() {
        set("TEST_SECRET_DEF", "default_secret_change_in_production");
        let err = require_secret("TEST_SECRET_DEF", 8).unwrap_err();
        assert!(err.contains("insecure placeholder"), "got: {err}");
        unset("TEST_SECRET_DEF");
    }

    #[test]
    fn placeholder_sk_test_xxx_fails() {
        set("TEST_SECRET_SK", "sk_test_xxx");
        let err = require_secret("TEST_SECRET_SK", 8).unwrap_err();
        assert!(err.contains("insecure placeholder"), "got: {err}");
        unset("TEST_SECRET_SK");
    }

    #[test]
    fn placeholder_stellar_sbxxx_fails() {
        set("TEST_SECRET_STELLAR", "SBXXX...");
        let err = require_secret("TEST_SECRET_STELLAR", 8).unwrap_err();
        assert!(err.contains("insecure placeholder"), "got: {err}");
        unset("TEST_SECRET_STELLAR");
    }

    #[test]
    fn error_message_does_not_contain_secret_value() {
        set("TEST_SECRET_LEAK", "supersecretkey");
        let err = require_secret("TEST_SECRET_LEAK", 8).unwrap_err();
        assert!(
            !err.contains("supersecretkey"),
            "error must not echo the secret value: {err}"
        );
        unset("TEST_SECRET_LEAK");
    }

    #[test]
    fn placeholder_check_is_case_insensitive() {
        set("TEST_SECRET_CASE", "SuperSecretKey");
        let err = require_secret("TEST_SECRET_CASE", 8).unwrap_err();
        assert!(err.contains("insecure placeholder"), "got: {err}");
        unset("TEST_SECRET_CASE");
    }
}
