use crate::models::{
    Transaction, TransactionResponse, TransactionStatus, TransactionType, Wallet, WalletResponse,
};
use anyhow::Result;
use chrono::Utc;
// EventBus is used via crate::realtime::event_bus::EventBus
use reqwest::{Client, Url};
use rust_decimal::Decimal;
use serde::{de::DeserializeOwned, Deserialize};
use sqlx::PgPool;
use std::{env, sync::Arc, time::Duration};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum WalletError {
    #[error("Wallet not found for user")]
    WalletNotFound,
    #[error("Insufficient balance: required {required}, available {available}")]
    InsufficientBalance { required: i64, available: i64 },
    #[error("Invalid amount: {0}")]
    InvalidAmount(String),
    #[error("Transaction not found")]
    TransactionNotFound,
    #[error("Payment verification failed")]
    PaymentVerificationFailed,
    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),
    #[error("Redis error: {0}")]
    RedisError(String),
}

pub type DbPool = Arc<PgPool>;

const PAYSTACK_BASE_URL: &str = "https://api.paystack.co";
const FLUTTERWAVE_BASE_URL: &str = "https://api.flutterwave.com/v3";
const PAYMENT_PROVIDER_TIMEOUT_SECS: u64 = 5;

#[derive(Debug, Deserialize)]
struct PaystackVerificationResponse {
    status: bool,
    message: Option<String>,
    data: Option<PaystackTransactionData>,
}

#[derive(Debug, Deserialize)]
struct PaystackTransactionData {
    status: String,
    reference: Option<String>,
    amount: i64,
    currency: Option<String>,
    paid_at: Option<String>,
    gateway_response: Option<String>,
    refund_status: Option<String>,
    amount_refunded: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct FlutterwaveVerificationResponse {
    status: String,
    message: Option<String>,
    data: Option<FlutterwaveTransactionData>,
}

#[derive(Debug, Deserialize)]
struct FlutterwaveTransactionData {
    tx_ref: Option<String>,
    flw_ref: Option<String>,
    amount: Option<f64>,
    charged_amount: Option<f64>,
    currency: Option<String>,
    status: Option<String>,
    created_at: Option<String>,
    charge_response_message: Option<String>,
    refund_status: Option<String>,
    amount_refunded: Option<f64>,
}

#[derive(Clone)]
pub struct WalletService {
    db_pool: DbPool,
    event_bus: Option<crate::realtime::event_bus::EventBus>,
}

impl WalletService {
    pub fn new(db_pool: DbPool, event_bus: Option<crate::realtime::event_bus::EventBus>) -> Self {
        Self {
            db_pool,
            event_bus,
        }
    }

    // ========================================================================
    // CORE WALLET OPERATIONS
    // ========================================================================

    /// Get wallet for a user
    pub async fn get_wallet(&self, user_id: Uuid) -> Result<Wallet, WalletError> {
        let wallet = sqlx::query_as!(
            Wallet,
            r#"
            SELECT * FROM wallets
            WHERE user_id = $1
            "#,
            user_id
        )
        .fetch_optional(&*self.db_pool)
        .await?;

        wallet.ok_or(WalletError::WalletNotFound)
    }

    /// Get wallet or create if doesn't exist
    pub async fn get_or_create_wallet(&self, user_id: Uuid) -> Result<Wallet, WalletError> {
        match self.get_wallet(user_id).await {
            Ok(wallet) => Ok(wallet),
            Err(WalletError::WalletNotFound) => self.create_wallet(user_id).await,
            Err(e) => Err(e),
        }
    }

    /// Create a new wallet for a user
    pub async fn create_wallet(&self, user_id: Uuid) -> Result<Wallet, WalletError> {
        let wallet = sqlx::query_as!(
            Wallet,
            r#"
            INSERT INTO wallets (
                id, user_id, balance, escrow_balance, currency,
                balance_ngn, balance_arenax_tokens, balance_xlm,
                is_active, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
            "#,
            Uuid::new_v4(),
            user_id,
            Decimal::ZERO,
            Decimal::ZERO,
            "NGN",
            0i64, // balance_ngn
            0i64, // balance_arenax_tokens
            0i64, // balance_xlm
            true,
            Utc::now(),
            Utc::now()
        )
        .fetch_one(&*self.db_pool)
        .await?;

        Ok(wallet)
    }

    /// Add fiat balance (in kobo for NGN)
    pub async fn add_fiat_balance(&self, user_id: Uuid, amount: i64) -> Result<(), WalletError> {
        if amount <= 0 {
            return Err(WalletError::InvalidAmount(
                "Amount must be positive".to_string(),
            ));
        }

        sqlx::query!(
            r#"
            UPDATE wallets
            SET balance_ngn = balance_ngn + $1, updated_at = $2
            WHERE user_id = $3
            "#,
            amount,
            Utc::now(),
            user_id
        )
        .execute(&*self.db_pool)
        .await?;

        // Publish balance update event
        self.publish_balance_update(user_id).await;

        Ok(())
    }

    /// Deduct fiat balance (in kobo for NGN)
    pub async fn deduct_fiat_balance(&self, user_id: Uuid, amount: i64) -> Result<(), WalletError> {
        if amount <= 0 {
            return Err(WalletError::InvalidAmount(
                "Amount must be positive".to_string(),
            ));
        }

        let wallet = self.get_wallet(user_id).await?;

        if wallet.balance_ngn.unwrap_or(0) < amount {
            return Err(WalletError::InsufficientBalance {
                required: amount,
                available: wallet.balance_ngn.unwrap_or(0),
            });
        }

        sqlx::query!(
            r#"
            UPDATE wallets
            SET balance_ngn = balance_ngn - $1, updated_at = $2
            WHERE user_id = $3
            "#,
            amount,
            Utc::now(),
            user_id
        )
        .execute(&*self.db_pool)
        .await?;

        // Publish balance update event
        self.publish_balance_update(user_id).await;

        Ok(())
    }

    /// Add ArenaX tokens
    pub async fn add_arenax_tokens(&self, user_id: Uuid, amount: i64) -> Result<(), WalletError> {
        if amount <= 0 {
            return Err(WalletError::InvalidAmount(
                "Amount must be positive".to_string(),
            ));
        }

        sqlx::query!(
            r#"
            UPDATE wallets
            SET balance_arenax_tokens = balance_arenax_tokens + $1, updated_at = $2
            WHERE user_id = $3
            "#,
            amount,
            Utc::now(),
            user_id
        )
        .execute(&*self.db_pool)
        .await?;

        // Publish balance update event
        self.publish_balance_update(user_id).await;

        Ok(())
    }

    /// Deduct ArenaX tokens
    pub async fn deduct_arenax_tokens(
        &self,
        user_id: Uuid,
        amount: i64,
    ) -> Result<(), WalletError> {
        if amount <= 0 {
            return Err(WalletError::InvalidAmount(
                "Amount must be positive".to_string(),
            ));
        }

        let wallet = self.get_wallet(user_id).await?;

        if wallet.balance_arenax_tokens.unwrap_or(0) < amount {
            return Err(WalletError::InsufficientBalance {
                required: amount,
                available: wallet.balance_arenax_tokens.unwrap_or(0),
            });
        }

        sqlx::query!(
            r#"
            UPDATE wallets
            SET balance_arenax_tokens = balance_arenax_tokens - $1, updated_at = $2
            WHERE user_id = $3
            "#,
            amount,
            Utc::now(),
            user_id
        )
        .execute(&*self.db_pool)
        .await?;

        // Publish balance update event
        self.publish_balance_update(user_id).await;

        Ok(())
    }

    /// Move balance to escrow
    pub async fn move_to_escrow(&self, user_id: Uuid, amount: i64) -> Result<(), WalletError> {
        if amount <= 0 {
            return Err(WalletError::InvalidAmount(
                "Amount must be positive".to_string(),
            ));
        }

        let wallet = self.get_wallet(user_id).await?;

        if wallet.balance_ngn.unwrap_or(0) < amount {
            return Err(WalletError::InsufficientBalance {
                required: amount,
                available: wallet.balance_ngn.unwrap_or(0),
            });
        }

        sqlx::query!(
            r#"
            UPDATE wallets
            SET balance_ngn = balance_ngn - $1,
                escrow_balance = escrow_balance + $2,
                updated_at = $3
            WHERE user_id = $4
            "#,
            amount,
            Decimal::from(amount),
            Utc::now(),
            user_id
        )
        .execute(&*self.db_pool)
        .await?;

        Ok(())
    }

    /// Release escrow back to balance
    pub async fn release_from_escrow(&self, user_id: Uuid, amount: i64) -> Result<(), WalletError> {
        if amount <= 0 {
            return Err(WalletError::InvalidAmount(
                "Amount must be positive".to_string(),
            ));
        }

        sqlx::query!(
            r#"
            UPDATE wallets
            SET balance_ngn = balance_ngn + $1,
                escrow_balance = escrow_balance - $2,
                updated_at = $3
            WHERE user_id = $4
            "#,
            amount,
            Decimal::from(amount),
            Utc::now(),
            user_id
        )
        .execute(&*self.db_pool)
        .await?;

        Ok(())
    }

    // ========================================================================
    // TRANSACTION MANAGEMENT
    // ========================================================================

    /// Create a transaction record
    pub async fn create_transaction(
        &self,
        user_id: Uuid,
        transaction_type: TransactionType,
        amount: i64,
        currency: String,
        description: String,
        reference: Option<String>,
    ) -> Result<Transaction, WalletError> {
        let reference = reference.unwrap_or_else(|| format!("TXN-{}", Uuid::new_v4()));

        let transaction = sqlx::query_as!(
            Transaction,
            r#"
            INSERT INTO transactions (
                id, user_id, transaction_type, amount, currency,
                status, reference, description, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, user_id,
                transaction_type as "transaction_type: TransactionType",
                amount, currency,
                status as "status: TransactionStatus",
                reference, description, metadata,
                stellar_transaction_id, created_at, updated_at, completed_at
            "#,
            Uuid::new_v4(),
            user_id,
            transaction_type as TransactionType,
            Decimal::from(amount),
            currency,
            TransactionStatus::Pending as TransactionStatus,
            reference,
            description,
            Utc::now(),
            Utc::now()
        )
        .fetch_one(&*self.db_pool)
        .await?;

        Ok(transaction)
    }

    /// Update transaction status
    pub async fn update_transaction_status(
        &self,
        transaction_id: Uuid,
        status: TransactionStatus,
    ) -> Result<(), WalletError> {
        let completed_at = if status == TransactionStatus::Completed {
            Some(Utc::now())
        } else {
            None
        };

        sqlx::query!(
            r#"
            UPDATE transactions
            SET status = $1, completed_at = $2, updated_at = $3
            WHERE id = $4
            "#,
            status as TransactionStatus,
            completed_at,
            Utc::now(),
            transaction_id
        )
        .execute(&*self.db_pool)
        .await?;

        Ok(())
    }

    /// Get transaction history for a user
    pub async fn get_transaction_history(
        &self,
        user_id: Uuid,
        page: i32,
        per_page: i32,
    ) -> Result<Vec<Transaction>, WalletError> {
        let offset = (page - 1) * per_page;

        let transactions = sqlx::query_as!(
            Transaction,
            r#"
            SELECT id, user_id,
                transaction_type as "transaction_type: TransactionType",
                amount, currency,
                status as "status: TransactionStatus",
                reference, description, metadata,
                stellar_transaction_id, created_at, updated_at, completed_at
            FROM transactions
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
            user_id,
            per_page as i64,
            offset as i64
        )
        .fetch_all(&*self.db_pool)
        .await?;

        Ok(transactions)
    }

    /// Get transaction by reference
    pub async fn get_transaction_by_reference(
        &self,
        reference: &str,
    ) -> Result<Transaction, WalletError> {
        let transaction = sqlx::query_as!(
            Transaction,
            r#"
            SELECT id, user_id,
                transaction_type as "transaction_type: TransactionType",
                amount, currency,
                status as "status: TransactionStatus",
                reference, description, metadata,
                stellar_transaction_id, created_at, updated_at, completed_at
            FROM transactions
            WHERE reference = $1
            "#,
            reference
        )
        .fetch_optional(&*self.db_pool)
        .await?;

        transaction.ok_or(WalletError::TransactionNotFound)
    }

    // ========================================================================
    // PAYMENT VERIFICATION
    // ========================================================================

    fn paystack_base_url() -> String {
        env::var("PAYSTACK_BASE_URL").unwrap_or_else(|_| PAYSTACK_BASE_URL.to_string())
    }

    fn flutterwave_base_url() -> String {
        env::var("FLUTTERWAVE_BASE_URL").unwrap_or_else(|_| FLUTTERWAVE_BASE_URL.to_string())
    }

    fn validate_paystack_reference(reference: &str) -> Result<(), WalletError> {
        let sanitized = reference.trim();
        if sanitized.is_empty() {
            return Err(WalletError::PaymentVerificationFailed);
        }
        if !sanitized
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/'))
        {
            return Err(WalletError::PaymentVerificationFailed);
        }
        Ok(())
    }

    fn validate_flutterwave_reference(reference: &str) -> Result<(), WalletError> {
        let sanitized = reference.trim();
        if sanitized.is_empty() || !sanitized.chars().all(|c| c.is_ascii_digit()) {
            return Err(WalletError::PaymentVerificationFailed);
        }
        Ok(())
    }

    async fn fetch_provider_json<T>(&self, url: Url, secret_key: &str) -> Result<T, WalletError>
    where
        T: DeserializeOwned,
    {
        let client = Client::builder()
            .timeout(Duration::from_secs(PAYMENT_PROVIDER_TIMEOUT_SECS))
            .build()
            .map_err(|_| WalletError::PaymentVerificationFailed)?;

        let response = client
            .get(url)
            .bearer_auth(secret_key)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|err| {
                tracing::warn!("Payment provider request failed", ?err);
                WalletError::PaymentVerificationFailed
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            tracing::warn!(
                "Payment provider returned non-success status",
                ?status,
                body = body.as_str()
            );
            return Err(WalletError::PaymentVerificationFailed);
        }

        response.json::<T>().await.map_err(|err| {
            tracing::warn!("Failed to parse payment provider response", ?err);
            WalletError::PaymentVerificationFailed
        })
    }

    /// Verify payment with Paystack
    pub async fn verify_paystack_payment(
        &self,
        reference: &str,
        expected_amount: i64,
    ) -> Result<bool, WalletError> {
        Self::validate_paystack_reference(reference)?;

        let secret = env::var("PAYSTACK_SECRET")
            .map_err(|_| WalletError::PaymentVerificationFailed)?;
        let base_url = Self::paystack_base_url();

        let mut url = Url::parse(&base_url).map_err(|_| WalletError::PaymentVerificationFailed)?;
        url.path_segments_mut()
            .map_err(|_| WalletError::PaymentVerificationFailed)?
            .pop_if_empty()
            .push("transaction")
            .push("verify")
            .push(reference);

        tracing::info!("Verifying Paystack transaction", reference = reference);

        let response: PaystackVerificationResponse = self
            .fetch_provider_json(url, &secret)
            .await?;

        if !response.status {
            tracing::warn!(
                "Paystack verification response reported failure",
                message = response.message.as_deref()
            );
            return Ok(false);
        }

        let data = match response.data {
            Some(data) => data,
            None => {
                tracing::warn!("Paystack verification response missing data");
                return Ok(false);
            }
        };

        let tx_status = data.status.to_lowercase();
        if tx_status != "success" {
            tracing::warn!("Paystack transaction status invalid", status = %tx_status);
            return Ok(false);
        }

        if data.amount != expected_amount {
            tracing::warn!(
                "Paystack amount mismatch",
                amount = data.amount,
                expected_amount = expected_amount
            );
            return Ok(false);
        }

        if let Some(refund_status) = data.refund_status.as_deref() {
            let refund_status = refund_status.to_lowercase();
            if refund_status.contains("refund") || refund_status.contains("reverse") {
                tracing::warn!("Paystack transaction refunded or reversed", refund_status = %refund_status);
                return Ok(false);
            }
        }

        if data.amount_refunded.unwrap_or(0) > 0 {
            tracing::warn!("Paystack transaction has refunded amount", refunded = data.amount_refunded.unwrap_or(0));
            return Ok(false);
        }

        if let Some(gateway_response) = data.gateway_response.as_deref() {
            let gateway_response = gateway_response.to_lowercase();
            if gateway_response.contains("failed") || gateway_response.contains("declined") {
                tracing::warn!(
                    "Paystack gateway response indicates failure",
                    gateway_response = %gateway_response
                );
                return Ok(false);
            }
        }

        Ok(true)
    }

    /// Verify payment with Flutterwave
    pub async fn verify_flutterwave_payment(
        &self,
        transaction_id: &str,
        expected_amount: i64,
    ) -> Result<bool, WalletError> {
        Self::validate_flutterwave_reference(transaction_id)?;

        let secret = env::var("FLUTTERWAVE_SECRET")
            .map_err(|_| WalletError::PaymentVerificationFailed)?;
        let base_url = Self::flutterwave_base_url();

        let mut url = Url::parse(&base_url).map_err(|_| WalletError::PaymentVerificationFailed)?;
        url.path_segments_mut()
            .map_err(|_| WalletError::PaymentVerificationFailed)?
            .pop_if_empty()
            .push("transactions")
            .push(transaction_id)
            .push("verify");

        tracing::info!("Verifying Flutterwave transaction", transaction_id = transaction_id);

        let response: FlutterwaveVerificationResponse = self
            .fetch_provider_json(url, &secret)
            .await?;

        if response.status.to_lowercase() != "success" {
            tracing::warn!(
                "Flutterwave verification response reported failure",
                status = response.status.as_str(),
                message = response.message.as_deref()
            );
            return Ok(false);
        }

        let data = match response.data {
            Some(data) => data,
            None => {
                tracing::warn!("Flutterwave verification response missing data");
                return Ok(false);
            }
        };

        let tx_status = data.status.unwrap_or_default().to_lowercase();
        if tx_status != "successful" {
            tracing::warn!("Flutterwave transaction status invalid", status = %tx_status);
            return Ok(false);
        }

        let amount = data
            .amount
            .or(data.charged_amount)
            .unwrap_or_default();
        let amount_kobo = (amount * 100.0).round() as i64;

        if amount_kobo != expected_amount {
            tracing::warn!(
                "Flutterwave amount mismatch",
                amount_kobo = amount_kobo,
                expected_amount = expected_amount
            );
            return Ok(false);
        }

        if let Some(currency) = data.currency.as_deref() {
            if currency.to_uppercase() != "NGN" {
                tracing::warn!("Flutterwave currency mismatch", currency = currency);
                return Ok(false);
            }
        }

        if let Some(refund_status) = data.refund_status.as_deref() {
            let refund_status = refund_status.to_lowercase();
            if refund_status.contains("refund") || refund_status.contains("reverse") {
                tracing::warn!("Flutterwave transaction refunded or reversed", refund_status = %refund_status);
                return Ok(false);
            }
        }

        if data.amount_refunded.unwrap_or(0.0) > 0.0 {
            tracing::warn!("Flutterwave transaction has refunded amount", refunded = data.amount_refunded.unwrap_or(0.0));
            return Ok(false);
        }

        if let Some(gateway_message) = data.charge_response_message.as_deref() {
            let gateway_message = gateway_message.to_lowercase();
            if gateway_message.contains("failed") || gateway_message.contains("declined") {
                tracing::warn!(
                    "Flutterwave gateway response indicates failure",
                    gateway_message = %gateway_message
                );
                return Ok(false);
            }
        }

        Ok(true)
    }

    /// Process entry fee payment
    pub async fn process_entry_fee_payment(
        &self,
        user_id: Uuid,
        amount: i64,
        currency: &str,
        payment_method: &str,
        reference: Option<String>,
    ) -> Result<Transaction, WalletError> {
        // Create transaction record
        let mut transaction = self
            .create_transaction(
                user_id,
                TransactionType::EntryFee,
                amount,
                currency.to_string(),
                format!("Tournament entry fee payment"),
                reference.clone(),
            )
            .await?;

        match payment_method {
            "paystack" => {
                if let Some(ref ref_id) = reference {
                    let verified = self.verify_paystack_payment(ref_id, amount).await?;
                    if verified {
                        self.add_fiat_balance(user_id, amount).await?;
                        self.update_transaction_status(
                            transaction.id,
                            TransactionStatus::Completed,
                        )
                        .await?;
                        transaction.status = TransactionStatus::Completed;
                    } else {
                        self.update_transaction_status(transaction.id, TransactionStatus::Failed)
                            .await?;
                        transaction.status = TransactionStatus::Failed;
                    }
                }
            }
            "flutterwave" => {
                if let Some(ref ref_id) = reference {
                    let verified = self.verify_flutterwave_payment(ref_id, amount).await?;
                    if verified {
                        self.add_fiat_balance(user_id, amount).await?;
                        self.update_transaction_status(
                            transaction.id,
                            TransactionStatus::Completed,
                        )
                        .await?;
                        transaction.status = TransactionStatus::Completed;
                    } else {
                        self.update_transaction_status(transaction.id, TransactionStatus::Failed)
                            .await?;
                        transaction.status = TransactionStatus::Failed;
                    }
                }
            }
            "arenax_token" => {
                // Deduct tokens directly
                self.deduct_arenax_tokens(user_id, amount).await?;
                self.update_transaction_status(transaction.id, TransactionStatus::Completed)
                    .await?;
                transaction.status = TransactionStatus::Completed;
            }
            _ => {
                return Err(WalletError::InvalidAmount(format!(
                    "Unknown payment method: {}",
                    payment_method
                )));
            }
        }

        Ok(transaction)
    }

    // ========================================================================
    // REAL-TIME UPDATES
    // ========================================================================

    async fn publish_balance_update(&self, user_id: Uuid) {
        if let Some(ref event_bus) = self.event_bus {
            match self.get_wallet(user_id).await {
                Ok(wallet) => {
                    let event = crate::realtime::events::RealtimeEvent::BalanceUpdate {
                        user_id,
                        balance_ngn: wallet.balance_ngn.unwrap_or(0),
                        balance_arenax_tokens: wallet.balance_arenax_tokens.unwrap_or(0),
                        balance_xlm: wallet.balance_xlm.unwrap_or(0),
                        timestamp: chrono::Utc::now().to_rfc3339(),
                    };
                    event_bus.publish_to_user(user_id, &event).await;
                }
                Err(e) => {
                    tracing::error!(
                        user_id = %user_id,
                        error = %e,
                        "Failed to fetch wallet for balance update event"
                    );
                }
            }
        }
    }
}
