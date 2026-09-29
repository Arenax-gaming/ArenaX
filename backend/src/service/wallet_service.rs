use crate::models::{
    Transaction, TransactionResponse, TransactionStatus, TransactionType, Wallet, WalletResponse,
};
use crate::service::payment_provider::{DepositInitiation, PaymentProvider, PaymentProviderKind};
use crate::transaction::{execute_transaction, IsolationLevel, TransactionConfig};
use anyhow::Result;
use chrono::Utc;
// EventBus is used via crate::realtime::event_bus::EventBus
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
    event_bus: Option<crate::realtime::event_bus::EventBus>,
    /// Payment gateway, chosen by `PAYMENT_PROVIDER` (#1069). The wallet
    /// service only talks to gateways through this trait object.
    payment_provider: Arc<dyn PaymentProvider>,
}

impl WalletService {
    /// Build a wallet service using the gateway selected by `PAYMENT_PROVIDER`.
    ///
    /// `main.rs` rejects an invalid `PAYMENT_PROVIDER` at startup, so the
    /// fallback below only matters if the variable changes at runtime.
    pub fn new(db_pool: DbPool, event_bus: Option<crate::realtime::event_bus::EventBus>) -> Self {
        let provider = PaymentProviderKind::from_env().unwrap_or_else(|e| {
            tracing::error!(error = %e, "invalid PAYMENT_PROVIDER, falling back to paystack");
            PaymentProviderKind::Paystack
        });
        Self::with_provider(db_pool, event_bus, provider.build())
    }

    /// Build a wallet service with an explicit gateway (used by tests and by
    /// callers that choose the provider themselves).
    pub fn with_provider(
        db_pool: DbPool,
        event_bus: Option<crate::realtime::event_bus::EventBus>,
        payment_provider: Arc<dyn PaymentProvider>,
    ) -> Self {
        Self {
            db_pool,
            event_bus,
            payment_provider,
        }
    }

    /// Identifier of the active gateway, e.g. `"paystack"`.
    pub fn payment_provider_name(&self) -> &'static str {
        self.payment_provider.name()
    }

    // ========================================================================
    // CORE WALLET OPERATIONS
    // ========================================================================

    /// Get wallet for a user
    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
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

    /// Add fiat balance (in kobo for NGN) with transaction isolation
    #[tracing::instrument(skip(self), fields(user_id = %user_id, amount))]
    pub async fn add_fiat_balance(&self, user_id: Uuid, amount: i64) -> Result<(), WalletError> {
        if amount <= 0 {
            return Err(WalletError::InvalidAmount(
                "Amount must be positive".to_string(),
            ));
        }

        let config = TransactionConfig {
            isolation_level: IsolationLevel::Serializable,
            max_retries: 3,
            ..Default::default()
        };

        let user_id_clone = user_id;
        let amount_clone = amount;
        let db_pool = self.db_pool.clone();
        
        execute_transaction(&db_pool, &config, move |tx| {
            Box::pin(async move {
                // Lock the wallet row for update to prevent concurrent modifications
                sqlx::query!(
                    "SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE",
                    user_id_clone
                )
                .fetch_one(&mut **tx)
                .await
                .map_err(|e| WalletError::DatabaseError(e))?;

                sqlx::query!(
                    r#"
                    UPDATE wallets
                    SET balance_ngn = balance_ngn + $1, updated_at = $2
                    WHERE user_id = $3
                    "#,
                    amount_clone,
                    Utc::now(),
                    user_id_clone
                )
                .execute(&mut **tx)
                .await
                .map_err(|e| WalletError::DatabaseError(e))?;

                Ok::<(), WalletError>(())
            })
        })
        .await?;

        // Publish balance update event
        self.publish_balance_update(user_id).await;

        Ok(())
    }

    /// Deduct fiat balance (in kobo for NGN) with transaction isolation
    #[tracing::instrument(skip(self), fields(user_id = %user_id, amount))]
    pub async fn deduct_fiat_balance(&self, user_id: Uuid, amount: i64) -> Result<(), WalletError> {
        if amount <= 0 {
            return Err(WalletError::InvalidAmount(
                "Amount must be positive".to_string(),
            ));
        }

        let config = TransactionConfig {
            isolation_level: IsolationLevel::Serializable,
            max_retries: 3,
            ..Default::default()
        };

        let user_id_clone = user_id;
        let amount_clone = amount;
        let db_pool = self.db_pool.clone();
        
        execute_transaction(&db_pool, &config, move |tx| {
            Box::pin(async move {
                // Lock the wallet row and check balance atomically
                let wallet = sqlx::query!(
                    "SELECT balance_ngn FROM wallets WHERE user_id = $1 FOR UPDATE",
                    user_id_clone
                )
                .fetch_one(&mut **tx)
                .await
                .map_err(|e| WalletError::DatabaseError(e))?;

                let current_balance = wallet.balance_ngn.unwrap_or(0);
                if current_balance < amount_clone {
                    return Err(WalletError::InsufficientBalance {
                        required: amount_clone,
                        available: current_balance,
                    });
                }

                sqlx::query!(
                    r#"
                    UPDATE wallets
                    SET balance_ngn = balance_ngn - $1, updated_at = $2
                    WHERE user_id = $3
                    "#,
                    amount_clone,
                    Utc::now(),
                    user_id_clone
                )
                .execute(&mut **tx)
                .await
                .map_err(|e| WalletError::DatabaseError(e))?;

                Ok::<(), WalletError>(())
            })
        })
        .await?;

        // Publish balance update event
        self.publish_balance_update(user_id).await;

        Ok(())
    }

    /// Add ArenaX tokens with transaction isolation
    pub async fn add_arenax_tokens(&self, user_id: Uuid, amount: i64) -> Result<(), WalletError> {
        if amount <= 0 {
            return Err(WalletError::InvalidAmount(
                "Amount must be positive".to_string(),
            ));
        }

        let config = TransactionConfig {
            isolation_level: IsolationLevel::Serializable,
            max_retries: 3,
            ..Default::default()
        };

        let user_id_clone = user_id;
        let amount_clone = amount;
        let db_pool = self.db_pool.clone();
        
        execute_transaction(&db_pool, &config, move |tx| {
            Box::pin(async move {
                sqlx::query!(
                    "SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE",
                    user_id_clone
                )
                .fetch_one(&mut **tx)
                .await
                .map_err(|e| WalletError::DatabaseError(e))?;

                sqlx::query!(
                    r#"
                    UPDATE wallets
                    SET balance_arenax_tokens = balance_arenax_tokens + $1, updated_at = $2
                    WHERE user_id = $3
                    "#,
                    amount_clone,
                    Utc::now(),
                    user_id_clone
                )
                .execute(&mut **tx)
                .await
                .map_err(|e| WalletError::DatabaseError(e))?;

                Ok::<(), WalletError>(())
            })
        })
        .await?;

        // Publish balance update event
        self.publish_balance_update(user_id).await;

        Ok(())
    }

    /// Deduct ArenaX tokens with transaction isolation
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

        let config = TransactionConfig {
            isolation_level: IsolationLevel::Serializable,
            max_retries: 3,
            ..Default::default()
        };

        let user_id_clone = user_id;
        let amount_clone = amount;
        let db_pool = self.db_pool.clone();
        
        execute_transaction(&db_pool, &config, move |tx| {
            Box::pin(async move {
                let wallet = sqlx::query!(
                    "SELECT balance_arenax_tokens FROM wallets WHERE user_id = $1 FOR UPDATE",
                    user_id_clone
                )
                .fetch_one(&mut **tx)
                .await
                .map_err(|e| WalletError::DatabaseError(e))?;

                let current_balance = wallet.balance_arenax_tokens.unwrap_or(0);
                if current_balance < amount_clone {
                    return Err(WalletError::InsufficientBalance {
                        required: amount_clone,
                        available: current_balance,
                    });
                }

                sqlx::query!(
                    r#"
                    UPDATE wallets
                    SET balance_arenax_tokens = balance_arenax_tokens - $1, updated_at = $2
                    WHERE user_id = $3
                    "#,
                    amount_clone,
                    Utc::now(),
                    user_id_clone
                )
                .execute(&mut **tx)
                .await
                .map_err(|e| WalletError::DatabaseError(e))?;

                Ok::<(), WalletError>(())
            })
        })
        .await?;

        // Publish balance update event
        self.publish_balance_update(user_id).await;

        Ok(())
    }

    /// Move balance to escrow with transaction isolation
    #[tracing::instrument(skip(self), fields(user_id = %user_id, amount))]
    pub async fn move_to_escrow(&self, user_id: Uuid, amount: i64) -> Result<(), WalletError> {
        if amount <= 0 {
            return Err(WalletError::InvalidAmount(
                "Amount must be positive".to_string(),
            ));
        }

        let config = TransactionConfig {
            isolation_level: IsolationLevel::Serializable,
            max_retries: 3,
            ..Default::default()
        };

        let user_id_clone = user_id;
        let amount_clone = amount;
        let db_pool = self.db_pool.clone();
        
        execute_transaction(&db_pool, &config, move |tx| {
            Box::pin(async move {
                let wallet = sqlx::query!(
                    "SELECT balance_ngn FROM wallets WHERE user_id = $1 FOR UPDATE",
                    user_id_clone
                )
                .fetch_one(&mut **tx)
                .await
                .map_err(|e| WalletError::DatabaseError(e))?;

                let current_balance = wallet.balance_ngn.unwrap_or(0);
                if current_balance < amount_clone {
                    return Err(WalletError::InsufficientBalance {
                        required: amount_clone,
                        available: current_balance,
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
                    amount_clone,
                    Decimal::from(amount_clone),
                    Utc::now(),
                    user_id_clone
                )
                .execute(&mut **tx)
                .await
                .map_err(|e| WalletError::DatabaseError(e))?;

                Ok::<(), WalletError>(())
            })
        })
        .await?;

        Ok(())
    }

    /// Release escrow back to balance with transaction isolation
    #[tracing::instrument(skip(self), fields(user_id = %user_id, amount))]
    pub async fn release_from_escrow(&self, user_id: Uuid, amount: i64) -> Result<(), WalletError> {
        if amount <= 0 {
            return Err(WalletError::InvalidAmount(
                "Amount must be positive".to_string(),
            ));
        }

        let config = TransactionConfig {
            isolation_level: IsolationLevel::Serializable,
            max_retries: 3,
            ..Default::default()
        };

        let user_id_clone = user_id;
        let amount_clone = amount;
        let db_pool = self.db_pool.clone();
        
        execute_transaction(&db_pool, &config, move |tx| {
            Box::pin(async move {
                sqlx::query!(
                    "SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE",
                    user_id_clone
                )
                .fetch_one(&mut **tx)
                .await
                .map_err(|e| WalletError::DatabaseError(e))?;

                sqlx::query!(
                    r#"
                    UPDATE wallets
                    SET balance_ngn = balance_ngn + $1,
                        escrow_balance = escrow_balance - $2,
                        updated_at = $3
                    WHERE user_id = $4
                    "#,
                    amount_clone,
                    Decimal::from(amount_clone),
                    Utc::now(),
                    user_id_clone
                )
                .execute(&mut **tx)
                .await
                .map_err(|e| WalletError::DatabaseError(e))?;

                Ok::<(), WalletError>(())
            })
        })
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

    /// Get transaction history for a user (legacy — page/per_page ints)
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

    /// Get paginated transaction history and total count for a user.
    ///
    /// Returns `(transactions, total_count)`.  The limit is already clamped
    /// by [`PaginationParams::resolved_limit`] before reaching this method.
    pub async fn get_transaction_history_paginated(
        &self,
        user_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Transaction>, i64), WalletError> {
        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&*self.db_pool)
        .await?;

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
            limit,
            offset,
        )
        .fetch_all(&*self.db_pool)
        .await?;

        Ok((transactions, total))
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

    /// Start a deposit with the active gateway.
    pub async fn initiate_provider_deposit(
        &self,
        reference: &str,
        amount: i64,
        currency: &str,
    ) -> Result<DepositInitiation, WalletError> {
        self.payment_provider
            .initiate_deposit(reference, amount, currency)
            .await
            .map_err(|e| {
                tracing::warn!(provider = self.payment_provider.name(), error = %e, "deposit initiation failed");
                WalletError::PaymentVerificationFailed
            })
    }

    /// Verify a deposit with the gateway the caller says it paid through.
    ///
    /// Only the configured gateway is enabled. A `provider` that names any
    /// other gateway is treated like an unknown one was before (#1069): not
    /// verified, rather than an error, so the HTTP response shape is unchanged.
    pub async fn verify_payment(
        &self,
        provider: &str,
        reference: &str,
        expected_amount: i64,
    ) -> Result<bool, WalletError> {
        if provider != self.payment_provider.name() {
            tracing::warn!(
                requested = provider,
                enabled = self.payment_provider.name(),
                "payment verification requested for a provider that is not enabled"
            );
            return Ok(false);
        }
        self.payment_provider
            .verify_deposit(reference, expected_amount)
            .await
            .map_err(|e| {
                tracing::warn!(provider, error = %e, "payment verification failed");
                WalletError::PaymentVerificationFailed
            })
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
            method if method == self.payment_provider.name() => {
                if let Some(ref ref_id) = reference {
                    let verified = self.verify_payment(method, ref_id, amount).await?;
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

#[cfg(test)]
mod payment_provider_tests {
    use super::*;
    use crate::service::payment_provider::{PaymentError, PaymentStatus};
    use async_trait::async_trait;
    use std::sync::Mutex;

    /// Records every call so tests can assert which gateway method ran.
    struct MockProvider {
        name: &'static str,
        calls: Arc<Mutex<Vec<String>>>,
        verify_result: bool,
    }

    #[async_trait]
    impl PaymentProvider for MockProvider {
        fn name(&self) -> &'static str {
            self.name
        }

        async fn initiate_deposit(
            &self,
            reference: &str,
            amount: i64,
            currency: &str,
        ) -> Result<DepositInitiation, PaymentError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("initiate_deposit:{reference}:{amount}:{currency}"));
            Ok(DepositInitiation {
                reference: reference.to_string(),
                authorization_url: Some("https://pay.example/checkout".to_string()),
            })
        }

        async fn verify_deposit(
            &self,
            reference: &str,
            expected_amount: i64,
        ) -> Result<bool, PaymentError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("verify_deposit:{reference}:{expected_amount}"));
            Ok(self.verify_result)
        }

        async fn initiate_withdrawal(
            &self,
            _reference: &str,
            _amount: i64,
            _currency: &str,
            _destination: &str,
        ) -> Result<PaymentStatus, PaymentError> {
            self.calls
                .lock()
                .unwrap()
                .push("initiate_withdrawal".to_string());
            Ok(PaymentStatus::Pending)
        }

        async fn check_status(&self, _reference: &str) -> Result<PaymentStatus, PaymentError> {
            self.calls.lock().unwrap().push("check_status".to_string());
            Ok(PaymentStatus::Pending)
        }
    }

    fn service_with(provider: MockProvider) -> WalletService {
        // The pool is never used by these tests; connect_lazy doesn't dial.
        let pool = PgPool::connect_lazy("postgres://localhost/arenax_test").unwrap();
        WalletService::with_provider(Arc::new(pool), None, Arc::new(provider))
    }

    fn mock(name: &'static str, verify_result: bool) -> (MockProvider, Arc<Mutex<Vec<String>>>) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let provider = MockProvider {
            name,
            calls: calls.clone(),
            verify_result,
        };
        (provider, calls)
    }

    #[tokio::test]
    async fn initiate_deposit_calls_the_injected_provider() {
        let (provider, calls) = mock("mockpay", true);
        let service = service_with(provider);

        let init = service
            .initiate_provider_deposit("ref-1", 5_000, "NGN")
            .await
            .unwrap();

        assert_eq!(init.reference, "ref-1");
        assert_eq!(
            init.authorization_url.as_deref(),
            Some("https://pay.example/checkout")
        );
        assert_eq!(
            *calls.lock().unwrap(),
            vec!["initiate_deposit:ref-1:5000:NGN"]
        );
        assert_eq!(service.payment_provider_name(), "mockpay");
    }

    #[tokio::test]
    async fn verify_payment_delegates_to_the_enabled_provider() {
        let (provider, calls) = mock("mockpay", true);
        let service = service_with(provider);

        assert!(service
            .verify_payment("mockpay", "ref-2", 700)
            .await
            .unwrap());
        assert_eq!(*calls.lock().unwrap(), vec!["verify_deposit:ref-2:700"]);
    }

    #[tokio::test]
    async fn verify_payment_passes_through_a_failed_verification() {
        let (provider, _calls) = mock("mockpay", false);
        let service = service_with(provider);

        assert!(!service
            .verify_payment("mockpay", "ref-3", 700)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn verify_payment_for_a_provider_that_is_not_enabled_is_false_and_never_calls_it() {
        let (provider, calls) = mock("mockpay", true);
        let service = service_with(provider);

        assert!(!service
            .verify_payment("flutterwave", "ref-4", 700)
            .await
            .unwrap());
        assert!(calls.lock().unwrap().is_empty());
    }
}
