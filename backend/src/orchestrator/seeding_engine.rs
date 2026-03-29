use crate::api_error::ApiError;
use crate::db::DbPool;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

pub struct SeedingEngine {
    db_pool: DbPool,
}

impl SeedingEngine {
    pub fn new(db_pool: DbPool) -> Self {
        Self { db_pool }
    }

    /// Seeds participants by Elo and generates the initial single-elimination bracket.
    /// Tournament must be in RegistrationClosed status with 4-64 participants.
    pub async fn seed_and_generate_bracket(
        &self,
        tournament_id: Uuid,
    ) -> Result<(), ApiError> {
        // Validate tournament status
        let row = sqlx::query(
            "SELECT status, game, bracket_type FROM tournaments WHERE id = $1",
        )
        .bind(tournament_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?
        .ok_or_else(|| ApiError::not_found("Tournament not found"))?;

        let status: String = row.try_get("status").map_err(ApiError::database_error)?;
        if status != "registration_closed" && status != "in_progress" {
            return Err(ApiError::bad_request(
                "Tournament must be in RegistrationClosed or InProgress status to seed",
            ));
        }

        // Only single elimination is supported
        let bracket_type: String = row.try_get("bracket_type").map_err(ApiError::database_error)?;
        if bracket_type.to_lowercase() != "singleelimination" && bracket_type.to_lowercase() != "single_elimination" {
            return Err(ApiError::bad_request(
                "Only SingleElimination bracket type is currently supported for automated seeding",
            ));
        }

        let game: String = row.try_get("game").map_err(ApiError::database_error)?;

        // Fetch active participants with their Elo ratings
        let participants: Vec<ParticipantWithElo> = sqlx::query_as::<_, ParticipantWithElo>(
            r#"
            SELECT tp.id, tp.user_id, tp.registered_at,
                   COALESCE(ue.current_rating, 1200) as elo
            FROM tournament_participants tp
            LEFT JOIN user_elo ue ON ue.user_id = tp.user_id AND ue.game = $2
            WHERE tp.tournament_id = $1
              AND (tp.status = 'active' OR tp.status = 'paid')
            ORDER BY COALESCE(ue.current_rating, 1200) DESC, tp.registered_at ASC
            "#,
        )
        .bind(tournament_id)
        .bind(game)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let n = participants.len();
        if n < 4 {
            return Err(ApiError::bad_request(
                "Minimum 4 participants required for seeding",
            ));
        }
        if n > 64 {
            return Err(ApiError::bad_request(
                "Maximum 64 participants allowed",
            ));
        }

        // Assign seed numbers (1 = highest Elo)
        for (idx, p) in participants.iter().enumerate() {
            let seed = (idx + 1) as i32;
            sqlx::query(
                "UPDATE tournament_participants SET seed_number = $1, status = 'active' WHERE id = $2",
            )
            .bind(seed)
            .bind(p.id)
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;
        }

        // Compute bracket size (next power of 2)
        let bracket_size = n.next_power_of_two();

        // Generate standard seeding order for the bracket
        let seeding_order = generate_bracket_order(bracket_size);

        // Create round 1
        let round_type = if bracket_size == 2 { "final" } else { "elimination" };
        let round_row = sqlx::query(
            r#"
            INSERT INTO tournament_rounds (
                id, tournament_id, round_number, round_type, status, created_at, updated_at
            ) VALUES ($1, $2, 1, $3, $4, $5, $5)
            RETURNING id
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(tournament_id)
        .bind(round_type)
        .bind("in_progress")
        .bind(Utc::now())
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let round_id: Uuid = round_row.try_get("id").map_err(ApiError::database_error)?;
        let num_matches = bracket_size / 2;

        for match_idx in 0..num_matches {
            let seed_a = seeding_order[match_idx * 2];     // 1-indexed seed
            let seed_b = seeding_order[match_idx * 2 + 1]; // 1-indexed seed

            // Seeds beyond participant count are byes
            let player_a_id = if seed_a <= n {
                Some(participants[seed_a - 1].user_id)
            } else {
                None
            };
            let player_b_id = if seed_b <= n {
                Some(participants[seed_b - 1].user_id)
            } else {
                None
            };

            let is_bye = player_a_id.is_none() || player_b_id.is_none();
            let winner_id: Option<Uuid> = if is_bye {
                player_a_id.or(player_b_id)
            } else {
                None
            };
            let match_status = if is_bye { "completed" } else { "pending" };

            let match_number = (match_idx + 1) as i32;

            // For byes, ensure the real player is player1
            let (p1, p2): (Uuid, Option<Uuid>) =
                if player_a_id.is_some() && player_b_id.is_some() {
                    (player_a_id.unwrap(), player_b_id)
                } else if player_a_id.is_some() {
                    (player_a_id.unwrap(), None)
                } else {
                    (player_b_id.unwrap(), None)
                };

            sqlx::query(
                r#"
                INSERT INTO tournament_matches (
                    id, tournament_id, round_id, match_number, player1_id, player2_id,
                    winner_id, status, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(tournament_id)
            .bind(round_id)
            .bind(match_number)
            .bind(p1)
            .bind(p2)
            .bind(winner_id)
            .bind(match_status)
            .bind(Utc::now())
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;
        }

        // Update tournament status to InProgress
        sqlx::query(
            "UPDATE tournaments SET status = 'in_progress', updated_at = $2 WHERE id = $1",
        )
        .bind(tournament_id)
        .bind(Utc::now())
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(())
    }
}

/// Helper struct for the seeding query
#[derive(sqlx::FromRow)]
struct ParticipantWithElo {
    pub id: Uuid,
    pub user_id: Uuid,
    pub registered_at: chrono::DateTime<Utc>,
    pub elo: Option<i32>,
}

/// Generates standard tournament bracket seeding order.
/// For bracket_size=8: returns [1, 8, 4, 5, 2, 7, 3, 6]
/// This ensures seed 1 and 2 can only meet in the final.
fn generate_bracket_order(bracket_size: usize) -> Vec<usize> {
    if bracket_size == 1 {
        return vec![1];
    }

    let mut order = vec![1, 2];

    while order.len() < bracket_size {
        let current_size = order.len();
        let next_sum = current_size * 2 + 1; // sum of paired seeds
        let mut next_order = Vec::with_capacity(current_size * 2);
        for &seed in &order {
            next_order.push(seed);
            next_order.push(next_sum - seed);
        }
        order = next_order;
    }

    order
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bracket_order_4() {
        let order = generate_bracket_order(4);
        assert_eq!(order, vec![1, 4, 2, 3]);
    }

    #[test]
    fn test_bracket_order_8() {
        let order = generate_bracket_order(8);
        assert_eq!(order, vec![1, 8, 4, 5, 2, 7, 3, 6]);
    }

    #[test]
    fn test_bracket_order_16() {
        let order = generate_bracket_order(16);
        assert_eq!(order.len(), 16);
        assert_eq!(order[0], 1);
        assert_eq!(order[1], 16);
        let first_half: Vec<_> = order[..8].to_vec();
        let second_half: Vec<_> = order[8..].to_vec();
        assert!(first_half.contains(&1));
        assert!(second_half.contains(&2));
    }

    #[test]
    fn test_bracket_order_pairs_sum() {
        for size in [4, 8, 16, 32, 64] {
            let order = generate_bracket_order(size);
            for pair in order.chunks(2) {
                assert_eq!(pair[0] + pair[1], size + 1);
            }
        }
    }
}
