use crate::db::DbPool;
use crate::service::matchmaker::{
    calculate_match_quality, calculate_max_elo_gap, EloEngine, MatchmakerService,
    MatchmakingConfig, QueueEntry, RedisConn,
};
use chrono::Utc;
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;

#[cfg(test)]
fn create_test_config() -> MatchmakingConfig {
    MatchmakingConfig {
        elo_bucket_size: 100,
        max_elo_gap: 500,
        expansion_intervals: vec![
            Duration::from_secs(30),
            Duration::from_secs(60),
            Duration::from_secs(120),
            Duration::from_secs(300),
        ],
        max_wait_time: Duration::from_secs(600),
        min_players_per_match: 2,
        max_players_per_match: 2,
    }
}

#[cfg(test)]
async fn setup_test_db() -> DbPool {
    let database_url = std::env::var("TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .unwrap_or_else(|_| "postgresql://test:test@localhost/arenax_test".to_string());

    PgPool::connect(&database_url)
        .await
        .expect("Failed to create test database pool")
}

#[cfg(test)]
async fn setup_test_redis() -> RedisConn {
    let redis_url = std::env::var("TEST_REDIS_URL")
        .or_else(|_| std::env::var("REDIS_URL"))
        .unwrap_or_else(|_| "redis://localhost".to_string());

    redis::Client::open(redis_url)
        .expect("Failed to create test Redis client")
        .get_connection_manager()
        .await
        .expect("Failed to connect to test Redis")
}

#[cfg(test)]
async fn test_matchmaker() -> MatchmakerService {
    MatchmakerService::new(setup_test_db().await, setup_test_redis().await, create_test_config())
}

/// A queue name unique to one test, so tests running in parallel never see
/// each other's players.
#[cfg(test)]
fn unique_game() -> String {
    format!("test-game-{}", Uuid::new_v4())
}

#[cfg(test)]
fn queue_entry(current_elo: i32, waited_secs: i64) -> QueueEntry {
    QueueEntry {
        user_id: Uuid::new_v4(),
        game: "test-game".to_string(),
        game_mode: "test-mode".to_string(),
        current_elo,
        min_elo: current_elo - 100,
        max_elo: current_elo + 100,
        joined_at: Utc::now() - chrono::Duration::seconds(waited_secs),
        wait_time_multiplier: 1.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_add_to_queue() {
        let matchmaker = test_matchmaker().await;
        let user_id = Uuid::new_v4();
        let game = unique_game();
        let game_mode = "test-mode".to_string();

        matchmaker
            .add_to_queue(user_id, game.clone(), game_mode.clone(), 1200)
            .await
            .unwrap();

        let entry = matchmaker
            .is_user_in_queue(user_id, &game, &game_mode)
            .await
            .unwrap()
            .expect("player should be queued");
        assert_eq!(entry.user_id, user_id);
        assert_eq!(entry.current_elo, 1200);
        assert_eq!(entry.game, game);
        assert_eq!(entry.game_mode, game_mode);
    }

    #[tokio::test]
    async fn test_remove_from_queue() {
        let matchmaker = test_matchmaker().await;
        let user_id = Uuid::new_v4();
        let game = unique_game();
        let game_mode = "test-mode".to_string();

        matchmaker
            .add_to_queue(user_id, game.clone(), game_mode.clone(), 1200)
            .await
            .unwrap();

        let mut conn = matchmaker.redis_conn();
        matchmaker
            .remove_from_queue(&mut conn, &user_id, &game, &game_mode)
            .await
            .unwrap();

        let entry = matchmaker
            .is_user_in_queue(user_id, &game, &game_mode)
            .await
            .unwrap();
        assert!(entry.is_none());
    }

    #[test]
    fn test_elo_calculation() {
        let elo_engine = EloEngine::new(32.0);
        let player1_id = Uuid::new_v4();
        let player2_id = Uuid::new_v4();

        let (new_elo1, new_elo2) =
            elo_engine.calculate_elo_change(1200, 1200, Some(player1_id), player1_id, player2_id);
        assert!(new_elo1 > 1200, "winner gains Elo");
        assert!(new_elo2 < 1200, "loser loses Elo");
        assert_eq!(new_elo1 - 1200, -(new_elo2 - 1200), "zero-sum");

        // A draw between equally rated players leaves both ratings unchanged.
        let (draw1, draw2) =
            elo_engine.calculate_elo_change(1200, 1200, None, player1_id, player2_id);
        assert_eq!(draw1, 1200);
        assert_eq!(draw2, 1200);
    }

    #[test]
    fn test_dynamic_elo_expansion() {
        let max_gap_30s = calculate_max_elo_gap(&queue_entry(1200, 31));
        let max_gap_2m = calculate_max_elo_gap(&queue_entry(1200, 121));

        assert!(max_gap_2m > max_gap_30s, "longer wait allows a larger gap");
        assert!(max_gap_2m <= 500, "gap never exceeds the maximum");
    }

    #[test]
    fn test_match_quality_calculation() {
        let player1 = queue_entry(1200, 0);
        let player2_close = queue_entry(1250, 0);
        let player2_far = queue_entry(1500, 0);

        let quality_close = calculate_match_quality(&player1, &player2_close, 50);
        let quality_far = calculate_match_quality(&player1, &player2_far, 300);

        assert!(quality_close > quality_far, "closer Elo means better quality");
        assert!(quality_close <= 1.5);
        assert!(quality_far >= 0.0);
    }

    #[tokio::test]
    async fn test_queue_size_calculation() {
        let matchmaker = test_matchmaker().await;
        let game = unique_game();
        let game_mode = "test-mode".to_string();

        assert_eq!(matchmaker.get_queue_size(&game, &game_mode).await.unwrap(), 0);

        for i in 0..5 {
            matchmaker
                .add_to_queue(Uuid::new_v4(), game.clone(), game_mode.clone(), 1200 + i * 10)
                .await
                .unwrap();
        }

        assert_eq!(matchmaker.get_queue_size(&game, &game_mode).await.unwrap(), 5);
    }

    #[tokio::test]
    async fn test_estimated_wait_time() {
        let matchmaker = test_matchmaker().await;
        let game = unique_game();
        let game_mode = "test-mode".to_string();

        for _ in 0..3 {
            matchmaker
                .add_to_queue(Uuid::new_v4(), game.clone(), game_mode.clone(), 1200)
                .await
                .unwrap();
        }

        let wait_time = matchmaker
            .get_estimated_wait_time(Uuid::new_v4(), &game, &game_mode)
            .await
            .unwrap();
        assert!(wait_time > 0);
        assert!(wait_time < 1000);
    }

    #[tokio::test]
    async fn test_concurrent_queue_operations() {
        let matchmaker = std::sync::Arc::new(test_matchmaker().await);
        let game = unique_game();
        let game_mode = "test-mode".to_string();

        let handles: Vec<_> = (0..10)
            .map(|i| {
                let matchmaker = matchmaker.clone();
                let game = game.clone();
                let game_mode = game_mode.clone();
                tokio::spawn(async move {
                    matchmaker
                        .add_to_queue(Uuid::new_v4(), game, game_mode, 1200 + i * 5)
                        .await
                })
            })
            .collect();

        for handle in handles {
            assert!(handle.await.unwrap().is_ok());
        }

        assert_eq!(matchmaker.get_queue_size(&game, &game_mode).await.unwrap(), 10);
    }

    #[test]
    fn test_elo_boundary_conditions() {
        let elo_engine = EloEngine::new(32.0);
        let player1_id = Uuid::new_v4();
        let player2_id = Uuid::new_v4();

        // The heavy favourite winning barely moves either rating.
        let (new_elo1, new_elo2) =
            elo_engine.calculate_elo_change(3000, 500, Some(player1_id), player1_id, player2_id);
        assert!(new_elo1 - 3000 <= 5);
        assert!(500 - new_elo2 <= 5);

        // An upset moves both ratings a lot.
        let (upset_elo1, upset_elo2) =
            elo_engine.calculate_elo_change(3000, 500, Some(player2_id), player1_id, player2_id);
        assert!(3000 - upset_elo1 >= 20);
        assert!(upset_elo2 - 500 >= 20);
    }

    #[tokio::test]
    async fn test_matchmaking_performance() {
        let matchmaker = test_matchmaker().await;
        let game = unique_game();
        let game_mode = "test-mode".to_string();

        let start_time = std::time::Instant::now();
        for i in 0..1000 {
            matchmaker
                .add_to_queue(Uuid::new_v4(), game.clone(), game_mode.clone(), 800 + (i % 800))
                .await
                .unwrap();
        }
        assert!(start_time.elapsed().as_secs() < 5);

        let start_time = std::time::Instant::now();
        let queue_size = matchmaker.get_queue_size(&game, &game_mode).await.unwrap();
        assert_eq!(queue_size, 1000);
        assert!(start_time.elapsed().as_millis() < 100);
    }

    #[test]
    fn test_calculate_wait_time_percentiles() {
        use crate::service::matchmaker::calculate_percentiles;

        let res_empty = calculate_percentiles(vec![]);
        assert_eq!(res_empty.p50, 0.0);
        assert_eq!(res_empty.p95, 0.0);
        assert_eq!(res_empty.p99, 0.0);

        let samples = vec![10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0];
        let res = calculate_percentiles(samples);
        assert!(res.p50 >= 40.0 && res.p50 <= 60.0);
        assert!(res.p95 >= 90.0);
        assert!(res.p99 >= 90.0);
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::auth::jwt_service::{Claims, TokenType};
    use crate::http::matchmaking::{
        get_matchmaking_metrics_dashboard, get_matchmaking_stats, get_queue_status, join_queue,
        JoinQueueRequest, JoinQueueResponse, QueueStatusResponse,
    };
    use actix_web::{test, web, App, HttpMessage};

    fn claims_for(user_id: Uuid) -> Claims {
        Claims {
            sub: user_id.to_string(),
            exp: Utc::now().timestamp() + 3600,
            iat: Utc::now().timestamp(),
            jti: Uuid::new_v4().to_string(),
            token_type: TokenType::Access,
            device_id: None,
            session_id: Uuid::new_v4().to_string(),
            roles: vec!["user".to_string()],
        }
    }

    /// Insert a user row, since queue entries reference `users`.
    async fn create_test_user(db_pool: &DbPool) -> Uuid {
        let user_id = Uuid::new_v4();
        let suffix = user_id.simple().to_string();
        sqlx::query("INSERT INTO users (id, username, phone_number) VALUES ($1, $2, $3)")
            .bind(user_id)
            .bind(format!("mm_{}", &suffix[..12]))
            .bind(format!("+1{}", &suffix[..10]))
            .execute(db_pool)
            .await
            .expect("Failed to create test user");
        user_id
    }

    macro_rules! test_app {
        ($db_pool:expr) => {{
            let matchmaker = MatchmakerService::new(
                $db_pool.clone(),
                setup_test_redis().await,
                create_test_config(),
            );
            test::init_service(
                App::new()
                    .app_data(web::Data::new($db_pool.clone()))
                    .app_data(web::Data::new(matchmaker))
                    .service(
                        web::scope("/api/matchmaking")
                            .route("/join", web::post().to(join_queue))
                            .route("/status/{game}/{game_mode}", web::get().to(get_queue_status))
                            .route("/stats", web::get().to(get_matchmaking_stats))
                            .route("/metrics", web::get().to(get_matchmaking_metrics_dashboard)),
                    ),
            )
            .await
        }};
    }

    #[actix_web::test]
    async fn test_join_queue_endpoint() {
        let db_pool = setup_test_db().await;
        let user_id = create_test_user(&db_pool).await;
        let app = test_app!(db_pool);

        let req = test::TestRequest::post()
            .uri("/api/matchmaking/join")
            .set_json(JoinQueueRequest {
                game: unique_game(),
                game_mode: "test-mode".to_string(),
            })
            .to_request();
        req.extensions_mut().insert(claims_for(user_id));

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let response: JoinQueueResponse = test::read_body_json(resp).await;
        assert!(response.success);
        assert!(response.queue_position.is_some());
    }

    #[actix_web::test]
    async fn test_queue_status_endpoint() {
        let db_pool = setup_test_db().await;
        let app = test_app!(db_pool);

        let req = test::TestRequest::get()
            .uri(&format!("/api/matchmaking/status/{}/test-mode", unique_game()))
            .to_request();
        req.extensions_mut().insert(claims_for(Uuid::new_v4()));

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let response: QueueStatusResponse = test::read_body_json(resp).await;
        assert!(!response.in_queue);
        assert_eq!(response.queue_size, 0);
    }

    #[actix_web::test]
    async fn test_matchmaking_stats_endpoint() {
        let db_pool = setup_test_db().await;
        let app = test_app!(db_pool);

        let req = test::TestRequest::get().uri("/api/matchmaking/stats").to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    #[actix_web::test]
    async fn test_matchmaking_metrics_dashboard_endpoint() {
        let db_pool = setup_test_db().await;
        let app = test_app!(db_pool);

        let req = test::TestRequest::get().uri("/api/matchmaking/metrics").to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let response: crate::models::matchmaker::MatchmakingMetricsDashboard =
            test::read_body_json(resp).await;
        assert_eq!(response.hourly_aggregates.len(), 24);
    }
}

#[cfg(test)]
mod elo_queue_tests {
    use super::*;

    #[test]
    fn elo_gap_expands_with_wait_time() {
        use crate::service::matchmaker::elo_gap_for_wait;
        assert_eq!(elo_gap_for_wait(0), 100);
        assert_eq!(elo_gap_for_wait(31), 200);
        assert_eq!(elo_gap_for_wait(61), 400);
        assert_eq!(elo_gap_for_wait(301), 500);
    }

    #[test]
    fn queue_entry_expires_after_max_wait() {
        use crate::service::matchmaker::{is_queue_entry_expired, QueueEntry};
        let now = Utc::now();
        let entry = QueueEntry {
            user_id: Uuid::new_v4(),
            game: "chess".into(),
            game_mode: "ranked".into(),
            current_elo: 1200,
            min_elo: 1100,
            max_elo: 1300,
            joined_at: now - chrono::Duration::seconds(601),
            wait_time_multiplier: 1.0,
        };
        let max_wait = std::time::Duration::from_secs(600);
        assert!(is_queue_entry_expired(&entry, now, max_wait));
        let fresh = QueueEntry { joined_at: now, ..entry };
        assert!(!is_queue_entry_expired(&fresh, now, max_wait));
    }
}
