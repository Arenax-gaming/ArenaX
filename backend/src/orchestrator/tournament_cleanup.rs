use crate::api_error::ApiError;
use crate::db::DbPool;
use chrono::Utc;
use rust_decimal::Decimal;
use sqlx::Row;
use uuid::Uuid;

pub struct CleanupConfig {
    pub stuck_match_timeout_hours: i64,
    pub stale_tournament_days: i64,
}

impl Default for CleanupConfig {
    fn default() -> Self {
        Self {
            stuck_match_timeout_hours: 24,
            stale_tournament_days: 7,
        }
    }
}

pub struct TournamentCleanup {
    db_pool: DbPool,
    config: CleanupConfig,
}

impl TournamentCleanup {
    pub fn new(db_pool: DbPool) -> Self {
        Self {
            db_pool,
            config: CleanupConfig::default(),
        }
    }

    pub fn with_config(db_pool: DbPool, config: CleanupConfig) -> Self {
        Self { db_pool, config }
    }

    /// Cleans up a completed tournament:
    /// 1. Force-cancels stuck matches that have exceeded the timeout.
    /// 2. Marks all non-winner participants as Eliminated.
    /// 3. Releases escrow balances back to participants.
    /// 4. Stamps `cleaned_up_at` on the tournament row.
    pub async fn cleanup_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        // Step 1: Force-cancel stuck matches (pending or in_progress) older than the timeout.
        let cutoff = Utc::now() - chrono::Duration::hours(self.config.stuck_match_timeout_hours);

        sqlx::query(
            r#"
            UPDATE tournament_matches
            SET status = 'cancelled'
            WHERE tournament_id = $1
              AND status IN ('pending', 'in_progress')
              AND created_at < $2
            "#,
        )
        .bind(tournament_id)
        .bind(cutoff)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        // Step 2: Mark all participants with final_rank > 1 as Eliminated (if not already).
        sqlx::query(
            r#"
            UPDATE tournament_participants
            SET status = 'Eliminated', eliminated_at = NOW()
            WHERE tournament_id = $1
              AND final_rank > 1
              AND status != 'Eliminated'
            "#,
        )
        .bind(tournament_id)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        // Step 3: Release escrow balances for all tournament participants.
        let participant_rows = sqlx::query(
            r#"
            SELECT tp.user_id, w.escrow_balance
            FROM tournament_participants tp
            JOIN wallets w ON w.user_id = tp.user_id
            WHERE tp.tournament_id = $1
              AND w.escrow_balance > 0
            "#,
        )
        .bind(tournament_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let now = Utc::now();

        for row in &participant_rows {
            let user_id: Uuid = row.try_get("user_id").map_err(ApiError::database_error)?;
            let escrow_balance: Decimal = row
                .try_get("escrow_balance")
                .map_err(ApiError::database_error)?;

            // Move escrow_balance back to balance.
            sqlx::query(
                r#"
                UPDATE wallets
                SET balance = balance + $1,
                    escrow_balance = escrow_balance - $1,
                    updated_at = $2
                WHERE user_id = $3
                "#,
            )
            .bind(escrow_balance)
            .bind(now)
            .bind(user_id)
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            // Insert a Refund transaction for the escrow release.
            let reference = format!("escrow-release-{}-{}", tournament_id, user_id);
            let description = format!("Escrow release for tournament:{}", tournament_id);

            sqlx::query(
                r#"
                INSERT INTO transactions (
                    id, user_id, transaction_type, amount, currency,
                    status, reference, description, created_at, updated_at
                ) VALUES ($1, $2, 'Refund', $3, 'NGN', 'Completed', $4, $5, $6, $6)
                ON CONFLICT (reference) DO NOTHING
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(user_id)
            .bind(escrow_balance)
            .bind(&reference)
            .bind(&description)
            .bind(now)
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;
        }

        // Step 4: Stamp cleaned_up_at on the tournament row.
        sqlx::query(
            r#"
            UPDATE tournaments
            SET cleaned_up_at = NOW(), updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(tournament_id)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        tracing::info!(
            tournament_id = %tournament_id,
            "Tournament cleanup completed successfully"
        );

        Ok(())
    }

    /// Polls for completed tournaments that haven't been cleaned up yet and cleans each one.
    /// Also logs a warning if any tournaments appear stale (in_progress for too long).
    pub async fn poll_for_cleanup(&self) -> Result<(), ApiError> {
        // Step 1: Find completed tournaments where cleaned_up_at is still NULL.
        let tournament_rows = sqlx::query(
            r#"
            SELECT id
            FROM tournaments
            WHERE status = 'completed'
              AND cleaned_up_at IS NULL
            "#,
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        for row in tournament_rows {
            let tournament_id: Uuid = row.try_get("id").map_err(ApiError::database_error)?;

            if let Err(e) = self.cleanup_tournament(tournament_id).await {
                tracing::error!(
                    tournament_id = %tournament_id,
                    error = %e,
                    "Failed to clean up tournament"
                );
            }
        }

        // Step 2: Count stale tournaments (in_progress longer than stale_tournament_days).
        let stale_cutoff =
            Utc::now() - chrono::Duration::days(self.config.stale_tournament_days);

        let stale_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS cnt
            FROM tournaments
            WHERE status = 'in_progress'
              AND updated_at < $1
            "#,
        )
        .bind(stale_cutoff)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let stale_count: i64 = stale_row.try_get("cnt").map_err(ApiError::database_error)?;

        if stale_count > 0 {
            tracing::warn!(
                stale_count = stale_count,
                stale_threshold_days = self.config.stale_tournament_days,
                "Detected stale in-progress tournaments that have not been updated recently"
            );
        }

        Ok(())
    }
}
