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

/// Exponential backoff with jitter for retrying transient failures
/// (Issue #1345). Shared by DB serialization retries and Soroban submission
/// retries so both spread their retries instead of stampeding in lock-step.
#[derive(Debug, Clone)]
pub struct BackoffPolicy {
    /// Retries after the first attempt (so up to `max_retries + 1` attempts).
    pub max_retries: u32,
    pub initial_delay: Duration,
    pub max_delay: Duration,
    pub multiplier: f64,
    /// Fraction (0.0–1.0) of each delay that is randomised; `0.0` is
    /// deterministic, `1.0` is "full jitter".
    pub jitter: f64,
}

impl Default for BackoffPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_delay: Duration::from_millis(500),
            max_delay: Duration::from_secs(10),
            multiplier: 2.0,
            jitter: 0.5,
        }
    }
}

impl BackoffPolicy {
    /// Delay before retry number `attempt` (0-based), with random jitter.
    pub fn delay_for(&self, attempt: u32) -> Duration {
        self.delay_with_unit(attempt, rand::random::<f64>())
    }

    /// Delay before retry number `attempt` given a jitter sample `unit` in
    /// `[0, 1]`. Deterministic, so the curve can be unit-tested.
    ///
    /// `capped = min(initial * multiplier^attempt, max)`; the result keeps
    /// `(1 - jitter)` of `capped` and randomises the remaining `jitter` share.
    pub fn delay_with_unit(&self, attempt: u32, unit: f64) -> Duration {
        let exponential =
            self.initial_delay.as_secs_f64() * self.multiplier.max(1.0).powi(attempt.min(32) as i32);
        let capped = exponential.min(self.max_delay.as_secs_f64());
        let jitter = self.jitter.clamp(0.0, 1.0);
        let secs = capped * (1.0 - jitter) + capped * jitter * unit.clamp(0.0, 1.0);
        Duration::from_secs_f64(secs)
    }
}

/// Execute a transaction with automatic retry on serialization failures
pub async fn execute_transaction<F, R, E>(
    pool: &PgPool,
    config: &TransactionConfig,
    f: F,
) -> Result<R, E>
where
    F: for<'c> Fn(&'c mut Transaction<'_, Postgres>) -> futures::future::BoxFuture<'c, Result<R, E>>,
    E: From<sqlx::Error> + std::fmt::Display,
{
    let mut last_error = None;
    
    for attempt in 0..=config.max_retries {
        let mut tx = begin_transaction_raw(pool, config.isolation_level).await.map_err(E::from)?;
        
        match f(&mut tx).await {
            Ok(result) => {
                tx.commit().await.map_err(E::from)?;
                return Ok(result);
            }
            Err(e) => {
                let err_str = e.to_string();
                let is_serialization = err_str.contains("40001") || err_str.contains("serialization failure");
                // Check if this is a serialization error that can be retried
                if is_serialization && attempt < config.max_retries {
                    warn!(
                        attempt = attempt + 1,
                        max_retries = config.max_retries,
                        error = %e,
                        "Transaction failed due to serialization error, retrying..."
                    );
                    last_error = Some(e);
                    
                    // Rollback is automatic on drop, but we explicitly close
                    let _ = tx.rollback().await;
                    
                    // Exponential backoff with jitter, so concurrent
                    // conflicting transactions don't retry in lock-step.
                    let delay = BackoffPolicy {
                        max_retries: config.max_retries,
                        initial_delay: config.retry_delay,
                        max_delay: config.retry_delay * 2_u32.pow(config.max_retries.min(16)),
                        multiplier: 2.0,
                        jitter: 0.5,
                    }
                    .delay_for(attempt);
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
        E::from(sqlx::Error::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            "Transaction failed after max retries",
        )))
    }))
}

/// Begin a transaction with specified isolation level (raw sqlx error)
pub async fn begin_transaction_raw(
    pool: &PgPool,
    isolation_level: IsolationLevel,
) -> Result<Transaction<'_, Postgres>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    
    // Set isolation level
    sqlx::query(&format!("SET TRANSACTION ISOLATION LEVEL {}", isolation_level.as_str()))
        .execute(&mut *tx)
        .await?;
    
    debug!(isolation_level = %isolation_level.as_str(), "Transaction started");
    
    Ok(tx)
}

/// Begin a transaction with specified isolation level
pub async fn begin_transaction(
    pool: &PgPool,
    isolation_level: IsolationLevel,
) -> Result<Transaction<'_, Postgres>, ApiError> {
    begin_transaction_raw(pool, isolation_level).await.map_err(ApiError::database_error)
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
    params: Vec<String>,
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

    fn policy(jitter: f64) -> BackoffPolicy {
        BackoffPolicy {
            max_retries: 5,
            initial_delay: Duration::from_millis(100),
            max_delay: Duration::from_millis(1_000),
            multiplier: 2.0,
            jitter,
        }
    }

    #[test]
    fn backoff_grows_exponentially_and_caps() {
        let p = policy(0.0);
        assert_eq!(p.delay_with_unit(0, 0.7), Duration::from_millis(100));
        assert_eq!(p.delay_with_unit(1, 0.7), Duration::from_millis(200));
        assert_eq!(p.delay_with_unit(2, 0.7), Duration::from_millis(400));
        assert_eq!(p.delay_with_unit(3, 0.7), Duration::from_millis(800));
        assert_eq!(p.delay_with_unit(4, 0.7), Duration::from_millis(1_000));
        assert_eq!(p.delay_with_unit(30, 0.7), Duration::from_millis(1_000));
    }

    #[test]
    fn backoff_jitter_stays_within_bounds() {
        let p = policy(0.5);
        // attempt 2 → capped 400ms; jitter keeps 200ms fixed + up to 200ms random.
        assert_eq!(p.delay_with_unit(2, 0.0), Duration::from_millis(200));
        assert_eq!(p.delay_with_unit(2, 1.0), Duration::from_millis(400));
        for _ in 0..100 {
            let d = p.delay_for(2);
            assert!(d >= Duration::from_millis(200) && d <= Duration::from_millis(400));
        }
    }
}
