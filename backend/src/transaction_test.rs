//! Concurrency tests for transaction handling
//! 
//! This module contains tests to verify that race conditions are properly
//! handled in concurrent database operations.

use crate::transaction::{execute_transaction, IsolationLevel, TransactionConfig};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::timeout;
use uuid::Uuid;

/// Test concurrent wallet balance updates
pub async fn test_concurrent_balance_updates(pool: &PgPool, user_id: Uuid) -> Result<(), String> {
    let config = TransactionConfig {
        isolation_level: IsolationLevel::Serializable,
        max_retries: 5,
        ..Default::default()
    };

    let pool = Arc::new(pool.clone());
    let mut handles = vec![];

    // Spawn 10 concurrent tasks that each try to add 100 to the balance
    for i in 0..10 {
        let pool_clone = pool.clone();
        let user_id_clone = user_id;
        let handle = tokio::spawn(async move {
            let result = execute_transaction(&pool_clone, &config, move |tx| {
                Box::pin(async move {
                    // Lock the wallet row
                    sqlx::query!(
                        "SELECT balance_ngn FROM wallets WHERE user_id = $1 FOR UPDATE",
                        user_id_clone
                    )
                    .fetch_one(&mut **tx)
                    .await
                    .map_err(|e| sqlx::Error::Database(e.into()))?;

                    // Simulate some processing time
                    tokio::time::sleep(Duration::from_millis(10)).await;

                    // Update balance
                    sqlx::query!(
                        "UPDATE wallets SET balance_ngn = balance_ngn + $1 WHERE user_id = $2",
                        100i64,
                        user_id_clone
                    )
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| sqlx::Error::Database(e.into()))?;

                    Ok::<(), sqlx::Error>(())
                })
            })
            .await;

            if let Err(e) = result {
                return Err(format!("Task {} failed: {}", i, e));
            }
            Ok(())
        });
        handles.push(handle);
    }

    // Wait for all tasks to complete
    for handle in handles {
        handle.await.map_err(|e| format!("Task join failed: {}", e))??;
    }

    // Verify final balance is 1000 (10 * 100)
    let wallet = sqlx::query!(
        "SELECT balance_ngn FROM wallets WHERE user_id = $1",
        user_id
    )
    .fetch_one(pool.as_ref())
    .await
    .map_err(|e| format!("Failed to fetch wallet: {}", e))?;

    let final_balance = wallet.balance_ngn.unwrap_or(0);
    if final_balance != 1000 {
        return Err(format!(
            "Balance mismatch: expected 1000, got {}",
            final_balance
        ));
    }

    Ok(())
}

/// Test concurrent wallet deductions with insufficient balance
pub async fn test_concurrent_deductions_with_insufficient_balance(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<(), String> {
    // Set initial balance to 500
    sqlx::query!(
        "UPDATE wallets SET balance_ngn = $1 WHERE user_id = $2",
        500i64,
        user_id
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to set initial balance: {}", e))?;

    let config = TransactionConfig {
        isolation_level: IsolationLevel::Serializable,
        max_retries: 5,
        ..Default::default()
    };

    let pool = Arc::new(pool.clone());
    let mut handles = vec![];

    // Spawn 10 concurrent tasks that each try to deduct 100
    // Only 5 should succeed (500 / 100 = 5)
    for i in 0..10 {
        let pool_clone = pool.clone();
        let user_id_clone = user_id;
        let handle = tokio::spawn(async move {
            let result = execute_transaction(&pool_clone, &config, move |tx| {
                Box::pin(async move {
                    // Lock and check balance
                    let wallet = sqlx::query!(
                        "SELECT balance_ngn FROM wallets WHERE user_id = $1 FOR UPDATE",
                        user_id_clone
                    )
                    .fetch_one(&mut **tx)
                    .await
                    .map_err(|e| sqlx::Error::Database(e.into()))?;

                    let current_balance = wallet.balance_ngn.unwrap_or(0);
                    if current_balance < 100 {
                        return Err(sqlx::Error::Database(
                            sqlx::postgres::PgDatabaseError::new(
                                "INSUFFICIENT_BALANCE",
                                "wallets",
                                "balance_ngn",
                                None,
                                None,
                                None,
                            )
                            .into(),
                        ));
                    }

                    // Simulate processing time
                    tokio::time::sleep(Duration::from_millis(10)).await;

                    // Deduct balance
                    sqlx::query!(
                        "UPDATE wallets SET balance_ngn = balance_ngn - $1 WHERE user_id = $2",
                        100i64,
                        user_id_clone
                    )
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| sqlx::Error::Database(e.into()))?;

                    Ok::<(), sqlx::Error>(())
                })
            })
            .await;

            match result {
                Ok(_) => Ok(true),
                Err(_) => Ok(false), // Expected to fail for some transactions
            }
        });
        handles.push(handle);
    }

    // Wait for all tasks and count successes
    let mut success_count = 0;
    for handle in handles {
        let success = handle.await.map_err(|e| format!("Task join failed: {}", e))??;
        if success {
            success_count += 1;
        }
    }

    // Verify exactly 5 succeeded
    if success_count != 5 {
        return Err(format!(
            "Success count mismatch: expected 5, got {}",
            success_count
        ));
    }

    // Verify final balance is 0
    let wallet = sqlx::query!(
        "SELECT balance_ngn FROM wallets WHERE user_id = $1",
        user_id
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to fetch wallet: {}", e))?;

    let final_balance = wallet.balance_ngn.unwrap_or(0);
    if final_balance != 0 {
        return Err(format!(
            "Balance mismatch: expected 0, got {}",
            final_balance
        ));
    }

    Ok(())
}

/// Test transaction retry on serialization failure
pub async fn test_transaction_retry_on_serialization(pool: &PgPool) -> Result<(), String> {
    let config = TransactionConfig {
        isolation_level: IsolationLevel::Serializable,
        max_retries: 3,
        retry_delay: Duration::from_millis(10),
        ..Default::default()
    };

    let pool = Arc::new(pool.clone());
    let user_id = Uuid::new_v4();

    // Create a test wallet
    sqlx::query!(
        "INSERT INTO wallets (id, user_id, balance_ngn, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())",
        Uuid::new_v4(),
        user_id,
        1000i64
    )
    .execute(pool.as_ref())
    .await
    .map_err(|e| format!("Failed to create wallet: {}", e))?;

    let mut handles = vec![];

    // Spawn concurrent transactions that will conflict
    for _ in 0..5 {
        let pool_clone = pool.clone();
        let user_id_clone = user_id;
        let handle = tokio::spawn(async move {
            let result = execute_transaction(&pool_clone, &config, move |tx| {
                Box::pin(async move {
                    // Lock the wallet
                    sqlx::query!(
                        "SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE",
                        user_id_clone
                    )
                    .fetch_one(&mut **tx)
                    .await
                    .map_err(|e| sqlx::Error::Database(e.into()))?;

                    // Simulate processing time to increase chance of conflict
                    tokio::time::sleep(Duration::from_millis(50)).await;

                    // Update balance
                    sqlx::query!(
                        "UPDATE wallets SET balance_ngn = balance_ngn + 1 WHERE user_id = $1",
                        user_id_clone
                    )
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| sqlx::Error::Database(e.into()))?;

                    Ok::<(), sqlx::Error>(())
                })
            })
            .await;

            result.map_err(|e| format!("Transaction failed: {}", e))
        });
        handles.push(handle);
    }

    // Wait for all tasks with timeout
    for handle in handles {
        timeout(Duration::from_secs(10), handle)
            .await
            .map_err(|e| format!("Task timeout: {}", e))?
            .map_err(|e| format!("Task join failed: {}", e))??;
    }

    // Verify final balance is 1005 (1000 + 5 * 1)
    let wallet = sqlx::query!(
        "SELECT balance_ngn FROM wallets WHERE user_id = $1",
        user_id
    )
    .fetch_one(pool.as_ref())
    .await
    .map_err(|e| format!("Failed to fetch wallet: {}", e))?;

    let final_balance = wallet.balance_ngn.unwrap_or(0);
    if final_balance != 1005 {
        return Err(format!(
            "Balance mismatch: expected 1005, got {}",
            final_balance
        ));
    }

    Ok(())
}

/// Test deadlock detection (long-running transaction)
pub async fn test_deadlock_detection(pool: &PgPool) -> Result<(), String> {
    let config = TransactionConfig {
        isolation_level: IsolationLevel::Serializable,
        max_retries: 1,
        retry_delay: Duration::from_millis(10),
        ..Default::default()
    };

    let pool = Arc::new(pool.clone());
    let user_id = Uuid::new_v4();

    // Create test wallets
    sqlx::query!(
        "INSERT INTO wallets (id, user_id, balance_ngn, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())",
        Uuid::new_v4(),
        user_id,
        1000i64
    )
    .execute(pool.as_ref())
    .await
    .map_err(|e| format!("Failed to create wallet: {}", e))?;

    // Spawn a transaction that holds a lock for a long time
    let pool_clone = pool.clone();
    let user_id_clone = user_id;
    let long_tx_handle = tokio::spawn(async move {
        execute_transaction(&pool_clone, &config, move |tx| {
            Box::pin(async move {
                // Lock the wallet
                sqlx::query!(
                    "SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE",
                    user_id_clone
                )
                .fetch_one(&mut **tx)
                .await
                .map_err(|e| sqlx::Error::Database(e.into()))?;

                // Hold the lock for 5 seconds
                tokio::time::sleep(Duration::from_secs(5)).await;

                Ok::<(), sqlx::Error>(())
            })
        })
        .await
    });

    // Try to acquire the same lock with a timeout
    let pool_clone2 = pool.clone();
    let user_id_clone2 = user_id;
    let quick_tx_handle = tokio::spawn(async move {
        let result = timeout(
            Duration::from_secs(2),
            execute_transaction(&pool_clone2, &config, move |tx| {
                Box::pin(async move {
                    sqlx::query!(
                        "SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE",
                        user_id_clone2
                    )
                    .fetch_one(&mut **tx)
                    .await
                    .map_err(|e| sqlx::Error::Database(e.into()))?;

                    Ok::<(), sqlx::Error>(())
                })
            })
            .await,
        );

        match result {
            Ok(inner) => inner.map_err(|e| format!("Transaction failed: {}", e)),
            Err(_) => Err("Timeout waiting for lock".to_string()),
        }
    });

    // The quick transaction should timeout
    let quick_result = quick_tx_handle
        .await
        .map_err(|e| format!("Quick tx join failed: {}", e))?;

    if quick_result.is_ok() {
        return Err("Quick transaction should have timed out".to_string());
    }

    // Wait for long transaction to complete
    long_tx_handle
        .await
        .map_err(|e| format!("Long tx join failed: {}", e))??;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_concurrent_balance_updates_integration() {
        // This would require a test database setup
        // For now, it's a placeholder showing the test structure
    }
}
