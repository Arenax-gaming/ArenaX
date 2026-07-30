use crate::api_error::ApiError;
use sqlx::{postgres::PgPool, Postgres, Transaction};
use std::time::Duration;
use tracing::{debug, warn};
use uuid::Uuid;

/// Transaction isolation levels for PostgreSQL
#[derive(Debug, Clone, Copy)]
pub enum IsolationLevel {
    ReadCommitted,
    RepeatableRead,
    Serializable,
}

impl IsolationLevel {
    fn as_str(&self) -> &'static str {
        match self {
            IsolationLevel::ReadCommitted => "READ COMMITTED",
            IsolationLevel::RepeatableRead => "REPEATABLE READ",
            IsolationLevel::Serializable => "SERIALIZABLE",
        }
    }
}

/// Transaction configuration
#[derive(Debug, Clone)]
pub struct TransactionConfig {
    pub isolation_level: IsolationLevel,
    pub max_retries: u32,
    pub retry_delay: Duration,
}

impl Default for TransactionConfig {
    fn default() -> Self {
        Self {
            isolation_level: IsolationLevel::Serializable,
            max_retries: 3,
            retry_delay: Duration::from_millis(50),
        }
    }
}

/// Execute a transaction with automatic retry on serialization failures
pub async fn execute_transaction<F, R>(
    pool: &PgPool,
    config: &TransactionConfig,
    f: F,
) -> Result<R, ApiError>
where
    F: Fn(&mut Transaction<'_, Postgres>) -> futures::future::BoxFuture<'_, Result<R, ApiError>>,
{
    let mut last_error = None;
    
    for attempt in 0..=config.max_retries {
        let mut tx = begin_transaction(pool, config.isolation_level).await?;
        
        match f(&mut tx).await {
            Ok(result) => {
                tx.commit().await.map_err(|e| ApiError::database_error(e))?;
                return Ok(result);
            }
            Err(e) => {
                // Check if this is a serialization error that can be retried
                if is_serialization_error(&e) && attempt < config.max_retries {
                    warn!(
                        attempt = attempt + 1,
                        max_retries = config.max_retries,
                        error = %e,
                        "Transaction failed due to serialization error, retrying..."
                    );
                    last_error = Some(e);
                    
                    // Rollback is automatic on drop, but we explicitly close
                    let _ = tx.rollback().await;
                    
                    // Exponential backoff
                    let delay = config.retry_delay * 2_u32.pow(attempt);
                    tokio::time::sleep(delay).await;
                    continue;
                } else {
                    // Non-retryable error or max retries exceeded
                    let _ = tx.rollback().await;
                    return Err(e);
                }
            }
        }
    }
    
    Err(last_error.unwrap_or_else(|| {
        ApiError::internal_error("Transaction failed after max retries")
    }))
}

/// Begin a transaction with specified isolation level
pub async fn begin_transaction(
    pool: &PgPool,
    isolation_level: IsolationLevel,
) -> Result<Transaction<'_, Postgres>, ApiError> {
    let mut tx = pool.begin().await.map_err(|e| ApiError::database_error(e))?;
    
    // Set isolation level
    sqlx::query(&format!("SET TRANSACTION ISOLATION LEVEL {}", isolation_level.as_str()))
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::database_error(e))?;
    
    debug!(isolation_level = %isolation_level.as_str(), "Transaction started");
    
    Ok(tx)
}

/// Check if an error is a serialization failure that can be retried
fn is_serialization_error(error: &ApiError) -> bool {
    if let ApiError::DatabaseError(sqlx::Error::Database(db_err)) = error {
        // PostgreSQL serialization error codes
        // 40001: serialization_failure
        // Could not serialize access due to concurrent update
        let code = db_err.code();
        return code.as_deref() == Some("40001");
    }
    false
}

/// Lock a row for update (pessimistic locking)
pub async fn lock_for_update(
    tx: &mut Transaction<'_, Postgres>,
    table: &str,
    id: Uuid,
) -> Result<(), ApiError> {
    sqlx::query(&format!(
        "SELECT 1 FROM {} WHERE id = $1 FOR UPDATE",
        table
    ))
    .bind(id)
    .execute(&mut **tx)
    .await
    .map_err(|e| ApiError::database_error(e))?;
    
    Ok(())
}

/// Lock a row for update with a custom WHERE clause
pub async fn lock_for_update_where(
    tx: &mut Transaction<'_, Postgres>,
    table: &str,
    where_clause: &str,
    params: Vec<sqlx::postgres::PgValue>,
) -> Result<(), ApiError> {
    let query_str = format!(
        "SELECT 1 FROM {} WHERE {} FOR UPDATE",
        table, where_clause
    );
    
    let mut query = sqlx::query(&query_str);
    for param in params {
        query = query.bind(param);
    }
    
    query
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::database_error(e))?;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_isolation_level_to_string() {
        assert_eq!(IsolationLevel::ReadCommitted.as_str(), "READ COMMITTED");
        assert_eq!(IsolationLevel::RepeatableRead.as_str(), "REPEATABLE READ");
        assert_eq!(IsolationLevel::Serializable.as_str(), "SERIALIZABLE");
    }
}
