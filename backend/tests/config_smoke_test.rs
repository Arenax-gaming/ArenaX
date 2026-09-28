use arenax_backend::config::Config;
use std::env;

#[test]
fn test_config_from_env_smoke() {
    let vars = [
        ("DATABASE_URL", "postgres://user:pass@localhost:5432/arenax"),
        ("REDIS_URL", "redis://localhost:6379"),
        ("S3_ENDPOINT", "http://localhost:9000"),
        ("S3_ACCESS_KEY", "minio"),
        ("S3_SECRET_KEY", "secret"),
        ("S3_BUCKET", "arenax"),
        ("PAYSTACK_SECRET", "sk_test_123"),
        ("FLUTTERWAVE_SECRET", "flw_test_123"),
        ("JWT_SECRET", "supersecretkey"),
        ("JWT_EXPIRES_IN", "15m"),
        ("STELLAR_NETWORK_URL", "https://horizon-testnet.stellar.org"),
        ("STELLAR_ADMIN_SECRET", "SBXXX"),
        ("SOROBAN_CONTRACT_PRIZE", "CAXXX"),
        ("SOROBAN_CONTRACT_REPUTATION", "CBXXX_REPUTATION"),
        // The old typo must not configure the reputation contract.
        ("SOROBAN_CONTRACT_REPUUTATION", "SHOULD_NOT_BE_READ"),
        ("SOROBAN_CONTRACT_ARENAX_TOKEN", "CCXXX"),
        ("AI_MODEL_PATH", "./models/anti_cheat.tflite"),
        ("PORT", "8080"),
        ("HOST", "0.0.0.0"),
        ("RATE_LIMIT_REQUESTS", "100"),
        ("RATE_LIMIT_WINDOW", "60"),
    ];

    for (k, v) in vars {
        env::set_var(k, v);
    }

    let config =
        Config::from_env().expect("Config::from_env should succeed with minimal required env");
    assert_eq!(
        config.stellar.soroban_contract_reputation,
        "CBXXX_REPUTATION"
    );
    assert_ne!(
        config.stellar.soroban_contract_reputation,
        "SHOULD_NOT_BE_READ"
    );
    assert_eq!(config.server.port, 8080);
}
