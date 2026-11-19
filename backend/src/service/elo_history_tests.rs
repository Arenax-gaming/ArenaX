//! ELO history snapshot storage (Issue #1400).
//!
//! Requires a migrated PostgreSQL database; returns early when
//! `TEST_DATABASE_URL` (or the local default) is unreachable, matching the
//! other DB-backed service tests in this crate.

#[cfg(test)]
mod tests {
    use crate::service::matchmaker::EloEngine;
    use sqlx::PgPool;
    use uuid::Uuid;

    async fn test_pool() -> Option<PgPool> {
        let database_url = std::env::var("TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://test:test@localhost/arenax_test".to_string());
        PgPool::connect(&database_url).await.ok()
    }

    async fn insert_user(pool: &PgPool, suffix: &str, index: usize) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO users (id, phone_number, username, email) VALUES ($1, $2, $3, $4)",
        )
        .bind(id)
        .bind(format!("+23480{}{}", index, &suffix[..6]))
        .bind(format!("elo_{}_{}", index, &suffix[..8]))
        .bind(format!("elo_{}_{}@example.com", index, &suffix[..8]))
        .execute(pool)
        .await
        .expect("insert test user");
        id
    }

    #[tokio::test]
    async fn resolved_match_writes_immutable_elo_history_with_correct_delta() {
        let Some(pool) = test_pool().await else {
            return;
        };

        let suffix = Uuid::new_v4().simple().to_string();
        let player1 = insert_user(&pool, &suffix, 0).await;
        let player2 = insert_user(&pool, &suffix, 1).await;

        let game = "checkers";
        for (player, rating) in [(player1, 1200), (player2, 1200)] {
            sqlx::query(
                r#"INSERT INTO user_elo (id, user_id, game, current_rating, peak_rating)
                   VALUES ($1, $2, $3, $4, $4)"#,
            )
            .bind(Uuid::new_v4())
            .bind(player)
            .bind(game)
            .bind(rating)
            .execute(&pool)
            .await
            .expect("insert user_elo");
        }

        let match_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO matches (
                   id, match_type, status, player1_id, player2_id, winner_id,
                   player1_elo_before, player2_elo_before, game_mode
               ) VALUES ($1, 1, 3, $2, $3, $2, 1200, 1200, $4)"#,
        )
        .bind(match_id)
        .bind(player1)
        .bind(player2)
        .bind(game)
        .execute(&pool)
        .await
        .expect("insert resolved match");

        // Resolve the match's ELO update: player1 wins.
        let engine = EloEngine::new(32.0);
        engine
            .update_elo_ratings(&pool, match_id, Some(player1))
            .await
            .expect("update ELO ratings");

        let rows: Vec<(Uuid, i32, i32, i32, i32)> = sqlx::query_as(
            r#"SELECT user_id, rating_before, rating_after, rating_change, opponent_rating
                 FROM elo_history
                WHERE match_id = $1
                ORDER BY user_id"#,
        )
        .bind(match_id)
        .fetch_all(&pool)
        .await
        .expect("read elo_history");

        assert_eq!(rows.len(), 2, "one snapshot per player per match");

        for (user_id, before, after, delta, opponent_rating) in &rows {
            assert_eq!(*after, *before + *delta, "delta must equal post minus pre");
            assert_eq!(*opponent_rating, 1200);
            assert_eq!(
                *user_id == player1 || *user_id == player2,
                true,
                "unexpected player id in history"
            );
        }

        // Winner gains, loser loses the same amount (zero-sum, K=32, equal ELO).
        let winner = rows.iter().find(|row| row.0 == player1).unwrap();
        let loser = rows.iter().find(|row| row.0 == player2).unwrap();
        assert!(winner.3 > 0, "winner's rating must increase");
        assert!(loser.3 < 0, "loser's rating must decrease");
        assert_eq!(winner.3, -loser.3);

        // Append-only: UPDATE and DELETE are rejected by the migration trigger.
        let update = sqlx::query("UPDATE elo_history SET rating_after = rating_after + 1 WHERE match_id = $1")
            .bind(match_id)
            .execute(&pool)
            .await;
        assert!(update.is_err(), "elo_history must reject updates");

        let delete = sqlx::query("DELETE FROM elo_history WHERE match_id = $1")
            .bind(match_id)
            .execute(&pool)
            .await;
        assert!(delete.is_err(), "elo_history must reject deletes");

        // Cleanup. The immutability trigger deliberately blocks ordinary
        // deletes, so a maintenance delete temporarily disables it (the test
        // owns the schema, unlike application code).
        let _ = sqlx::query("ALTER TABLE elo_history DISABLE TRIGGER trg_elo_history_immutable")
            .execute(&pool)
            .await;
        let _ = sqlx::query("DELETE FROM elo_history WHERE user_id = ANY($1)")
            .bind(&[player1, player2][..])
            .execute(&pool)
            .await;
        let _ = sqlx::query("ALTER TABLE elo_history ENABLE TRIGGER trg_elo_history_immutable")
            .execute(&pool)
            .await;
        let _ = sqlx::query("DELETE FROM matches WHERE id = $1")
            .bind(match_id)
            .execute(&pool)
            .await;
        sqlx::query("DELETE FROM user_elo WHERE user_id = ANY($1)")
            .bind(&[player1, player2][..])
            .execute(&pool)
            .await
            .ok();
        sqlx::query("DELETE FROM users WHERE id = ANY($1)")
            .bind(&[player1, player2][..])
            .execute(&pool)
            .await
            .ok();
    }
}
