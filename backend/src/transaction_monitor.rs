use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Transaction metrics for monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionMetrics {
    pub transaction_id: Uuid,
    pub operation: String,
    pub isolation_level: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub duration_ms: Option<i64>,
    pub status: TransactionStatus,
    pub retry_count: u32,
    pub error_message: Option<String>,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "transaction_status", rename_all = "lowercase")]
pub enum TransactionStatus {
    Started,
    Completed,
    Failed,
    Retried,
    RolledBack,
}

/// Transaction monitor for analytics and debugging
pub struct TransactionMonitor {
    db_pool: Arc<PgPool>,
    enabled: bool,
}

impl TransactionMonitor {
    pub fn new(db_pool: Arc<PgPool>, enabled: bool) -> Self {
        Self { db_pool, enabled }
    }

    /// Record transaction start
    pub async fn record_start(
        &self,
        operation: String,
        isolation_level: String,
    ) -> Result<Uuid, sqlx::Error> {
        if !self.enabled {
            return Ok(Uuid::new_v4());
        }

        let transaction_id = Uuid::new_v4();
        let now = Utc::now();

        sqlx::query!(
            r#"
            INSERT INTO transaction_monitor (
                id, operation, isolation_level, started_at, status, retry_count, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            transaction_id,
            operation,
            isolation_level,
            now,
            TransactionStatus::Started as TransactionStatus,
            0i32,
            serde_json::json!({})
        )
        .execute(&*self.db_pool)
        .await?;

        debug!(
            transaction_id = %transaction_id,
            operation = %operation,
            "Transaction started"
        );

        Ok(transaction_id)
    }

    /// Record transaction completion
    pub async fn record_completion(
        &self,
        transaction_id: Uuid,
        duration_ms: i64,
    ) -> Result<(), sqlx::Error> {
        if !self.enabled {
            return Ok(());
        }

        let now = Utc::now();

        sqlx::query!(
            r#"
            UPDATE transaction_monitor
            SET completed_at = $1,
                duration_ms = $2,
                status = $3
            WHERE id = $4
            "#,
            now,
            duration_ms,
            TransactionStatus::Completed as TransactionStatus,
            transaction_id
        )
        .execute(&*self.db_pool)
        .await?;

        debug!(
            transaction_id = %transaction_id,
            duration_ms = duration_ms,
            "Transaction completed"
        );

        Ok(())
    }

    /// Record transaction failure
    pub async fn record_failure(
        &self,
        transaction_id: Uuid,
        error_message: String,
        duration_ms: i64,
    ) -> Result<(), sqlx::Error> {
        if !self.enabled {
            return Ok(());
        }

        let now = Utc::now();

        sqlx::query!(
            r#"
            UPDATE transaction_monitor
            SET completed_at = $1,
                duration_ms = $2,
                status = $3,
                error_message = $4
            WHERE id = $5
            "#,
            now,
            duration_ms,
            TransactionStatus::Failed as TransactionStatus,
            error_message,
            transaction_id
        )
        .execute(&*self.db_pool)
        .await?;

        error!(
            transaction_id = %transaction_id,
            error = %error_message,
            duration_ms = duration_ms,
            "Transaction failed"
        );

        Ok(())
    }

    /// Record transaction retry
    pub async fn record_retry(
        &self,
        transaction_id: Uuid,
        retry_count: u32,
    ) -> Result<(), sqlx::Error> {
        if !self.enabled {
            return Ok(());
        }

        sqlx::query!(
            r#"
            UPDATE transaction_monitor
            SET retry_count = $1,
                status = $2
            WHERE id = $3
            "#,
            retry_count as i32,
            TransactionStatus::Retried as TransactionStatus,
            transaction_id
        )
        .execute(&*self.db_pool)
        .await?;

        warn!(
            transaction_id = %transaction_id,
            retry_count = retry_count,
            "Transaction retried"
        );

        Ok(())
    }

    /// Record transaction rollback
    pub async fn record_rollback(
        &self,
        transaction_id: Uuid,
        reason: String,
    ) -> Result<(), sqlx::Error> {
        if !self.enabled {
            return Ok(());
        }

        let now = Utc::now();

        sqlx::query!(
            r#"
            UPDATE transaction_monitor
            SET completed_at = $1,
                status = $2,
                error_message = $3
            WHERE id = $4
            "#,
            now,
            TransactionStatus::RolledBack as TransactionStatus,
            reason,
            transaction_id
        )
        .execute(&*self.db_pool)
        .await?;

        warn!(
            transaction_id = %transaction_id,
            reason = %reason,
            "Transaction rolled back"
        );

        Ok(())
    }

    /// Get transaction metrics for a time period
    pub async fn get_metrics(
        &self,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
    ) -> Result<Vec<TransactionMetrics>, sqlx::Error> {
        if !self.enabled {
            return Ok(vec![]);
        }

        let metrics = sqlx::query_as!(
            TransactionMetrics,
            r#"
            SELECT
                id as transaction_id,
                operation,
                isolation_level,
                started_at,
                completed_at,
                duration_ms,
                status as "status: TransactionStatus",
                retry_count,
                error_message,
                metadata
            FROM transaction_monitor
            WHERE started_at >= $1 AND started_at <= $2
            ORDER BY started_at DESC
            "#,
            start_time,
            end_time
        )
        .fetch_all(&*self.db_pool)
        .await?;

        Ok(metrics)
    }

    /// Get transaction statistics
    pub async fn get_statistics(
        &self,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
    ) -> Result<TransactionStatistics, sqlx::Error> {
        if !self.enabled {
            return Ok(TransactionStatistics::default());
        }

        let stats = sqlx::query!(
            r#"
            SELECT
                COUNT(*) as total_transactions,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_transactions,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_transactions,
                COUNT(CASE WHEN status = 'retried' THEN 1 END) as retried_transactions,
                COUNT(CASE WHEN status = 'rolled_back' THEN 1 END) as rolled_back_transactions,
                AVG(duration_ms) as avg_duration_ms,
                MAX(duration_ms) as max_duration_ms,
                MIN(duration_ms) as min_duration_ms,
                AVG(retry_count) as avg_retry_count
            FROM transaction_monitor
            WHERE started_at >= $1 AND started_at <= $2
            "#,
            start_time,
            end_time
        )
        .fetch_one(&*self.db_pool)
        .await?;

        Ok(TransactionStatistics {
            total_transactions: stats.total_transactions.unwrap_or(0) as i64,
            completed_transactions: stats.completed_transactions.unwrap_or(0) as i64,
            failed_transactions: stats.failed_transactions.unwrap_or(0) as i64,
            retried_transactions: stats.retried_transactions.unwrap_or(0) as i64,
            rolled_back_transactions: stats.rolled_back_transactions.unwrap_or(0) as i64,
            avg_duration_ms: stats.avg_duration_ms,
            max_duration_ms: stats.max_duration_ms,
            min_duration_ms: stats.min_duration_ms,
            avg_retry_count: stats.avg_retry_count,
        })
    }

    /// Detect potential deadlocks (long-running transactions)
    pub async fn detect_long_running_transactions(
        &self,
        threshold_seconds: i64,
    ) -> Result<Vec<TransactionMetrics>, sqlx::Error> {
        if !self.enabled {
            return Ok(vec![]);
        }

        let threshold = chrono::Duration::seconds(threshold_seconds);
        let cutoff_time = Utc::now() - threshold;

        let long_running = sqlx::query_as!(
            TransactionMetrics,
            r#"
            SELECT
                id as transaction_id,
                operation,
                isolation_level,
                started_at,
                completed_at,
                duration_ms,
                status as "status: TransactionStatus",
                retry_count,
                error_message,
                metadata
            FROM transaction_monitor
            WHERE started_at < $1
              AND completed_at IS NULL
              AND status = 'started'
            ORDER BY started_at ASC
            "#,
            cutoff_time
        )
        .fetch_all(&*self.db_pool)
        .await?;

        if !long_running.is_empty() {
            warn!(
                count = long_running.len(),
                threshold_seconds = threshold_seconds,
                "Detected long-running transactions"
            );
        }

        Ok(long_running)
    }

    /// Cleanup old transaction records
    pub async fn cleanup_old_records(&self, older_than_days: i64) -> Result<u64, sqlx::Error> {
        if !self.enabled {
            return Ok(0);
        }

        let cutoff_time = Utc::now() - chrono::Duration::days(older_than_days);

        let result = sqlx::query!(
            "DELETE FROM transaction_monitor WHERE started_at < $1",
            cutoff_time
        )
        .execute(&*self.db_pool)
        .await?;

        info!(
            deleted_count = result.rows_affected(),
            older_than_days = older_than_days,
            "Cleaned up old transaction records"
        );

        Ok(result.rows_affected())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionStatistics {
    pub total_transactions: i64,
    pub completed_transactions: i64,
    pub failed_transactions: i64,
    pub retried_transactions: i64,
    pub rolled_back_transactions: i64,
    pub avg_duration_ms: Option<f64>,
    pub max_duration_ms: Option<i64>,
    pub min_duration_ms: Option<i64>,
    pub avg_retry_count: Option<f64>,
}

impl Default for TransactionStatistics {
    fn default() -> Self {
        Self {
            total_transactions: 0,
            completed_transactions: 0,
            failed_transactions: 0,
            retried_transactions: 0,
            rolled_back_transactions: 0,
            avg_duration_ms: None,
            max_duration_ms: None,
            min_duration_ms: None,
            avg_retry_count: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transaction_statistics_default() {
        let stats = TransactionStatistics::default();
        assert_eq!(stats.total_transactions, 0);
        assert_eq!(stats.completed_transactions, 0);
    }
}
