use crate::api_error::ApiError;
use crate::db::DbPool;
use chrono::Utc;
use rust_decimal::Decimal;
use sqlx::Row;
use uuid::Uuid;

pub struct PayoutSettler {
    db_pool: DbPool,
}

impl PayoutSettler {
    pub fn new(db_pool: DbPool) -> Self {
        Self { db_pool }
    }

    /// Called when a tournament completes. Computes rankings and distributes prizes idempotently.
    pub async fn finalize_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        // Step 1: Verify tournament status is "Completed" (case-insensitive).
        let tournament_row = sqlx::query(
            "SELECT status FROM tournaments WHERE id = $1",
        )
        .bind(tournament_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?
        .ok_or_else(|| ApiError::not_found("Tournament not found"))?;

        let status: String = tournament_row
            .try_get("status")
            .map_err(ApiError::database_error)?;

        if status.to_lowercase() != "completed" {
            return Err(ApiError::bad_request(
                "Tournament must be in Completed status to finalize payouts",
            ));
        }

        // Step 2: Idempotency check — skip if Prize transactions already exist for this tournament.
        let existing_row = sqlx::query(
            r#"
            SELECT COUNT(*) as cnt
            FROM transactions
            WHERE description LIKE $1
              AND transaction_type = 'Prize'
            "#,
        )
        .bind(format!("%tournament:{}%", tournament_id))
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let existing_count: i64 = existing_row
            .try_get("cnt")
            .map_err(ApiError::database_error)?;

        if existing_count > 0 {
            tracing::info!(
                tournament_id = %tournament_id,
                "Payouts already exist for tournament — skipping"
            );
            return Ok(());
        }

        // Step 3: Compute rankings for all participants.
        self.compute_rankings(tournament_id).await?;

        // Step 4: Get prize pool.
        let prize_pool_row = sqlx::query(
            "SELECT total_amount, currency, distribution_percentages FROM prize_pools WHERE tournament_id = $1",
        )
        .bind(tournament_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?
        .ok_or_else(|| ApiError::not_found("Prize pool not found for tournament"))?;

        let total_amount: i64 = prize_pool_row
            .try_get("total_amount")
            .map_err(ApiError::database_error)?;
        let currency: String = prize_pool_row
            .try_get("currency")
            .map_err(ApiError::database_error)?;
        let distribution_percentages_str: String = prize_pool_row
            .try_get("distribution_percentages")
            .map_err(ApiError::database_error)?;

        // Step 5: Parse distribution_percentages from JSON string (e.g., "[50, 30, 20]").
        let percentages: Vec<f64> = serde_json::from_str(&distribution_percentages_str)
            .map_err(|e| ApiError::bad_request(format!("Invalid distribution_percentages JSON: {}", e)))?;

        if percentages.is_empty() {
            return Err(ApiError::bad_request("distribution_percentages must not be empty"));
        }

        // Step 6: Get ranked participants ordered by final_rank ASC.
        let participant_rows = sqlx::query(
            r#"
            SELECT user_id, final_rank
            FROM tournament_participants
            WHERE tournament_id = $1
              AND final_rank IS NOT NULL
            ORDER BY final_rank ASC
            "#,
        )
        .bind(tournament_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        // Step 7: Execute payouts in a single DB transaction.
        let mut tx = self.db_pool.begin().await.map_err(ApiError::database_error)?;

        let now = Utc::now();
        let num_recipients = percentages.len().min(participant_rows.len());

        for i in 0..num_recipients {
            let row = &participant_rows[i];
            let user_id: Uuid = row.try_get("user_id").map_err(ApiError::database_error)?;
            let rank: i32 = row.try_get("final_rank").map_err(ApiError::database_error)?;
            let percentage = percentages[i];

            let prize_amount = (total_amount as f64 * percentage / 100.0) as i64;
            let reference = format!("prize-{}-{}", tournament_id, user_id);
            let description = format!(
                "Tournament prize payout tournament:{} rank:{}",
                tournament_id, rank
            );

            // UPDATE tournament_participants with prize_amount and prize_currency.
            sqlx::query(
                r#"
                UPDATE tournament_participants
                SET prize_amount = $1, prize_currency = $2
                WHERE tournament_id = $3 AND user_id = $4
                "#,
            )
            .bind(prize_amount)
            .bind(&currency)
            .bind(tournament_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::database_error)?;

            // UPDATE wallets — credit balance_ngn.
            sqlx::query(
                r#"
                UPDATE wallets
                SET balance_ngn = COALESCE(balance_ngn, 0) + $1
                WHERE user_id = $2
                "#,
            )
            .bind(prize_amount)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::database_error)?;

            // INSERT into transactions.
            sqlx::query(
                r#"
                INSERT INTO transactions (
                    id, user_id, transaction_type, amount, currency,
                    status, reference, description, created_at, updated_at, completed_at
                ) VALUES ($1, $2, 'Prize', $3, $4, 'Completed', $5, $6, $7, $7, $7)
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(user_id)
            .bind(Decimal::from(prize_amount))
            .bind(&currency)
            .bind(&reference)
            .bind(&description)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::database_error)?;
        }

        // Step 8: Commit the transaction.
        tx.commit().await.map_err(ApiError::database_error)?;

        tracing::info!(
            tournament_id = %tournament_id,
            num_recipients = num_recipients,
            "Prize payouts committed successfully"
        );

        Ok(())
    }

    /// Assigns `final_rank` to all participants based on round-by-round results (bottom-up).
    async fn compute_rankings(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        // Step 1: Get all rounds ordered by round_number DESC (final round first).
        let round_rows = sqlx::query(
            r#"
            SELECT id, round_number
            FROM tournament_rounds
            WHERE tournament_id = $1
            ORDER BY round_number DESC
            "#,
        )
        .bind(tournament_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        if round_rows.is_empty() {
            return Err(ApiError::bad_request("No rounds found for tournament"));
        }

        let mut current_rank: i32 = 1;

        // Step 2: Walk bottom-up (final round first due to DESC order).
        for (iteration, round_row) in round_rows.iter().enumerate() {
            let round_id: Uuid = round_row.try_get("id").map_err(ApiError::database_error)?;

            // Fetch completed matches in this round.
            let match_rows = sqlx::query(
                r#"
                SELECT winner_id, player1_id, player2_id
                FROM tournament_matches
                WHERE round_id = $1
                  AND status = 'completed'
                "#,
            )
            .bind(round_id)
            .fetch_all(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            if iteration == 0 {
                // Final round: winner = rank 1, loser = rank 2.
                let mut winner_id: Option<Uuid> = None;
                let mut loser_id: Option<Uuid> = None;

                for m in &match_rows {
                    let w: Option<Uuid> = m.try_get("winner_id").map_err(ApiError::database_error)?;
                    let p1: Option<Uuid> = m.try_get("player1_id").map_err(ApiError::database_error)?;
                    let p2: Option<Uuid> = m.try_get("player2_id").map_err(ApiError::database_error)?;

                    if let Some(w_id) = w {
                        winner_id = Some(w_id);
                        // Loser is whichever player isn't the winner.
                        loser_id = if p1 == Some(w_id) { p2 } else { p1 };
                    }
                }

                if let Some(w_id) = winner_id {
                    sqlx::query(
                        "UPDATE tournament_participants SET final_rank = $1 WHERE tournament_id = $2 AND user_id = $3",
                    )
                    .bind(current_rank)
                    .bind(tournament_id)
                    .bind(w_id)
                    .execute(&self.db_pool)
                    .await
                    .map_err(ApiError::database_error)?;
                }

                current_rank += 1; // rank 2

                if let Some(l_id) = loser_id {
                    sqlx::query(
                        "UPDATE tournament_participants SET final_rank = $1 WHERE tournament_id = $2 AND user_id = $3",
                    )
                    .bind(current_rank)
                    .bind(tournament_id)
                    .bind(l_id)
                    .execute(&self.db_pool)
                    .await
                    .map_err(ApiError::database_error)?;
                }

                current_rank += 1; // rank 3 for the next round's losers
            } else {
                // Earlier rounds: losers of completed matches get current_rank.
                let mut loser_count = 0i32;

                for m in &match_rows {
                    let w: Option<Uuid> = m.try_get("winner_id").map_err(ApiError::database_error)?;
                    let p1: Option<Uuid> = m.try_get("player1_id").map_err(ApiError::database_error)?;
                    let p2: Option<Uuid> = m.try_get("player2_id").map_err(ApiError::database_error)?;

                    // Only real matches (both players present) produce a loser.
                    if p2.is_none() {
                        continue;
                    }

                    if let Some(w_id) = w {
                        let loser = if p1 == Some(w_id) { p2 } else { p1 };
                        if let Some(l_id) = loser {
                            sqlx::query(
                                "UPDATE tournament_participants SET final_rank = $1 WHERE tournament_id = $2 AND user_id = $3",
                            )
                            .bind(current_rank)
                            .bind(tournament_id)
                            .bind(l_id)
                            .execute(&self.db_pool)
                            .await
                            .map_err(ApiError::database_error)?;

                            loser_count += 1;
                        }
                    }
                }

                current_rank += loser_count;
            }
        }

        // Step 3: Mark all participants with final_rank > 1 as 'Eliminated'.
        sqlx::query(
            r#"
            UPDATE tournament_participants
            SET status = 'Eliminated'
            WHERE tournament_id = $1
              AND final_rank > 1
            "#,
        )
        .bind(tournament_id)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(())
    }

    /// Finds completed tournaments without payouts and triggers finalization.
    pub async fn poll_for_unfinalized(&self) -> Result<(), ApiError> {
        let tournament_rows = sqlx::query(
            r#"
            SELECT id
            FROM tournaments
            WHERE status = 'completed'
              AND cleaned_up_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM transactions t
                  WHERE t.description LIKE CONCAT('%tournament:', tournaments.id::text, '%')
                    AND t.transaction_type = 'Prize'
              )
            "#,
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        for row in tournament_rows {
            let tournament_id: Uuid = row.try_get("id").map_err(ApiError::database_error)?;

            if let Err(e) = self.finalize_tournament(tournament_id).await {
                tracing::error!(
                    tournament_id = %tournament_id,
                    error = %e,
                    "Failed to finalize tournament payouts"
                );
            }
        }

        Ok(())
    }
}
