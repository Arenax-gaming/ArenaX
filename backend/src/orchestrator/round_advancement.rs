use crate::api_error::ApiError;
use crate::db::DbPool;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

pub struct RoundAdvancementWorker {
    db_pool: DbPool,
}

impl RoundAdvancementWorker {
    pub fn new(db_pool: DbPool) -> Self {
        Self { db_pool }
    }

    /// Called when a tournament match finishes.
    /// Checks if all matches in the round are done (Completed or Cancelled).
    /// If yes, generates the next round's matches by pairing winners sequentially.
    /// If only 1 player remains, marks the tournament as Completed.
    pub async fn on_match_completed(
        &self,
        tournament_id: Uuid,
        round_id: Uuid,
    ) -> Result<(), ApiError> {
        // Step 1: Count pending matches in the round (status NOT IN completed, cancelled).
        let pending_row = sqlx::query(
            r#"
            SELECT COUNT(*) as pending_count
            FROM tournament_matches
            WHERE round_id = $1
              AND status NOT IN ('completed', 'cancelled')
            "#,
        )
        .bind(round_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let pending_count: i64 = pending_row
            .try_get("pending_count")
            .map_err(ApiError::database_error)?;

        if pending_count > 0 {
            return Ok(());
        }

        // Step 2: Fetch the current round to get the round_number.
        let round_row = sqlx::query("SELECT round_number FROM tournament_rounds WHERE id = $1")
            .bind(round_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or_else(|| ApiError::not_found("Round not found"))?;

        let current_round_number: i32 = round_row
            .try_get("round_number")
            .map_err(ApiError::database_error)?;

        // Step 3: Check if next round already exists (idempotency).
        let next_round_row = sqlx::query(
            r#"
            SELECT id FROM tournament_rounds
            WHERE tournament_id = $1
              AND round_number > $2
            LIMIT 1
            "#,
        )
        .bind(tournament_id)
        .bind(current_round_number)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        if next_round_row.is_some() {
            return Ok(());
        }

        // Step 4: Mark current round as Completed.
        sqlx::query(
            r#"
            UPDATE tournament_rounds
            SET status = 'completed', completed_at = $2, updated_at = $2
            WHERE id = $1
            "#,
        )
        .bind(round_id)
        .bind(Utc::now())
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        // Step 5: Collect winners from completed matches ordered by match_number.
        // For cancelled matches where player2 is None, player1 advances automatically.
        let match_rows = sqlx::query(
            r#"
            SELECT match_number, player1_id, player2_id, winner_id, status
            FROM tournament_matches
            WHERE round_id = $1
            ORDER BY match_number ASC
            "#,
        )
        .bind(round_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let mut advancing_players: Vec<Uuid> = Vec::new();

        for row in &match_rows {
            let status: String = row.try_get("status").map_err(ApiError::database_error)?;
            let player1_id: Option<Uuid> = row
                .try_get("player1_id")
                .map_err(ApiError::database_error)?;
            let player2_id: Option<Uuid> = row
                .try_get("player2_id")
                .map_err(ApiError::database_error)?;
            let winner_id: Option<Uuid> =
                row.try_get("winner_id").map_err(ApiError::database_error)?;

            if status == "completed" {
                if let Some(winner) = winner_id {
                    advancing_players.push(winner);
                }
            } else if status == "cancelled" {
                // If player2 is None (bye), player1 advances automatically.
                if player2_id.is_none() {
                    if let Some(p1) = player1_id {
                        advancing_players.push(p1);
                    }
                } else {
                    // Both players present but match cancelled — propagate player1 as bye to preserve bracket structure.
                    if let Some(p1) = player1_id {
                        advancing_players.push(p1);
                    }
                }
            }
        }

        // Step 6: If 0 or 1 players advancing, the tournament is complete.
        if advancing_players.len() <= 1 {
            sqlx::query(
                r#"
                UPDATE tournaments
                SET status = 'completed', updated_at = $2
                WHERE id = $1
                "#,
            )
            .bind(tournament_id)
            .bind(Utc::now())
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            // Trigger payout finalization
            let payout = crate::orchestrator::PayoutSettler::new(self.db_pool.clone());
            if let Err(e) = payout.finalize_tournament(tournament_id).await {
                tracing::error!(
                    "Payout finalization failed for tournament {}: {}",
                    tournament_id,
                    e
                );
                // Polling worker will retry
            }

            return Ok(());
        }

        // Step 7: Determine next round type based on player count.
        let next_round_number = current_round_number + 1;
        let round_type = match advancing_players.len() {
            2 => "final",
            3 | 4 => "semifinal",
            _ => "elimination",
        };

        // Create the next round.
        let new_round_row = sqlx::query(
            r#"
            INSERT INTO tournament_rounds (
                id, tournament_id, round_number, round_type, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, 'in_progress', $5, $5)
            RETURNING id
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(tournament_id)
        .bind(next_round_number)
        .bind(round_type)
        .bind(Utc::now())
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let new_round_id: Uuid = new_round_row
            .try_get("id")
            .map_err(ApiError::database_error)?;

        // Step 8: Pair advancing players. If there is an odd number, the first player
        // (lowest match_number from the previous round, i.e. highest seed) gets a bye.
        // Pairing then proceeds from index 1 onwards: idx 1 vs 2, idx 3 vs 4, etc.
        let now = Utc::now();
        let num_players = advancing_players.len();
        let has_bye = !num_players.is_multiple_of(2);

        // The bye player is always advancing_players[0] when the count is odd.
        // Paired players start at index 1 (odd count) or 0 (even count).
        let pair_start = if has_bye { 1 } else { 0 };
        let num_pairs = (num_players - pair_start) / 2;

        // Insert the bye match first (match_number = 1) so that it always lands at the top
        // of the bracket, keeping the highest seed's position consistent.
        let mut next_match_number: i32 = 1;

        if has_bye {
            let bye_player = advancing_players[0];

            sqlx::query(
                r#"
                INSERT INTO tournament_matches (
                    id, tournament_id, round_id, match_number,
                    player1_id, player2_id, winner_id, status, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, NULL, $5, 'completed', $6, $6)
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(tournament_id)
            .bind(new_round_id)
            .bind(next_match_number)
            .bind(bye_player)
            .bind(now)
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            next_match_number += 1;
        }

        for match_idx in 0..num_pairs {
            let player1 = advancing_players[pair_start + match_idx * 2];
            let player2 = advancing_players[pair_start + match_idx * 2 + 1];

            sqlx::query(
                r#"
                INSERT INTO tournament_matches (
                    id, tournament_id, round_id, match_number,
                    player1_id, player2_id, winner_id, status, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, NULL, 'pending', $7, $7)
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(tournament_id)
            .bind(new_round_id)
            .bind(next_match_number)
            .bind(player1)
            .bind(player2)
            .bind(now)
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            next_match_number += 1;
        }

        Ok(())
    }

    /// Polling fallback that finds in-progress tournaments where the current round has all
    /// matches done but no next round exists, and triggers `on_match_completed` for each.
    pub async fn poll_for_stale_rounds(&self) -> Result<(), ApiError> {
        // Query for tournament_rounds that are InProgress where:
        // - The tournament is InProgress
        // - All matches in the round are Completed or Cancelled
        // - No subsequent round exists (round_number > current)
        let stale_rows = sqlx::query(
            r#"
            SELECT tr.id AS round_id, tr.tournament_id
            FROM tournament_rounds tr
            WHERE tr.status = 'in_progress'
              AND EXISTS (
                  SELECT 1 FROM tournaments t
                  WHERE t.id = tr.tournament_id
                    AND t.status = 'in_progress'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM tournament_matches tm
                  WHERE tm.round_id = tr.id
                    AND tm.status NOT IN ('completed', 'cancelled')
              )
              AND NOT EXISTS (
                  SELECT 1 FROM tournament_rounds tr2
                  WHERE tr2.tournament_id = tr.tournament_id
                    AND tr2.round_number > tr.round_number
              )
              AND EXISTS (
                  SELECT 1 FROM tournament_matches tm2 WHERE tm2.round_id = tr.id
              )
            "#,
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        for row in stale_rows {
            let round_id: Uuid = row.try_get("round_id").map_err(ApiError::database_error)?;
            let tournament_id: Uuid = row
                .try_get("tournament_id")
                .map_err(ApiError::database_error)?;

            // Best-effort: log errors but continue processing other rounds.
            if let Err(e) = self.on_match_completed(tournament_id, round_id).await {
                tracing::error!(
                    tournament_id = %tournament_id,
                    round_id = %round_id,
                    error = %e,
                    "Failed to advance stale round"
                );
            }
        }

        Ok(())
    }
}
