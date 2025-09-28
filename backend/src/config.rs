use serde::Deserialize;
use std::env;

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
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
#[allow(dead_code)]
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
    pub min_connections: u32,
    pub acquire_timeout: u64,
    pub idle_timeout: u64,
    pub max_lifetime: u64,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct RedisConfig {
    pub url: String,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct StorageConfig {
    pub s3_endpoint: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,
    pub s3_bucket: String,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct PaymentsConfig {
    pub paystack_secret: String,
    pub flutterwave_secret: String,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct AuthConfig {
    pub jwt_secret: String,
    pub jwt_expires_in: String,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct StellarConfig {
    pub network_url: String,
    pub admin_secret: String,
    pub soroban_contract_prize: String,
    pub soroban_contract_reputation: String,
    pub soroban_contract_arenax_token: String,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct AiConfig {
    pub model_path: String,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct ServerConfig {
    pub port: u16,
    pub host: String,
    pub rust_log: String,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct RateLimitConfig {
    pub requests: u32,
    pub window: u64,
}

impl Config {
    pub fn from_env() -> Result<Self, anyhow::Error> {
        dotenvy::dotenv().ok();

        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://user:pass@localhost:5432/arenax".to_string());
        let db_max_connections: u32 = env::var("DB_MAX_CONNECTIONS")
            .unwrap_or_else(|_| "20".to_string())
            .parse()?;
        let db_min_connections: u32 = env::var("DB_MIN_CONNECTIONS")
            .unwrap_or_else(|_| "5".to_string())
            .parse()?;
        let db_acquire_timeout: u64 = env::var("DB_ACQUIRE_TIMEOUT")
            .unwrap_or_else(|_| "30".to_string())
            .parse()?;
        let db_idle_timeout: u64 = env::var("DB_IDLE_TIMEOUT")
            .unwrap_or_else(|_| "600".to_string())
            .parse()?;
        let db_max_lifetime: u64 = env::var("DB_MAX_LIFETIME")
            .unwrap_or_else(|_| "1800".to_string())
            .parse()?;
        let redis_url =
            env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string());
        let s3_endpoint =
            env::var("S3_ENDPOINT").unwrap_or_else(|_| "http://localhost:9000".to_string());
        let s3_access_key = env::var("S3_ACCESS_KEY").unwrap_or_else(|_| "minio".to_string());
        let s3_secret_key = env::var("S3_SECRET_KEY").unwrap_or_else(|_| "secret".to_string());
        let s3_bucket = env::var("S3_BUCKET").unwrap_or_else(|_| "arenax".to_string());
        let paystack_secret =
            env::var("PAYSTACK_SECRET").unwrap_or_else(|_| "sk_test_xxx".to_string());
        let flutterwave_secret =
            env::var("FLUTTERWAVE_SECRET").unwrap_or_else(|_| "FLWSECK_TEST-xxx".to_string());
        let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| "supersecretkey".to_string());
        let jwt_expires_in = env::var("JWT_EXPIRES_IN").unwrap_or_else(|_| "7d".to_string());
        let stellar_network_url = env::var("STELLAR_NETWORK_URL")
            .unwrap_or_else(|_| "https://horizon-testnet.stellar.org".to_string());
        let stellar_admin_secret =
            env::var("STELLAR_ADMIN_SECRET").unwrap_or_else(|_| "SBXXX".to_string());
        let soroban_contract_prize =
            env::var("SOROBAN_CONTRACT_PRIZE").unwrap_or_else(|_| "CAXXX".to_string());
        let soroban_contract_reputation =
            env::var("SOROBAN_CONTRACT_REPUTATION").unwrap_or_else(|_| "CBXXX".to_string());
        let soroban_contract_arenax_token =
            env::var("SOROBAN_CONTRACT_ARENAX_TOKEN").unwrap_or_else(|_| "CCXXX".to_string());
        let ai_model_path =
            env::var("AI_MODEL_PATH").unwrap_or_else(|_| "./models/anti_cheat.tflite".to_string());
        let port: u16 = env::var("PORT")
            .unwrap_or_else(|_| "8080".to_string())
            .parse()?;
        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let rust_log = env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
        let rate_limit_requests: u32 = env::var("RATE_LIMIT_REQUESTS")
            .unwrap_or_else(|_| "100".to_string())
            .parse()?;
        let rate_limit_window: u64 = env::var("RATE_LIMIT_WINDOW")
            .unwrap_or_else(|_| "60".to_string())
            .parse()?;

        Ok(Config {
            database: DatabaseConfig {
                url: database_url,
                max_connections: db_max_connections,
                min_connections: db_min_connections,
                acquire_timeout: db_acquire_timeout,
                idle_timeout: db_idle_timeout,
                max_lifetime: db_max_lifetime,
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
