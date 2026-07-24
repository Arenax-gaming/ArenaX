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
    pub migration_mode: MigrationMode,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum MigrationMode {
    Run,
    Disabled,
}

impl MigrationMode {
    fn from_env_value(value: &str) -> Result<Self, anyhow::Error> {
        match value.trim().to_ascii_lowercase().as_str() {
            "run" | "auto" | "true" | "1" => Ok(Self::Run),
            "disabled" | "disable" | "off" | "false" | "0" => Ok(Self::Disabled),
            other => anyhow::bail!(
                "invalid BACKEND_MIGRATION_MODE value `{}`; expected `run` or `disabled`",
                other
            ),
        }
    }
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
    /// Contract address for the match-lifecycle Soroban contract.
    /// Reads `SOROBAN_CONTRACT_MATCH` from the environment; falls back to
    /// `soroban_contract_prize` so existing deployments keep working without
    /// adding the new variable.
    pub soroban_contract_match: String,
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

impl Config {
    pub fn from_env() -> Result<Self, anyhow::Error> {
        dotenvy::dotenv().ok();

        let database_url = env::var("DATABASE_URL")?;
        let migration_mode = env::var("BACKEND_MIGRATION_MODE")
            .map(|value| MigrationMode::from_env_value(&value))
            .unwrap_or(Ok(MigrationMode::Run))?;
        let redis_url = env::var("REDIS_URL")?;
        let s3_endpoint = env::var("S3_ENDPOINT")?;
        let s3_access_key = env::var("S3_ACCESS_KEY")?;
        let s3_secret_key = env::var("S3_SECRET_KEY")?;
        let s3_bucket = env::var("S3_BUCKET")?;
        let paystack_secret = env::var("PAYSTACK_SECRET")?;
        let flutterwave_secret = env::var("FLUTTERWAVE_SECRET")?;
        let jwt_secret = env::var("JWT_SECRET")?;
        let jwt_expires_in = env::var("JWT_EXPIRES_IN")?;
        let stellar_network_url = env::var("STELLAR_NETWORK_URL")?;
        let stellar_admin_secret = env::var("STELLAR_ADMIN_SECRET")?;
        let soroban_contract_prize = env::var("SOROBAN_CONTRACT_PRIZE")?;
        let soroban_contract_reputation = env::var("SOROBAN_CONTRACT_REPUTATION")?;
        let soroban_contract_arenax_token = env::var("SOROBAN_CONTRACT_ARENAX_TOKEN")?;
        // Falls back to the prize contract so existing deployments don't break.
        let soroban_contract_match = env::var("SOROBAN_CONTRACT_MATCH")
            .unwrap_or_else(|_| soroban_contract_prize.clone());
        let ai_model_path = env::var("AI_MODEL_PATH")?;
        let port: u16 = env::var("PORT")?.parse()?;
        let host = env::var("HOST")?;
        let rust_log = env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
        let rate_limit_requests: u32 = env::var("RATE_LIMIT_REQUESTS")?.parse()?;
        let rate_limit_window: u64 = env::var("RATE_LIMIT_WINDOW")?.parse()?;

        Ok(Config {
            database: DatabaseConfig {
                url: database_url,
                migration_mode,
            },
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
                soroban_contract_match,
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
