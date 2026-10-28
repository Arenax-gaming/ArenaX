use crate::models::{StellarAccount, StellarTransaction};
use crate::security::PiiDataProtector;
use crate::service::stellar_sdk_service::StellarSdkService;
use anyhow::Result;
use chrono::Utc;
use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use redis::Client as RedisClient;
use crate::middleware::horizon_circuit_breaker::{
    BreakerSnapshot, BreakerState, HorizonBreakerConfig, HorizonCallError, HorizonCircuitBreaker,
};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StellarError {
    #[error("Stellar account not found")]
    AccountNotFound,
    #[error("Insufficient XLM balance")]
    InsufficientBalance,
    #[error("Transaction failed: {0}")]
    TransactionFailed(String),
    #[error("Invalid public key")]
    InvalidPublicKey,
    #[error("Account not funded")]
    AccountNotFunded,
    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),
    #[error("Stellar SDK error: {0}")]
    StellarSdkError(String),
    /// Horizon is reachable but unhealthy (transport error, timeout, 5xx/429).
    #[error("Stellar Horizon request failed: {0}")]
    HorizonError(String),
    /// The Horizon circuit breaker is open; the call was not attempted.
    #[error("Stellar Horizon is temporarily unavailable (retry in {retry_after_secs}s)")]
    HorizonUnavailable { retry_after_secs: u64 },
}

/// Per-request timeout for Horizon calls, so a hung Horizon counts as a
/// failure in the circuit breaker instead of pinning a worker.
const HORIZON_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Raw Horizon HTTP failure, classified for the circuit breaker.
#[derive(Debug)]
enum HorizonHttpError {
    Transport(String),
    Status(reqwest::StatusCode),
}

impl std::fmt::Display for HorizonHttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transport(e) => write!(f, "transport error: {}", e),
            Self::Status(status) => write!(f, "Horizon returned {}", status),
        }
    }
}

/// Whether a Horizon HTTP status signals an outage rather than a bad request.
fn is_horizon_outage_status(status: reqwest::StatusCode) -> bool {
    status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS
}

pub type DbPool = Arc<PgPool>;

/// Structured log line for a point in a Stellar transaction's lifecycle
/// (#1106): `SUBMIT`/`CONFIRM` at INFO, `RETRY` at WARN, `DLQ` at ERROR.
/// `correlation_id` isn't a field here — it's already on the ambient
/// `http.request` tracing span (`middleware/tracing_middleware.rs`), and any
/// subscriber/exporter that walks the span stack (this backend already
/// exports to OTLP) attaches it to every event emitted underneath that span
/// automatically. Never pass a secret key or raw signature as `contract` or
/// through `memo` — this call site logs identifiers only.
fn log_stellar_event(
    status: StellarEventStatus,
    tx_hash: &str,
    contract: &str,
    method: &str,
    user_id: Option<Uuid>,
    amount: i64,
) {
    let status_str = status.as_str();
    match status {
        StellarEventStatus::Submit | StellarEventStatus::Confirm => {
            tracing::info!(tx_hash, contract, method, ?user_id, amount, status = status_str, "Stellar transaction event");
        }
        StellarEventStatus::Retry => {
            tracing::warn!(tx_hash, contract, method, ?user_id, amount, status = status_str, "Stellar transaction retry");
        }
        StellarEventStatus::Dlq => {
            tracing::error!(tx_hash, contract, method, ?user_id, amount, status = status_str, "Stellar transaction moved to dead-letter queue");
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum StellarEventStatus {
    Submit,
    Confirm,
    Retry,
    Dlq,
}

impl StellarEventStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Submit => "submit",
            Self::Confirm => "confirm",
            Self::Retry => "retry",
            Self::Dlq => "dlq",
        }
    }
}

#[derive(Clone)]
pub struct StellarService {
    db_pool: DbPool,
    redis_client: Option<Arc<RedisClient>>,
    horizon_url: String,
    network_passphrase: String,
    admin_secret: Option<String>,
    http_client: reqwest::Client,
    /// Shared across clones so every handler sees the same Horizon health.
    horizon_breaker: Arc<HorizonCircuitBreaker>,
}

impl StellarService {
    pub fn new(
        db_pool: DbPool,
        redis_client: Option<Arc<RedisClient>>,
        horizon_url: String,
        network_passphrase: String,
        admin_secret: Option<String>,
    ) -> Self {
        Self {
            db_pool,
            redis_client,
            horizon_url,
            network_passphrase,
            admin_secret,
            http_client: reqwest::Client::builder()
                .timeout(HORIZON_REQUEST_TIMEOUT)
                .build()
                .unwrap_or_default(),
            horizon_breaker: Arc::new(HorizonCircuitBreaker::new(HorizonBreakerConfig::from_env())),
        }
    }

    /// Replace the Horizon circuit breaker (e.g. to share one across services
    /// or inject a test clock).
    pub fn with_horizon_breaker(mut self, breaker: Arc<HorizonCircuitBreaker>) -> Self {
        self.horizon_breaker = breaker;
        self
    }

    pub fn horizon_breaker(&self) -> &Arc<HorizonCircuitBreaker> {
        &self.horizon_breaker
    }

    /// Current Horizon circuit breaker state for `/health/stellar`.
    pub fn horizon_health(&self) -> BreakerSnapshot {
        self.horizon_breaker.snapshot()
    }

    // ========================================================================
    // HORIZON ACCESS (circuit-breaker guarded, Issue #1346)
    // ========================================================================

    /// `GET` a Horizon URL through the circuit breaker.
    ///
    /// Transport errors, timeouts, 5xx and 429 count as Horizon failures; any
    /// other response (including 404) is returned to the caller and counts as
    /// a healthy Horizon. While the breaker is open the request is not sent
    /// and [`StellarError::HorizonUnavailable`] is returned instead.
    async fn horizon_get(&self, url: &str) -> Result<reqwest::Response, StellarError> {
        let client = &self.http_client;
        let result = self
            .horizon_breaker
            .call(
                |_: &HorizonHttpError| true,
                || async {
                    let response = client
                        .get(url)
                        .send()
                        .await
                        .map_err(|e| HorizonHttpError::Transport(e.to_string()))?;
                    if is_horizon_outage_status(response.status()) {
                        return Err(HorizonHttpError::Status(response.status()));
                    }
                    Ok(response)
                },
            )
            .await;

        match result {
            Ok(response) => Ok(response),
            Err(HorizonCallError::Open(open)) => Err(StellarError::HorizonUnavailable {
                retry_after_secs: open.retry_after_secs,
            }),
            Err(HorizonCallError::Inner(e)) => Err(StellarError::HorizonError(e.to_string())),
        }
    }

    /// Probe Horizon's root endpoint through the breaker.
    ///
    /// While half-open this doubles as the recovery probe, so the breaker can
    /// close again even when no user traffic is hitting Stellar endpoints.
    pub async fn probe_horizon(&self) -> bool {
        self.horizon_get(self.horizon_url.trim_end_matches('/'))
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
    }

    /// Whether `/health/stellar` should send a probe: only once the open
    /// cool-down has elapsed, so health checks never hammer a down Horizon.
    pub fn horizon_wants_probe(&self) -> bool {
        self.horizon_breaker.state() == BreakerState::HalfOpen
    }

    // ========================================================================
    // ACCOUNT MANAGEMENT
    // ========================================================================

    /// Create a new Stellar account for a user
    pub async fn create_stellar_account(
        &self,
        user_id: Uuid,
        account_type: &str,
    ) -> Result<StellarAccount, StellarError> {
        // Generate a new Stellar keypair
        let (public_key, secret_key) = self.generate_keypair()?;

        // Encrypt the secret key before storing
        let encrypted_secret = self.encrypt_secret_key(&secret_key)?;

        // Store in database
        let account = sqlx::query_as!(
            StellarAccount,
            r#"
            INSERT INTO stellar_accounts (
                id, user_id, public_key, encrypted_secret_key, account_type,
                is_funded, is_active, balance_xlm, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
            "#,
            Uuid::new_v4(),
            user_id,
            public_key,
            Some(encrypted_secret),
            account_type,
            false,
            true,
            0i64,
            Utc::now(),
            Utc::now()
        )
        .fetch_one(&*self.db_pool)
        .await?;

        tracing::info!(
            "Created Stellar account {} for user {}",
            public_key,
            user_id
        );

        Ok(account)
    }

    /// Get Stellar account by user ID
    pub async fn get_account(&self, user_id: Uuid) -> Result<StellarAccount, StellarError> {
        let account = sqlx::query_as!(
            StellarAccount,
            r#"
            SELECT * FROM stellar_accounts
            WHERE user_id = $1 AND is_active = true
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            user_id
        )
        .fetch_optional(&*self.db_pool)
        .await?;

        account.ok_or(StellarError::AccountNotFound)
    }

    /// Get Stellar account by public key
    pub async fn get_account_by_public_key(
        &self,
        public_key: &str,
    ) -> Result<StellarAccount, StellarError> {
        let account = sqlx::query_as!(
            StellarAccount,
            r#"
            SELECT * FROM stellar_accounts
            WHERE public_key = $1
            "#,
            public_key
        )
        .fetch_optional(&*self.db_pool)
        .await?;

        account.ok_or(StellarError::AccountNotFound)
    }

    /// Fund a Stellar account.
    ///
    /// On testnet (`horizon_url` contains "testnet"), uses Friendbot to fund
    /// the account for free.  On mainnet, this method returns an error asking
    /// the caller to fund the account from the admin key via Horizon — the
    /// actual payment-operation submission is handled by the admin flow.
    pub async fn fund_account(
        &self,
        public_key: &str,
        amount: i64,
    ) -> Result<String, StellarError> {
        tracing::info!("Funding account {} with {} stroops", public_key, amount);

        let tx_hash = if self.horizon_url.contains("testnet") {
            // ----------------------------------------------------------------
            // Testnet: use Friendbot — no admin key required
            // ----------------------------------------------------------------
            let friendbot_url = format!(
                "https://friendbot.stellar.org?addr={}",
                urlencoding_encode(public_key)
            );
            let client = reqwest::Client::new();
            let response = client
                .get(&friendbot_url)
                .send()
                .await
                .map_err(|e| StellarError::TransactionFailed(e.to_string()))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(StellarError::TransactionFailed(format!(
                    "Friendbot returned {}: {}",
                    status, body
                )));
            }

            let body: serde_json::Value = response
                .json()
                .await
                .map_err(|e| StellarError::TransactionFailed(e.to_string()))?;

            body["hash"]
                .as_str()
                .unwrap_or("friendbot-tx")
                .to_string()
        } else {
            // ----------------------------------------------------------------
            // Mainnet / custom network: the admin must fund the account.
            // Full XDR-signed CreateAccount + Payment ops are outside the
            // scope of this service stub — return an actionable error so the
            // caller knows what to do.
            // ----------------------------------------------------------------
            return Err(StellarError::TransactionFailed(
                "Mainnet account funding requires submitting a CreateAccount \
                 operation from the admin account via Horizon. \
                 Ensure STELLAR_ADMIN_SECRET is set and implement the \
                 XDR transaction builder."
                    .to_string(),
            ));
        };

        // Mark account as funded in the database
        sqlx::query!(
            r#"
            UPDATE stellar_accounts
            SET is_funded = true, balance_xlm = $1, updated_at = $2
            WHERE public_key = $3
            "#,
            amount,
            Utc::now(),
            public_key
        )
        .execute(&*self.db_pool)
        .await?;

        Ok(tx_hash)
    }

    /// Update account balance
    pub async fn update_account_balance(
        &self,
        public_key: &str,
        balance_xlm: i64,
    ) -> Result<(), StellarError> {
        sqlx::query!(
            r#"
            UPDATE stellar_accounts
            SET balance_xlm = $1, updated_at = $2
            WHERE public_key = $3
            "#,
            balance_xlm,
            Utc::now(),
            public_key
        )
        .execute(&*self.db_pool)
        .await?;

        Ok(())
    }

    // ========================================================================
    // PRIZE POOL OPERATIONS
    // ========================================================================

    /// Create a prize pool account for a tournament
    pub async fn create_prize_pool_account(&self) -> Result<String, StellarError> {
        let tournament_id = Uuid::new_v4(); // This should be passed as parameter in real implementation

        // Create a new Stellar account for the prize pool
        let account = self
            .create_stellar_account(tournament_id, "prize_pool")
            .await?;

        // Fund the account with minimum balance (2 XLM in stroops)
        let min_balance = 20_000_000; // 2 XLM
        self.fund_account(&account.public_key, min_balance).await?;

        Ok(account.public_key)
    }

    /// Escrow entry fees to prize pool
    pub async fn escrow_entry_fees(
        &self,
        tournament_id: Uuid,
        prize_pool_account: &str,
        amount: i64,
    ) -> Result<String, StellarError> {
        let admin_secret = self.admin_secret.as_deref().ok_or_else(|| {
            StellarError::TransactionFailed("STELLAR_ADMIN_SECRET not configured".to_string())
        })?;
        let sdk = self.sdk_service()?;
        let envelope = sdk
            .build_payment_tx(admin_secret, prize_pool_account, amount)
            .await
            .map_err(|e| StellarError::StellarSdkError(e.to_string()))?;
        let (tx_hash, _) = sdk
            .submit_and_confirm(&envelope, admin_secret)
            .await
            .map_err(|e| StellarError::TransactionFailed(e.to_string()))?;

        // The source account must be identified by its *public* key — never
        // the admin secret itself, which must never appear in a log line,
        // a memo, or a stored DB column (#1106).
        let admin_public = self
            .admin_secret
            .as_deref()
            .map(stellar_public_from_secret)
            .transpose()
            .map_err(StellarError::StellarSdkError)?
            .unwrap_or_else(|| "admin".to_string());

        log_stellar_event(
            StellarEventStatus::Submit,
            &tx_hash,
            "native",
            "escrow_entry_fees",
            None,
            amount,
        );

        // Record transaction
        let recorded = self.record_transaction(
            &tx_hash,
            &admin_public,
            prize_pool_account,
            amount,
            "XLM",
            None,
            "payment",
            Some(format!("Entry fee escrow for tournament {}", tournament_id)),
            None,
        )
        .await?;
        sqlx::query(
            r#"UPDATE stellar_transactions
               SET status = 'confirmed', completed_at = $1
               WHERE transaction_hash = $2"#,
        )
        .bind(Utc::now())
        .bind(&tx_hash)
        .execute(&*self.db_pool)
        .await?;

        log_stellar_event(
            StellarEventStatus::Confirm,
            &tx_hash,
            "native",
            "escrow_entry_fees",
            None,
            amount,
        );

        Ok(tx_hash)
    }

    /// Distribute prizes to winners
    pub async fn distribute_prizes(
        &self,
        tournament_id: Uuid,
        prize_pool_account: &str,
        winners: Vec<(Uuid, i64)>, // (user_id, amount)
    ) -> Result<Vec<String>, StellarError> {
        let mut transaction_hashes = Vec::new();

        for (user_id, amount) in winners {
            let user_account = self.get_account(user_id).await?;
            let pool_account = self
                .get_account_by_public_key(prize_pool_account)
                .await?;
            let pool_secret = pool_account
                .encrypted_secret_key
                .as_deref()
                .ok_or(StellarError::InvalidPublicKey)
                .and_then(|encrypted| self.decrypt_secret_key(encrypted))?;
            let sdk = self.sdk_service()?;
            let envelope = sdk
                .build_payment_tx(&pool_secret, &user_account.public_key, amount)
                .await
                .map_err(|e| StellarError::StellarSdkError(e.to_string()))?;
            let (tx_hash, _) = sdk
                .submit_and_confirm(&envelope, &pool_secret)
                .await
                .map_err(|e| StellarError::TransactionFailed(e.to_string()))?;

            log_stellar_event(
                StellarEventStatus::Submit,
                &tx_hash,
                "native",
                "distribute_prizes",
                Some(user_id),
                amount,
            );

            // Record transaction
            let recorded = self.record_transaction(
                &tx_hash,
                prize_pool_account,
                &user_account.public_key,
                amount,
                "XLM",
                None,
                "payment",
                Some(format!(
                    "Prize distribution for tournament {}",
                    tournament_id
                )),
                Some(user_id),
            )
            .await?;
            sqlx::query(
                r#"UPDATE stellar_transactions
                   SET status = 'confirmed', completed_at = $1
                   WHERE id = $2"#,
            )
            .bind(Utc::now())
            .bind(recorded.id)
            .execute(&*self.db_pool)
            .await?;

            log_stellar_event(
                StellarEventStatus::Confirm,
                &tx_hash,
                "native",
                "distribute_prizes",
                Some(user_id),
                amount,
            );

            transaction_hashes.push(tx_hash);
        }

        Ok(transaction_hashes)
    }

    // ========================================================================
    // TOKEN OPERATIONS
    // ========================================================================

    /// Issue ArenaX token (one-time setup)
    pub async fn issue_arenax_token(&self) -> Result<(), StellarError> {
        let issuer_secret = self.admin_secret.as_deref().ok_or_else(|| {
            StellarError::TransactionFailed("ArenaX token issuer secret not configured".to_string())
        })?;
        stellar_public_from_secret(issuer_secret)
            .map_err(|e| StellarError::StellarSdkError(e))?;
        Err(StellarError::TransactionFailed(
            "ArenaX token issuance requires explicit issuer/distribution setup and trustlines"
                .to_string(),
        ))
    }

    /// Transfer ArenaX tokens between accounts
    pub async fn transfer_tokens(
        &self,
        from_user_id: Uuid,
        to_public_key: &str,
        amount: i64,
    ) -> Result<String, StellarError> {
        let from_account = self.get_account(from_user_id).await?;
        let issuer_secret = self.admin_secret.clone().ok_or_else(|| {
            StellarError::TransactionFailed("ArenaX token issuer secret not configured".to_string())
        })?;
        let issuer_public = std::env::var("STELLAR_ARENAX_ISSUER")
            .ok()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| stellar_public_from_secret(&issuer_secret).unwrap_or_default());
        if issuer_public.is_empty() {
            return Err(StellarError::TransactionFailed(
                "ArenaX token issuer public key could not be derived".to_string(),
            ));
        }

        let sdk = self.sdk_service()?;
        let envelope = sdk
            .build_asset_issue_tx(&issuer_secret, "ARENAX", to_public_key, amount)
            .await
            .map_err(|e| StellarError::StellarSdkError(e.to_string()))?;
        let (tx_hash, _) = sdk
            .submit_and_confirm(&envelope, &issuer_secret)
            .await
            .map_err(|e| StellarError::TransactionFailed(e.to_string()))?;

        log_stellar_event(
            StellarEventStatus::Submit,
            &tx_hash,
            "ARENAX",
            "transfer_tokens",
            Some(from_user_id),
            amount,
        );

        // Record transaction
        let recorded = self.record_transaction(
            &tx_hash,
            &from_account.public_key,
            to_public_key,
            amount,
            "ARENAX",
            Some(&issuer_public),
            "payment",
            Some("ArenaX token transfer".to_string()),
            Some(from_user_id),
        )
        .await?;
        sqlx::query(
            r#"UPDATE stellar_transactions
               SET status = 'confirmed', completed_at = $1
               WHERE id = $2"#,
        )
        .bind(Utc::now())
        .bind(recorded.id)
        .execute(&*self.db_pool)
        .await?;

        log_stellar_event(
            StellarEventStatus::Confirm,
            &tx_hash,
            "ARENAX",
            "transfer_tokens",
            Some(from_user_id),
            amount,
        );

        Ok(tx_hash)
    }

    // ========================================================================
    // TRANSACTION TRACKING
    // ========================================================================

    /// Record a Stellar transaction in the database
    pub async fn record_transaction(
        &self,
        tx_hash: &str,
        source_account: &str,
        destination_account: &str,
        amount: i64,
        asset_code: &str,
        asset_issuer: Option<&str>,
        operation_type: &str,
        memo: Option<String>,
        user_id: Option<Uuid>,
    ) -> Result<StellarTransaction, StellarError> {
        let transaction = sqlx::query_as!(
            StellarTransaction,
            r#"
            INSERT INTO stellar_transactions (
                id, user_id, transaction_hash, source_account, destination_account,
                amount, asset_code, asset_issuer, operation_type, memo,
                status, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
            "#,
            Uuid::new_v4(),
            user_id,
            tx_hash,
            source_account,
            destination_account,
            amount,
            asset_code,
            asset_issuer,
            operation_type,
            memo,
            "pending",
            Utc::now()
        )
        .fetch_one(&*self.db_pool)
        .await?;

        Ok(transaction)
    }

    /// Verify a Stellar transaction on the network
    ///
    /// Queries Horizon's `/transactions/{hash}` through the circuit breaker:
    /// a successful transaction yields `true`, an unknown or failed one
    /// `false`. Horizon outages surface as [`StellarError::HorizonError`] /
    /// [`StellarError::HorizonUnavailable`] (HTTP 503) rather than a guess.
    pub async fn verify_transaction(&self, tx_hash: &str) -> Result<bool, StellarError> {
        let url = format!(
            "{}/transactions/{}",
            self.horizon_url.trim_end_matches('/'),
            urlencoding_encode(tx_hash)
        );
        let response = self.horizon_get(&url).await?;

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(false);
        }
        if !status.is_success() {
            return Err(StellarError::TransactionFailed(format!(
                "Horizon returned {} for transaction {}",
                status, tx_hash
            )));
        }

        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|e| StellarError::HorizonError(e.to_string()))?;
        Ok(body["successful"].as_bool().unwrap_or(false))
    }

    /// Get transaction by hash
    pub async fn get_transaction(&self, tx_hash: &str) -> Result<StellarTransaction, StellarError> {
        let transaction = sqlx::query_as!(
            StellarTransaction,
            r#"
            SELECT * FROM stellar_transactions
            WHERE transaction_hash = $1
            "#,
            tx_hash
        )
        .fetch_optional(&*self.db_pool)
        .await?;

        transaction.ok_or(StellarError::TransactionFailed(
            "Transaction not found".to_string(),
        ))
    }

    /// List every prize-pool transaction (entry fee escrows and prize
    /// distributions) recorded for a tournament, newest first.
    pub async fn get_tournament_prize_pool_transactions(
        &self,
        tournament_id: Uuid,
    ) -> Result<Vec<StellarTransaction>, StellarError> {
        let transactions = sqlx::query_as::<_, StellarTransaction>(
            r#"
            SELECT * FROM stellar_transactions
            WHERE memo IN ($1, $2)
            ORDER BY created_at DESC
            "#,
        )
        .bind(format!("Entry fee escrow for tournament {}", tournament_id))
        .bind(format!("Prize distribution for tournament {}", tournament_id))
        .fetch_all(&*self.db_pool)
        .await?;

        Ok(transactions)
    }

    /// Public Stellar explorer link for a transaction on the configured network.
    pub fn explorer_url(&self, tx_hash: &str) -> String {
        let network = if self.network_passphrase.contains("Public Global") {
            "public"
        } else {
            "testnet"
        };
        format!("https://stellar.expert/explorer/{}/tx/{}", network, tx_hash)
    }

    // ========================================================================
    // HELPER FUNCTIONS
    // ========================================================================

    /// Generate a new Stellar keypair using ed25519-dalek.
    ///
    /// Returns `(public_key_strkey, secret_key_strkey)` in standard Stellar
    /// StrKey encoding (public key starts with `G`, secret key starts with `S`).
    fn generate_keypair(&self) -> Result<(String, String), StellarError> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key: VerifyingKey = signing_key.verifying_key();

        let public_key = stellar_strkey_encode(6 << 3, verifying_key.as_bytes())
            .map_err(|e| StellarError::StellarSdkError(e))?;
        let secret_key = stellar_strkey_encode(18 << 3, signing_key.as_bytes())
            .map_err(|e| StellarError::StellarSdkError(e))?;

        Ok((public_key, secret_key))
    }

    fn sdk_service(&self) -> Result<StellarSdkService, StellarError> {
        if self.horizon_url.contains("testnet") {
            StellarSdkService::testnet(&self.horizon_url)
        } else {
            StellarSdkService::public(&self.horizon_url)
        }
        .map_err(|e| StellarError::StellarSdkError(e.to_string()))
    }

    /// Encrypt a secret key with the application-wide AES-256-GCM protector.
    fn encrypt_secret_key(&self, secret_key: &str) -> Result<String, StellarError> {
        PiiDataProtector::from_env_or_default()
            .encrypt_str(secret_key, "stellar.secret_key", None)
            .map_err(|e| StellarError::StellarSdkError(e.to_string()))
    }

    /// Decrypt an encrypted secret key from storage.
    fn decrypt_secret_key(&self, encrypted: &str) -> Result<String, StellarError> {
        if encrypted.starts_with("enc:") {
            return PiiDataProtector::from_env_or_default()
                .decrypt_str(encrypted, "stellar.secret_key", None)
                .map_err(|_| StellarError::InvalidPublicKey);
        }

        // Backward compatibility for secrets created before AES-GCM encryption.
        use base64::{engine::general_purpose, Engine as _};
        general_purpose::STANDARD
            .decode(encrypted)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .ok_or(StellarError::InvalidPublicKey)
    }

    /// Convert XLM to stroops (1 XLM = 10,000,000 stroops)
    pub fn xlm_to_stroops(xlm: f64) -> i64 {
        (xlm * 10_000_000.0) as i64
    }

    /// Convert stroops to XLM
    pub fn stroops_to_xlm(stroops: i64) -> f64 {
        stroops as f64 / 10_000_000.0
    }

    /// Unique deposit memo for a user (#1432).
    pub fn user_deposit_memo(&self, user_id: Uuid) -> String {
        get_user_deposit_memo(user_id)
    }

    /// Parse user ID from deposit memo (#1432).
    pub fn parse_memo(&self, memo: &str) -> Option<Uuid> {
        parse_deposit_memo(memo)
    }
}

/// Generate a unique deposit memo for a user (#1432).
pub fn get_user_deposit_memo(user_id: Uuid) -> String {
    user_id.to_string()
}

/// Parse a user ID from a deposit transaction memo (#1432).
pub fn parse_deposit_memo(memo: &str) -> Option<Uuid> {
    let trimmed = memo.trim();
    if trimmed.is_empty() {
        return None;
    }
    Uuid::parse_str(trimmed).ok()
}

// ============================================================================
// Stellar StrKey encoding (RFC 4648 base32, no external dependency required)
// ============================================================================

/// Encode a raw 32-byte key as a Stellar StrKey.
///
/// `version_byte`:
///   - `6 << 3`  (= 0x30)  → public key  → starts with `G`
///   - `18 << 3` (= 0x90)  → secret key  → starts with `S`
///
/// The format is: base32( version_byte || payload || crc16(version_byte || payload) )
pub fn stellar_strkey_encode(version_byte: u8, payload: &[u8]) -> Result<String, String> {
    if payload.len() != 32 {
        return Err(format!(
            "stellar_strkey_encode: expected 32-byte payload, got {}",
            payload.len()
        ));
    }

    // Build the data to checksum: version_byte || payload
    let mut data = Vec::with_capacity(1 + payload.len());
    data.push(version_byte);
    data.extend_from_slice(payload);

    // CRC-16/XMODEM (initial value 0x0000, poly 0x1021, no reflection)
    let checksum = crc16_xmodem(&data);
    data.push((checksum & 0xFF) as u8);     // little-endian
    data.push((checksum >> 8) as u8);

    Ok(base32_encode(&data))
}

/// Decode a Stellar StrKey back to (version_byte, payload).
/// Returns an error if the checksum does not match.
pub fn stellar_strkey_decode(encoded: &str) -> Result<(u8, Vec<u8>), String> {
    let data = base32_decode(encoded)?;
    if data.len() < 3 {
        return Err("stellar_strkey_decode: encoded value too short".to_string());
    }

    let (payload_with_version, checksum_bytes) = data.split_at(data.len() - 2);
    let expected = crc16_xmodem(payload_with_version);
    let actual = (checksum_bytes[0] as u16) | ((checksum_bytes[1] as u16) << 8);
    if expected != actual {
        return Err(format!(
            "stellar_strkey_decode: checksum mismatch (expected {:#06x}, got {:#06x})",
            expected, actual
        ));
    }

    let version = payload_with_version[0];
    let payload = payload_with_version[1..].to_vec();
    Ok((version, payload))
}

/// Derive the Stellar public key StrKey from a secret key StrKey.
///
/// Decodes the ed25519 seed from the secret key, derives the verifying key,
/// and re-encodes it as a Stellar public key.
pub fn stellar_public_from_secret(secret_strkey: &str) -> Result<String, String> {
    let (version, seed_bytes) = stellar_strkey_decode(secret_strkey)?;
    if version != 18 << 3 {
        return Err(format!(
            "stellar_public_from_secret: expected secret key version {:#04x}, got {:#04x}",
            18u8 << 3,
            version
        ));
    }
    let seed: [u8; 32] = seed_bytes.try_into().map_err(|_| {
        "stellar_public_from_secret: seed must be 32 bytes".to_string()
    })?;
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&seed);
    let verifying_key = signing_key.verifying_key();
    stellar_strkey_encode(6 << 3, verifying_key.as_bytes())
}

// ============================================================================
// Base32 (RFC 4648, uppercase, no padding) — used by Stellar StrKey
// ============================================================================

const BASE32_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

fn base32_encode(data: &[u8]) -> String {
    let mut output = String::new();
    let mut buffer: u64 = 0;
    let mut bits_in_buffer: u32 = 0;

    for &byte in data {
        buffer = (buffer << 8) | (byte as u64);
        bits_in_buffer += 8;
        while bits_in_buffer >= 5 {
            bits_in_buffer -= 5;
            let index = ((buffer >> bits_in_buffer) & 0x1F) as usize;
            output.push(BASE32_ALPHABET[index] as char);
        }
    }
    // Remaining bits (left-aligned)
    if bits_in_buffer > 0 {
        let index = ((buffer << (5 - bits_in_buffer)) & 0x1F) as usize;
        output.push(BASE32_ALPHABET[index] as char);
    }
    output
}

fn base32_decode(encoded: &str) -> Result<Vec<u8>, String> {
    let mut buffer: u64 = 0;
    let mut bits_in_buffer: u32 = 0;
    let mut output = Vec::new();

    for ch in encoded.chars() {
        if ch == '=' {
            break; // ignore padding
        }
        let value = BASE32_ALPHABET
            .iter()
            .position(|&c| c == ch as u8)
            .ok_or_else(|| format!("base32_decode: invalid character '{}'", ch))?;
        buffer = (buffer << 5) | (value as u64);
        bits_in_buffer += 5;
        if bits_in_buffer >= 8 {
            bits_in_buffer -= 8;
            output.push((buffer >> bits_in_buffer) as u8 & 0xFF);
        }
    }
    Ok(output)
}

// ============================================================================
// CRC-16/XMODEM (poly 0x1021, initial value 0x0000, no input/output reflection)
// ============================================================================

fn crc16_xmodem(data: &[u8]) -> u16 {
    let mut crc: u16 = 0x0000;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

// ============================================================================
// Minimal percent-encoding for the public key in Friendbot URLs
// ============================================================================

fn urlencoding_encode(input: &str) -> String {
    let mut encoded = String::new();
    for byte in input.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{:02X}", byte));
        }
    }
    encoded
}

#[cfg(test)]
mod stellar_strkey_tests {
    use super::*;

    #[test]
    fn test_keypair_generates_valid_strkeys() {
        // Public key must start with 'G' and be 56 chars
        // Secret key must start with 'S' and be 56 chars
        let signing_key = ed25519_dalek::SigningKey::generate(&mut rand::rngs::OsRng);
        let verifying_key = signing_key.verifying_key();

        let pub_strkey = stellar_strkey_encode(6 << 3, verifying_key.as_bytes()).unwrap();
        let sec_strkey = stellar_strkey_encode(18 << 3, signing_key.as_bytes()).unwrap();

        assert_eq!(pub_strkey.len(), 56, "public key strkey must be 56 chars");
        assert!(pub_strkey.starts_with('G'), "public key must start with G");
        assert_eq!(sec_strkey.len(), 56, "secret key strkey must be 56 chars");
        assert!(sec_strkey.starts_with('S'), "secret key must start with S");
    }

    #[test]
    fn test_public_from_secret_roundtrip() {
        let signing_key = ed25519_dalek::SigningKey::generate(&mut rand::rngs::OsRng);
        let verifying_key = signing_key.verifying_key();

        let sec_strkey = stellar_strkey_encode(18 << 3, signing_key.as_bytes()).unwrap();
        let pub_strkey_direct = stellar_strkey_encode(6 << 3, verifying_key.as_bytes()).unwrap();
        let pub_strkey_derived = stellar_public_from_secret(&sec_strkey).unwrap();

        assert_eq!(
            pub_strkey_direct, pub_strkey_derived,
            "derived public key must match directly encoded public key"
        );
    }

    #[test]
    fn test_decode_roundtrip() {
        let payload = [0xABu8; 32];
        let encoded = stellar_strkey_encode(6 << 3, &payload).unwrap();
        let (version, decoded_payload) = stellar_strkey_decode(&encoded).unwrap();
        assert_eq!(version, 6 << 3);
        assert_eq!(decoded_payload, payload);
    }
}

/// Integration test for structured Stellar transaction logging (#1106):
/// installs a minimal capturing `tracing::Subscriber` (no extra dependency —
/// `tracing-test`/JSON formatting aren't in this crate's deps), submits a
/// transaction event, and asserts the required fields are present in the
/// captured record, mirroring "grep structured logs" against real output.
#[cfg(test)]
mod stellar_logging_tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tracing::field::{Field, Visit};
    use tracing::span::{Attributes, Id, Record};
    use tracing::{Event, Metadata, Subscriber};

    #[derive(Default, Clone)]
    struct CapturedEvent {
        level: tracing::Level,
        message: String,
        fields: std::collections::HashMap<String, String>,
    }

    struct FieldCollector<'a>(&'a mut CapturedEvent);

    impl<'a> Visit for FieldCollector<'a> {
        fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
            let formatted = format!("{value:?}");
            if field.name() == "message" {
                self.0.message = formatted.trim_matches('"').to_string();
            } else {
                self.0.fields.insert(field.name().to_string(), formatted.trim_matches('"').to_string());
            }
        }
    }

    struct CapturingSubscriber {
        events: Arc<Mutex<Vec<CapturedEvent>>>,
    }

    impl Subscriber for CapturingSubscriber {
        fn enabled(&self, _metadata: &Metadata<'_>) -> bool {
            true
        }
        fn new_span(&self, _span: &Attributes<'_>) -> Id {
            Id::from_u64(1)
        }
        fn record(&self, _span: &Id, _values: &Record<'_>) {}
        fn record_follows_from(&self, _span: &Id, _follows: &Id) {}
        fn event(&self, event: &Event<'_>) {
            let mut captured = CapturedEvent {
                level: *event.metadata().level(),
                ..Default::default()
            };
            event.record(&mut FieldCollector(&mut captured));
            self.events.lock().unwrap().push(captured);
        }
        fn enter(&self, _span: &Id) {}
        fn exit(&self, _span: &Id) {}
    }

    #[test]
    fn submit_and_confirm_events_carry_all_required_fields() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let subscriber = CapturingSubscriber { events: events.clone() };

        tracing::subscriber::with_default(subscriber, || {
            log_stellar_event(
                StellarEventStatus::Submit,
                "test-tx-hash-123",
                "native",
                "escrow_entry_fees",
                None,
                5_000_000,
            );
            log_stellar_event(
                StellarEventStatus::Confirm,
                "test-tx-hash-123",
                "native",
                "escrow_entry_fees",
                None,
                5_000_000,
            );
        });

        let captured = events.lock().unwrap();
        assert_eq!(captured.len(), 2, "expected one SUBMIT and one CONFIRM event");

        for (event, expected_status) in captured.iter().zip(["submit", "confirm"]) {
            assert_eq!(event.level, tracing::Level::INFO);
            assert_eq!(event.fields.get("tx_hash").map(String::as_str), Some("test-tx-hash-123"));
            assert_eq!(event.fields.get("contract").map(String::as_str), Some("native"));
            assert_eq!(event.fields.get("method").map(String::as_str), Some("escrow_entry_fees"));
            assert_eq!(event.fields.get("amount").map(String::as_str), Some("5000000"));
            assert_eq!(event.fields.get("status").map(String::as_str), Some(expected_status));
        }
    }

    #[test]
    fn retry_and_dlq_events_use_warn_and_error_levels() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let subscriber = CapturingSubscriber { events: events.clone() };

        tracing::subscriber::with_default(subscriber, || {
            log_stellar_event(StellarEventStatus::Retry, "tx-2", "ARENAX", "transfer_tokens", None, 100);
            log_stellar_event(StellarEventStatus::Dlq, "tx-2", "ARENAX", "transfer_tokens", None, 100);
        });

        let captured = events.lock().unwrap();
        assert_eq!(captured[0].level, tracing::Level::WARN);
        assert_eq!(captured[0].fields.get("status").map(String::as_str), Some("retry"));
        assert_eq!(captured[1].level, tracing::Level::ERROR);
        assert_eq!(captured[1].fields.get("status").map(String::as_str), Some("dlq"));
    }

    #[test]
    fn user_id_is_included_when_present() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let subscriber = CapturingSubscriber { events: events.clone() };
        let user_id = Uuid::new_v4();

        tracing::subscriber::with_default(subscriber, || {
            log_stellar_event(StellarEventStatus::Confirm, "tx-3", "native", "distribute_prizes", Some(user_id), 42);
        });

        let captured = events.lock().unwrap();
        assert!(captured[0].fields.get("user_id").unwrap().contains(&user_id.to_string()));
    }
}
