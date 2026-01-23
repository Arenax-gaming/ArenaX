use crate::models::{
    Wallet, Transaction, TransactionType, TransactionStatus,
    WalletResponse, TransactionResponse,
};
use anyhow::Result;
use chrono::Utc;
use redis::Client as RedisClient;
use rust_decimal::Decimal;
use sqlx::PgPool;
use std::sync::Arc;
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

#[derive(Clone)]
pub struct WalletService {
    db_pool: DbPool,
    redis_client: Option<Arc<RedisClient>>,
}

impl WalletService {
    pub fn new(db_pool: DbPool, redis_client: Option<Arc<RedisClient>>) -> Self {
        Self {
            db_pool,
            redis_client,
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
    pub async fn release_from_escrow(
        &self,
        user_id: Uuid,
        amount: i64,
    ) -> Result<(), WalletError> {
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

    /// Verify payment with Paystack
    pub async fn verify_paystack_payment(
        &self,
        reference: &str,
        expected_amount: i64,
    ) -> Result<bool, WalletError> {
        // TODO: Implement actual Paystack API call
        // For now, this is a placeholder

        // let client = reqwest::Client::new();
        // let paystack_secret = std::env::var("PAYSTACK_SECRET_KEY")
        //     .expect("PAYSTACK_SECRET_KEY must be set");

        // let response = client
        //     .get(&format!("https://api.paystack.co/transaction/verify/{}", reference))
        //     .header("Authorization", format!("Bearer {}", paystack_secret))
        //     .send()
        //     .await
        //     .map_err(|e| WalletError::PaymentVerificationFailed)?;

        // if !response.status().is_success() {
        //     return Err(WalletError::PaymentVerificationFailed);
        // }

        // let data: PaystackResponse = response.json().await
        //     .map_err(|e| WalletError::PaymentVerificationFailed)?;

        // Ok(data.data.status == "success" && data.data.amount == expected_amount)

        tracing::warn!("Paystack verification not implemented, returning true for testing");
        Ok(true)
    }

    /// Verify payment with Flutterwave
    pub async fn verify_flutterwave_payment(
        &self,
        transaction_id: &str,
        expected_amount: i64,
    ) -> Result<bool, WalletError> {
        // TODO: Implement actual Flutterwave API call
        tracing::warn!("Flutterwave verification not implemented, returning true for testing");
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
                        self.update_transaction_status(transaction.id, TransactionStatus::Completed)
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
                        self.update_transaction_status(transaction.id, TransactionStatus::Completed)
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
        if let Some(redis_client) = &self.redis_client {
            match redis_client.get_connection() {
                Ok(mut conn) => {
                    use redis::Commands;
                    let channel = format!("wallet:{}:balance", user_id);
                    let message = serde_json::json!({
                        "user_id": user_id,
                        "event": "balance_updated",
                        "timestamp": Utc::now().to_rfc3339()
                    });

                    if let Err(e) = conn.publish::<_, _, ()>(channel, message.to_string()) {
                        tracing::error!("Failed to publish balance update: {}", e);
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to get Redis connection: {}", e);
                }
            }
        }
    }
}
