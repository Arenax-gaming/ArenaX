//! Tournament waitlist behaviour (Issue #1401).
//!
//! These tests need a migrated PostgreSQL database. When `TEST_DATABASE_URL`
//! (or the default local URL) is unreachable they return early — the same
//! convention used by `tournament_refund_tests`.

#[cfg(test)]
mod tests {
    use crate::models::tournament::WaitlistStatus;
    use crate::service::tournament_service::TournamentService;
    use chrono::{Duration, Utc};
    use sqlx::PgPool;
    use uuid::Uuid;

    async fn test_pool() -> Option<PgPool> {
        let base = std::env::var("TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://test:test@localhost/arenax_test".to_string());
        // Tournament tables are protected by FORCE ROW LEVEL SECURITY; the
        // superadmin session GUC lets the fixture set them up and tear them
        // down from a plain pooled connection.
        let separator = if base.contains('?') { '&' } else { '?' };
        let database_url = format!(
            "{base}{separator}options=-c%20app.is_superadmin%3Dtrue"
        );
        PgPool::connect(&database_url).await.ok()
    }

    async fn insert_user(pool: &PgPool, suffix: &str, index: usize) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO users (id, phone_number, username, email)
               VALUES ($1, $2, $3, $4)"#,
        )
        .bind(id)
        .bind(format!("+23470{}{}", index, &suffix[..6]))
        .bind(format!("waitlist_{}_{}", index, &suffix[..8]))
        .bind(format!("waitlist_{}_{}@example.com", index, &suffix[..8]))
        .execute(pool)
        .await
        .expect("insert test user");
        id
    }

    #[tokio::test]
    async fn waitlisted_player_is_promoted_when_registration_is_cancelled() {
        let Some(pool) = test_pool().await else {
            return;
        };

        let service = TournamentService::new(pool.clone());
        let suffix = Uuid::new_v4().simple().to_string();

        let organizer = insert_user(&pool, &suffix, 0).await;
        let registered = insert_user(&pool, &suffix, 1).await;
        let waitlisted = insert_user(&pool, &suffix, 2).await;

        let tournament_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO tournaments (
                   id, name, game, max_participants, entry_fee, entry_fee_currency,
                   prize_pool, prize_pool_currency, status, start_time,
                   registration_deadline, created_by, bracket_type
               ) VALUES ($1, $2, $3, 2, 0, 'NGN', 0, 'NGN', 2, $4, $5, $6, 0)"#,
        )
        .bind(tournament_id)
        .bind("Waitlist Test Cup")
        .bind("checkers")
        .bind(Utc::now() + Duration::hours(2))
        .bind(Utc::now() + Duration::hours(1))
        .bind(organizer)
        .execute(&pool)
        .await
        .expect("insert test tournament");

        // Fill the tournament: organizer + registered player.
        for user_id in [organizer, registered] {
            sqlx::query(
                r#"INSERT INTO tournament_participants
                       (id, tournament_id, user_id, entry_fee_paid, status)
                   VALUES ($1, $2, $3, true, 0)"#,
            )
            .bind(Uuid::new_v4())
            .bind(tournament_id)
            .bind(user_id)
            .execute(&pool)
            .await
            .expect("insert participant");
        }

        // A third player joins the full tournament: free (entry fee 0), so the
        // waitlist path never touches a wallet.
        let outcome = service
            .join_tournament(
                waitlisted,
                tournament_id,
                crate::models::tournament::JoinTournamentRequest {
                    payment_method: "arenax_token".to_string(),
                    payment_reference: None,
                },
            )
            .await
            .expect("joining a full tournament must succeed via the waitlist");

        let position = match &outcome {
            crate::models::tournament::JoinTournamentOutcome::Waitlisted { position, .. } => {
                *position
            }
            _ => panic!("expected the player to be waitlisted"),
        };
        assert_eq!(position, 1);

        let status = service
            .get_waitlist_status(waitlisted, tournament_id)
            .await
            .expect("waitlist status");
        assert!(status.waitlisted);
        assert_eq!(status.status, Some(WaitlistStatus::Waiting));

        // A registered player withdraws: the first waiting player must take
        // the freed slot and be notified.
        let result = service
            .withdraw_from_tournament(registered, tournament_id)
            .await
            .expect("withdrawal");

        assert_eq!(result.promoted_user_id, Some(waitlisted));

        let promoted_participant: Option<(i32,)> = sqlx::query_as(
            "SELECT status FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2",
        )
        .bind(tournament_id)
        .bind(waitlisted)
        .fetch_optional(&pool)
        .await
        .expect("read promoted participant");

        assert_eq!(
            promoted_participant.map(|row| row.0),
            Some(0),
            "promoted player must hold a registered participant row"
        );

        let notification_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND type = 'tournament'",
        )
        .bind(waitlisted)
        .fetch_one(&pool)
        .await
        .expect("count promotion notifications");
        assert_eq!(notification_count, 1);

        // The waitlist entry is consumed, not left waiting.
        let entry_status: Option<(String,)> = sqlx::query_as(
            "SELECT status FROM tournament_waitlist WHERE tournament_id = $1 AND user_id = $2",
        )
        .bind(tournament_id)
        .bind(waitlisted)
        .fetch_optional(&pool)
        .await
        .expect("read waitlist entry");
        assert_eq!(entry_status.map(|row| row.0), Some("promoted".to_string()));

        // Cleanup (tournament delete cascades participants + waitlist).
        sqlx::query("DELETE FROM notifications WHERE user_id = ANY($1)")
            .bind(&[organizer, registered, waitlisted][..])
            .execute(&pool)
            .await
            .ok();
        sqlx::query("DELETE FROM tournaments WHERE id = $1")
            .bind(tournament_id)
            .execute(&pool)
            .await
            .ok();
        sqlx::query("DELETE FROM users WHERE id = ANY($1)")
            .bind(&[organizer, registered, waitlisted][..])
            .execute(&pool)
            .await
            .ok();
    }
}
