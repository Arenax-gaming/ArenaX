use crate::service::matchmaker::{MatchmakerService, EloEngine, MatchmakingConfig};
use crate::models::matchmaker::*;
use crate::db::DbPool;
use redis::Client;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::Utc;

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_test;

    fn create_test_config() -> MatchmakingConfig {
        MatchmakingConfig {
            elo_bucket_size: 100,
            max_elo_gap: 500,
            expansion_intervals: vec![30, 60, 120, 300],
            max_wait_time: 600,
            min_players_per_match: 2,
            max_players_per_match: 2,
        }
    }

    async fn setup_test_db() -> DbPool {
        // Create test database connection
        let database_url = std::env::var("TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://test:test@localhost/arenax_test".to_string());
        
        PgPool::connect(&database_url)
            .await
            .expect("Failed to create test database pool")
    }

    async fn setup_test_redis() -> Client {
        let redis_url = std::env::var("TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://localhost".to_string());
        
        Client::open(redis_url)
            .expect("Failed to create test Redis client")
    }

    async fn cleanup_test_data(db_pool: &DbPool, redis_client: &Client) {
        // Clean up test data
        sqlx::query!("DELETE FROM matchmaking_queue WHERE user_id LIKE 'test-%'")
            .execute(db_pool)
            .await
            .ok();

        sqlx::query!("DELETE FROM matches WHERE player1_id LIKE 'test-%'")
            .execute(db_pool)
            .await
            .ok();

        sqlx::query!("DELETE FROM user_elo WHERE user_id LIKE 'test-%'")
            .execute(db_pool)
            .await
            .ok();

        // Clean up Redis
        let mut conn = redis_client.get_multiplexed_async_connection().await
            .expect("Failed to get Redis connection");
        
        let pattern = "queue:test-*";
        let keys: Vec<String> = redis::cmd("KEYS")
            .arg(pattern)
            .query_async(&mut conn)
            .await
            .unwrap_or_default();
        
        for key in keys {
            redis::cmd("DEL")
                .arg(&key)
                .query_async::<_, ()>(&mut conn)
                .await
                .ok();
        }
    }

    #[tokio::test]
    async fn test_add_to_queue() {
        let db_pool = setup_test_db().await;
        let redis_client = setup_test_redis().await;
        let config = create_test_config();
        let matchmaker = MatchmakerService::new(db_pool, redis_client, config);

        let user_id = Uuid::new_v4();
        let game = "test-game".to_string();
        let game_mode = "test-mode".to_string();
        let current_elo = 1200;

        // Add user to queue
        let result = matchmaker.add_to_queue(user_id, game.clone(), game_mode.clone(), current_elo).await;
        assert!(result.is_ok());

        // Check if user is in queue
        let queue_entry = matchmaker.is_user_in_queue(user_id, &game, &game_mode).await.unwrap();
        assert!(queue_entry.is_some());
        
        let entry = queue_entry.unwrap();
        assert_eq!(entry.user_id, user_id);
        assert_eq!(entry.current_elo, current_elo);
        assert_eq!(entry.game, game);
        assert_eq!(entry.game_mode, game_mode);
    }

    #[tokio::test]
    async fn test_remove_from_queue() {
        let db_pool = setup_test_db().await;
        let redis_client = setup_test_redis().await;
        let config = create_test_config();
        let matchmaker = MatchmakerService::new(db_pool, redis_client.clone(), config);

        let user_id = Uuid::new_v4();
        let game = "test-game".to_string();
        let game_mode = "test-mode".to_string();
        let current_elo = 1200;

        // Add user to queue
        matchmaker.add_to_queue(user_id, game.clone(), game_mode.clone(), current_elo).await.unwrap();

        // Remove from queue
        let mut conn = redis_client.get_multiplexed_async_connection().await.unwrap();
        let result = matchmaker.remove_from_queue(&mut conn, &user_id, &game, &game_mode).await;
        assert!(result.is_ok());

        // Check if user is no longer in queue
        let queue_entry = matchmaker.is_user_in_queue(user_id, &game, &game_mode).await.unwrap();
        assert!(queue_entry.is_none());
    }

    #[tokio::test]
    async fn test_elo_calculation() {
        let elo_engine = EloEngine::new(32.0);
        let player1_id = Uuid::new_v4();
        let player2_id = Uuid::new_v4();
        let player1_elo = 1200;
        let player2_elo = 1200;

        // Test win scenario
        let (new_elo1, new_elo2) = elo_engine.calculate_elo_change(
            player1_elo,
            player2_elo,
            Some(player1_id), // Player 1 wins
            player1_id,
            player2_id,
        );

        assert!(new_elo1 > player1_elo); // Winner gains ELO
        assert!(new_elo2 < player2_elo); // Loser loses ELO
        assert_eq!(new_elo1 - player1_elo, -(new_elo2 - player2_elo)); // Zero-sum

        // Test draw scenario
        let (new_elo1_draw, new_elo2_draw) = elo_engine.calculate_elo_change(
            player1_elo,
            player2_elo,
            None, // Draw
            player1_id,
            player2_id,
        );

        assert!(new_elo1_draw < player1_elo); // Both lose ELO in draw
        assert!(new_elo2_draw < player2_elo);
        assert_eq!(new_elo1_draw - player1_elo, new_elo2_draw - player2_elo); // Same change
    }

    #[tokio::test]
    async fn test_dynamic_elo_expansion() {
        let db_pool = setup_test_db().await;
        let redis_client = setup_test_redis().await;
        let config = create_test_config();
        let matchmaker = MatchmakerService::new(db_pool, redis_client, config);

        let player_elo = 1200;
        let wait_time_30s = Utc::now() - chrono::Duration::seconds(30);
        let wait_time_2m = Utc::now() - chrono::Duration::seconds(120);

        let entry_30s = QueueEntry {
            user_id: Uuid::new_v4(),
            game: "test-game".to_string(),
            game_mode: "test-mode".to_string(),
            current_elo: player_elo,
            min_elo: player_elo - 100,
            max_elo: player_elo + 100,
            joined_at: wait_time_30s,
            wait_time_multiplier: 1.0,
        };

        let entry_2m = QueueEntry {
            user_id: Uuid::new_v4(),
            game: "test-game".to_string(),
            game_mode: "test-mode".to_string(),
            current_elo: player_elo,
            min_elo: player_elo - 100,
            max_elo: player_elo + 100,
            joined_at: wait_time_2m,
            wait_time_multiplier: 1.0,
        };

        // Test ELO gap expansion based on wait time
        let max_gap_30s = matchmaker.calculate_max_elo_gap(&entry_30s);
        let max_gap_2m = matchmaker.calculate_max_elo_gap(&entry_2m);

        assert!(max_gap_2m > max_gap_30s); // Longer wait = larger gap
        assert!(max_gap_2m <= 500); // But never exceeds maximum
    }

    #[tokio::test]
    async fn test_match_quality_calculation() {
        let db_pool = setup_test_db().await;
        let redis_client = setup_test_redis().await;
        let config = create_test_config();
        let matchmaker = MatchmakerService::new(db_pool, redis_client, config);

        let now = Utc::now();
        let player1 = QueueEntry {
            user_id: Uuid::new_v4(),
            game: "test-game".to_string(),
            game_mode: "test-mode".to_string(),
            current_elo: 1200,
            min_elo: 1100,
            max_elo: 1300,
            joined_at: now,
            wait_time_multiplier: 1.0,
        };

        let player2_close = QueueEntry {
            user_id: Uuid::new_v4(),
            game: "test-game".to_string(),
            game_mode: "test-mode".to_string(),
            current_elo: 1250, // Close ELO
            min_elo: 1150,
            max_elo: 1350,
            joined_at: now,
            wait_time_multiplier: 1.0,
        };

        let player2_far = QueueEntry {
            user_id: Uuid::new_v4(),
            game: "test-game".to_string(),
            game_mode: "test-mode".to_string(),
            current_elo: 1500, // Far ELO
            min_elo: 1400,
            max_elo: 1600,
            joined_at: now,
            wait_time_multiplier: 1.0,
        };

        // Test match quality calculation
        let quality_close = matchmaker.calculate_match_quality(&player1, &player2_close, 50);
        let quality_far = matchmaker.calculate_match_quality(&player1, &player2_far, 300);

        assert!(quality_close > quality_far); // Closer ELO = better quality
        assert!(quality_close <= 1.5); // Should be reasonable range
        assert!(quality_far >= 0.0); // Should be non-negative
    }

    #[tokio::test]
    async fn test_queue_size_calculation() {
        let db_pool = setup_test_db().await;
        let redis_client = setup_test_redis().await;
        let config = create_test_config();
        let matchmaker = MatchmakerService::new(db_pool, redis_client, config);

        let game = "test-game".to_string();
        let game_mode = "test-mode".to_string();

        // Initially empty queue
        let initial_size = matchmaker.get_queue_size(&game, &game_mode).await.unwrap();
        assert_eq!(initial_size, 0);

        // Add players to queue
        for i in 0..5 {
            let user_id = Uuid::new_v4();
            matchmaker.add_to_queue(user_id, game.clone(), game_mode.clone(), 1200 + i * 10).await.unwrap();
        }

        // Check queue size
        let new_size = matchmaker.get_queue_size(&game, &game_mode).await.unwrap();
        assert_eq!(new_size, 5);
    }

    #[tokio::test]
    async fn test_estimated_wait_time() {
        let db_pool = setup_test_db().await;
        let redis_client = setup_test_redis().await;
        let config = create_test_config();
        let matchmaker = MatchmakerService::new(db_pool, redis_client, config);

        let user_id = Uuid::new_v4();
        let game = "test-game".to_string();
        let game_mode = "test-mode".to_string();

        // Add some players to queue first
        for i in 0..3 {
            let other_user_id = Uuid::new_v4();
            matchmaker.add_to_queue(other_user_id, game.clone(), game_mode.clone(), 1200).await.unwrap();
        }

        // Get estimated wait time
        let wait_time = matchmaker.get_estimated_wait_time(user_id, &game, &game_mode).await.unwrap();
        assert!(wait_time > 0); // Should estimate some wait time
        assert!(wait_time < 1000); // Should be reasonable (less than ~16 minutes)
    }

    #[tokio::test]
    async fn test_concurrent_queue_operations() {
        let db_pool = setup_test_db().await;
        let redis_client = setup_test_redis().await;
        let config = create_test_config();
        let matchmaker = std::sync::Arc::new(MatchmakerService::new(db_pool, redis_client, config));

        let game = "test-game".to_string();
        let game_mode = "test-mode".to_string();

        // Add multiple players concurrently
        let mut handles = Vec::new();
        for i in 0..10 {
            let matchmaker_clone = matchmaker.clone();
            let game_clone = game.clone();
            let game_mode_clone = game_mode.clone();
            
            let handle = tokio::spawn(async move {
                let user_id = Uuid::new_v4();
                matchmaker_clone.add_to_queue(user_id, game_clone, game_mode_clone, 1200 + i * 5).await
            });
            handles.push(handle);
        }

        // Wait for all operations to complete
        for handle in handles {
            assert!(handle.await.unwrap().is_ok());
        }

        // Check final queue size
        let final_size = matchmaker.get_queue_size(&game, &game_mode).await.unwrap();
        assert_eq!(final_size, 10);
    }

    #[tokio::test]
    async fn test_elo_boundary_conditions() {
        let elo_engine = EloEngine::new(32.0);
        let player1_id = Uuid::new_v4();
        let player2_id = Uuid::new_v4();

        // Test very high ELO difference
        let (new_elo1, new_elo2) = elo_engine.calculate_elo_change(
            3000, // Very high ELO
            500,  // Very low ELO
            Some(player1_id), // High ELO player wins (expected)
            player1_id,
            player2_id,
        );

        // High ELO player should gain very little
        assert!(new_elo1 - 3000 <= 5); 
        // Low ELO player should lose very little
        assert!(500 - new_elo2 <= 5);

        // Test upset (low ELO player wins)
        let (upset_elo1, upset_elo2) = elo_engine.calculate_elo_change(
            3000,
            500,
            Some(player2_id), // Low ELO player wins (upset)
            player1_id,
            player2_id,
        );

        // High ELO player should lose a lot
        assert!(3000 - upset_elo1 >= 20);
        // Low ELO player should gain a lot
        assert!(upset_elo2 - 500 >= 20);
    }

    #[tokio::test]
    async fn test_matchmaking_performance() {
        let db_pool = setup_test_db().await;
        let redis_client = setup_test_redis().await;
        let config = create_test_config();
        let matchmaker = MatchmakerService::new(db_pool, redis_client, config);

        let game = "perf-test".to_string();
        let game_mode = "test-mode".to_string();

        // Add 1000 players to queue
        let start_time = std::time::Instant::now();
        
        for i in 0..1000 {
            let user_id = Uuid::new_v4();
            let elo = 800 + (i % 800); // ELO range 800-1600
            matchmaker.add_to_queue(user_id, game.clone(), game_mode.clone(), elo).await.unwrap();
        }

        let add_duration = start_time.elapsed();
        println!("Added 1000 players to queue in {:?}", add_duration);
        assert!(add_duration.as_secs() < 5); // Should be fast

        // Test queue size retrieval performance
        let start_time = std::time::Instant::now();
        let queue_size = matchmaker.get_queue_size(&game, &game_mode).await.unwrap();
        let size_duration = start_time.elapsed();
        
        assert_eq!(queue_size, 1000);
        assert!(size_duration.as_millis() < 100); // Should be very fast
        println!("Retrieved queue size in {:?}", size_duration);
    }
}

// Integration tests
#[cfg(test)]
mod integration_tests {
    use super::*;
    use actix_web::{test, web, App};
    use crate::http::matchmaking::*;
    use crate::auth::{JwtService, Claims};
    use crate::middleware::auth_middleware::JwtMiddleware;

    async fn setup_test_app() -> impl actix_web::dev::Service<
        actix_web::dev::ServiceRequest,
        Response = actix_web::dev::ServiceResponse,
        Error = actix_web::Error,
    > {
        let db_pool = setup_test_db().await;
        let redis_client = setup_test_redis().await;
        let config = create_test_config();
        let matchmaker = web::Data::new(MatchmakerService::new(db_pool, redis_client, config));
        let elo_engine = web::Data::new(EloEngine::new(32.0));

        test::init_service(
            App::new()
                .app_data(matchmaker)
                .app_data(elo_engine)
                .service(
                    web::scope("/api/matchmaking")
                        .route("/join", web::post().to(join_queue))
                        .route("/leave", web::post().to(leave_queue))
                        .route("/status/{game}/{game_mode}", web::get().to(get_queue_status))
                        .route("/stats", web::get().to(get_matchmaking_stats))
                )
        ).await
    }

    #[tokio::test]
    async fn test_join_queue_endpoint() {
        let app = setup_test_app().await;

        let request = JoinQueueRequest {
            game: "test-game".to_string(),
            game_mode: "test-mode".to_string(),
        };

        let req = test::TestRequest::post()
            .uri("/api/matchmaking/join")
            .set_json(request)
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let response: JoinQueueResponse = test::read_body_json(resp).await;
        assert!(response.success);
        assert!(response.queue_position.is_some());
    }

    #[tokio::test]
    async fn test_queue_status_endpoint() {
        let app = setup_test_app().await;

        let req = test::TestRequest::get()
            .uri("/api/matchmaking/status/test-game/test-mode")
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let response: QueueStatusResponse = test::read_body_json(resp).await;
        assert!(!response.in_queue); // Should not be in queue initially
        assert_eq!(response.queue_size, 0);
    }

    #[tokio::test]
    async fn test_matchmaking_stats_endpoint() {
        let app = setup_test_app().await;

        let req = test::TestRequest::get()
            .uri("/api/matchmaking/stats")
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let response: MatchmakingStatsResponse = test::read_body_json(resp).await;
        assert_eq!(response.total_players_in_queue, 0); // Should be empty initially
        assert!(response.games.is_empty());
    }
}
