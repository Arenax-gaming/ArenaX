#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DbPool;
    use crate::models::idempotency::*;
    use actix_web::{test, web, App, HttpRequest};
    use chrono::Utc;
    use serde_json::json;
    use sqlx;
    use uuid::Uuid;

    async fn setup_test_db() -> DbPool {
        let database_url = std::env::var("TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://test:test@localhost/arenax_test".to_string());
        
        let pool = sqlx::PgPool::connect(&database_url)
            .await
            .expect("Failed to create test database pool");

        // Run migration
        sqlx::query!(
            r#"
            CREATE TABLE IF NOT EXISTS idempotency_keys (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                key VARCHAR(255) NOT NULL UNIQUE,
                request_hash VARCHAR(64) NOT NULL,
                response_status SMALLINT NOT NULL,
                response_headers JSONB,
                response_body JSONB,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                used_at TIMESTAMP WITH TIME ZONE
            )
            "#
        )
        .execute(&pool)
        .await
        .expect("Failed to create test table");

        pool
    }

    async fn cleanup_test_data(pool: &DbPool) {
        sqlx::query!("DELETE FROM idempotency_keys")
            .execute(pool)
            .await
            .ok();
    }

    #[tokio::test]
    async fn test_idempotency_service_store_key() {
        let pool = setup_test_db().await;
        let service = IdempotencyService::default(pool);
        
        let key = "test_key_123".to_string();
        let hash = "abc123".to_string();
        let response = CachedResponse::new(200, json!({}), json!({ "test": "data" }));
        
        let result = service.store_key(key.clone(), hash, response).await;
        assert!(result.is_ok());
        
        // Verify key was stored
        let cached = service.get_cached_response(&key).await.unwrap();
        assert!(cached.is_some());
        
        cleanup_test_data(&service.db_pool).await;
    }

    #[tokio::test]
    async fn test_idempotency_service_conflict_detection() {
        let pool = setup_test_db().await;
        let service = IdempotencyService::default(pool);
        
        let key = "test_key_conflict".to_string();
        let original_hash = "hash1".to_string();
        let new_hash = "hash2".to_string();
        
        // Store original key
        let response = CachedResponse::new(200, json!({}), json!({}));
        service.store_key(key.clone(), original_hash, response).await.unwrap();
        
        // Check for conflict
        let conflict = service.check_conflict(&key, &new_hash).await.unwrap();
        assert!(conflict.is_some());
        
        let conflict = conflict.unwrap();
        assert_eq!(conflict.key, key);
        assert_eq!(conflict.original_hash, original_hash);
        assert_eq!(conflict.new_hash, new_hash);
        assert!(matches!(conflict.conflict_type, ConflictType::PayloadMismatch));
        
        cleanup_test_data(&service.db_pool).await;
    }

    #[tokio::test]
    async fn test_idempotency_service_no_conflict_same_hash() {
        let pool = setup_test_db().await;
        let service = IdempotencyService::default(pool);
        
        let key = "test_key_no_conflict".to_string();
        let hash = "same_hash".to_string();
        
        // Store original key
        let response = CachedResponse::new(200, json!({}), json!({}));
        service.store_key(key.clone(), hash.clone(), response).await.unwrap();
        
        // Check for conflict with same hash
        let conflict = service.check_conflict(&key, &hash).await.unwrap();
        assert!(conflict.is_none());
        
        cleanup_test_data(&service.db_pool).await;
    }

    #[tokio::test]
    async fn test_idempotency_service_cleanup_expired() {
        let pool = setup_test_db().await;
        let service = IdempotencyService::default(pool);
        
        // Create expired key
        let key = "expired_key".to_string();
        let response = CachedResponse::new(200, json!({}), json!({}));
        
        sqlx::query!(
            "INSERT INTO idempotency_keys (key, request_hash, response_status, response_headers, response_body, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW() - INTERVAL '1 hour')",
            key,
            "hash",
            200i16,
            json!({}),
            json!({})
        )
        .execute(&service.db_pool)
        .await
        .unwrap();
        
        // Cleanup expired keys
        let cleaned = service.cleanup_expired_keys().await.unwrap();
        assert!(cleaned > 0);
        
        cleanup_test_data(&service.db_pool).await;
    }

    #[tokio::test]
    async fn test_idempotency_service_usage_stats() {
        let pool = setup_test_db().await;
        let service = IdempotencyService::default(pool);
        
        // Create some test data
        for i in 0..5 {
            let key = format!("stats_key_{}", i);
            let response = CachedResponse::new(200, json!({}), json!({}));
            service.store_key(key, format!("hash_{}", i), response).await.unwrap();
        }
        
        // Mark some as used
        service.mark_key_used("stats_key_0").await.unwrap();
        service.mark_key_used("stats_key_1").await.unwrap();
        
        // Get stats
        let stats = service.get_usage_stats().await.unwrap();
        assert_eq!(stats.total_keys, 5);
        assert_eq!(stats.used_keys, 2);
        
        cleanup_test_data(&service.db_pool).await;
    }

    #[tokio::test]
    async fn test_cached_response_size_calculation() {
        let small_response = CachedResponse::new(200, json!({}), json!({ "small": "data" }));
        assert!(small_response.size_kb() < 1);
        
        let large_data = "x".repeat(2048); // 2KB
        let large_response = CachedResponse::new(200, json!({}), json!({ "data": large_data }));
        assert!(large_response.size_kb() >= 2);
    }

    #[tokio::test]
    async fn test_idempotency_key_generation() {
        let key1 = IdempotencyService::generate_key();
        let key2 = IdempotencyService::generate_key();
        
        assert_ne!(key1, key2);
        assert!(key1.starts_with("idemp_"));
        assert!(key2.starts_with("idemp_"));
        assert!(key1.len() > 8);
        assert!(key2.len() > 8);
    }

    #[tokio::test]
    async fn test_idempotency_key_validation() {
        // Valid keys
        assert!(IdempotencyService::validate_key_format("valid_key_123").is_ok());
        assert!(IdempotencyService::validate_key_format("key-with-hyphens").is_ok());
        assert!(IdempotencyService::validate_key_format("key_with_underscores").is_ok());
        assert!(IdempotencyService::validate_key_format("12345678").is_ok());
        
        // Invalid keys
        assert!(IdempotencyService::validate_key_format("").is_err());
        assert!(IdempotencyService::validate_key_format("short").is_err());
        assert!(IdempotencyService::validate_key_format("key with spaces").is_err());
        assert!(IdempotencyService::validate_key_format("key@with#symbols").is_err());
        
        // Too long key
        let long_key = "a".repeat(256);
        assert!(IdempotencyService::validate_key_format(&long_key).is_err());
    }

    #[tokio::test]
    async fn test_idempotency_policy_default() {
        let policy = IdempotencyPolicy::default();
        
        assert!(!policy.enabled_routes.is_empty());
        assert_eq!(policy.default_ttl_seconds, 86400);
        assert_eq!(policy.max_response_size_kb, 1024);
        assert_eq!(policy.key_header_name, "Idempotency-Key");
        assert_eq!(policy.conflict_status_code, 409);
    }

    #[tokio::test]
    async fn test_idempotency_key_response() {
        let response = IdempotencyKeyResponse::new("test_key".to_string(), 3600);
        
        assert_eq!(response.key, "test_key");
        assert_eq!(response.ttl_seconds, 3600);
        assert!(response.expires_at > Utc::now());
    }

    // Integration tests with middleware
    #[tokio::test]
    async fn test_middleware_request_hashing() {
        let middleware = IdempotencyMiddleware::default(setup_test_db().await);
        
        // Create test request
        let req = test::TestRequest::post()
            .uri("/api/test?param=value")
            .header("Content-Type", "application/json")
            .header("Idempotency-Key", "test_key")
            .set_json(json!({"data": "test"}))
            .to_request();
        
        let body = br#"{"data": "test"}"#;
        let hash = middleware.generate_request_hash(&req, body);
        
        // Hash should be consistent
        let hash2 = middleware.generate_request_hash(&req, body);
        assert_eq!(hash, hash2);
        
        // Different body should produce different hash
        let different_body = br#"{"data": "different"}"#;
        let hash3 = middleware.generate_request_hash(&req, different_body);
        assert_ne!(hash, hash3);
        
        cleanup_test_data(&middleware.db_pool).await;
    }

    #[tokio::test]
    async fn test_middleware_key_extraction() {
        let middleware = IdempotencyMiddleware::default(setup_test_db().await);
        
        // Valid key
        let req = test::TestRequest::default()
            .header("Idempotency-Key", "valid_key_123")
            .to_request();
        
        let key = middleware.extract_idempotency_key(req.headers()).unwrap();
        assert_eq!(key, "valid_key_123");
        
        // Missing key
        let req_no_key = test::TestRequest::default().to_request();
        assert!(middleware.extract_idempotency_key(req_no_key.headers()).is_err());
        
        // Empty key
        let req_empty = test::TestRequest::default()
            .header("Idempotency-Key", "")
            .to_request();
        
        assert!(middleware.extract_idempotency_key(req_empty.headers()).is_err());
        
        cleanup_test_data(&middleware.db_pool).await;
    }

    #[tokio::test]
    async fn test_middleware_route_filtering() {
        let middleware = IdempotencyMiddleware::default(setup_test_db().await);
        
        // Enabled route
        assert!(middleware.is_route_enabled("/api/payments/create"));
        assert!(middleware.is_route_enabled("/api/payments/refund"));
        assert!(middleware.is_route_enabled("/api/matchmaking/join"));
        
        // Disabled route
        assert!(!middleware.is_route_enabled("/api/users/profile"));
        assert!(!middleware.is_route_enabled("/api/health"));
        assert!(!middleware.is_route_enabled("/api/auth/login"));
        
        cleanup_test_data(&middleware.db_pool).await;
    }

    // Performance tests
    #[tokio::test]
    async fn test_performance_key_generation() {
        let start = std::time::Instant::now();
        
        for _ in 0..1000 {
            IdempotencyService::generate_key();
        }
        
        let duration = start.elapsed();
        let ops_per_sec = 1000.0 / duration.as_secs_f64();
        
        // Should be able to generate at least 500 keys per second
        assert!(ops_per_sec > 500.0, "Performance test failed: {} ops/sec", ops_per_sec);
    }

    #[tokio::test]
    async fn test_performance_hashing() {
        let middleware = IdempotencyMiddleware::default(setup_test_db().await);
        let req = test::TestRequest::post()
            .uri("/api/test")
            .header("Content-Type", "application/json")
            .to_request();
        
        let body = br#"{"large": "data", "numbers": [1,2,3,4,5,6,7,8,9,10]}"#;
        
        let start = std::time::Instant::now();
        
        for _ in 0..1000 {
            middleware.generate_request_hash(&req, body);
        }
        
        let duration = start.elapsed();
        let ops_per_sec = 1000.0 / duration.as_secs_f64();
        
        // Should be able to hash at least 1000 requests per second
        assert!(ops_per_sec > 1000.0, "Hashing performance test failed: {} ops/sec", ops_per_sec);
        
        cleanup_test_data(&middleware.db_pool).await;
    }

    #[tokio::test]
    async fn test_concurrent_key_operations() {
        let pool = setup_test_db().await;
        let service = IdempotencyService::default(pool);
        
        let mut handles = Vec::new();
        
        // Concurrent key storage
        for i in 0..100 {
            let service_clone = service.clone();
            let handle = tokio::spawn(async move {
                let key = format!("concurrent_key_{}", i);
                let response = CachedResponse::new(200, json!({}), json!({}));
                service_clone.store_key(key, format!("hash_{}", i), response).await
            });
            handles.push(handle);
        }
        
        // Wait for all operations to complete
        for handle in handles {
            assert!(handle.await.unwrap().is_ok());
        }
        
        // Verify all keys were stored
        let stats = service.get_usage_stats().await.unwrap();
        assert_eq!(stats.total_keys, 100);
        
        cleanup_test_data(&service.db_pool).await;
    }

    // Error handling tests
    #[tokio::test]
    async fn test_large_response_rejection() {
        let pool = setup_test_db().await;
        let mut policy = IdempotencyPolicy::default();
        policy.max_response_size_kb = 1; // 1KB limit
        
        let service = IdempotencyService::new(pool, policy);
        
        let large_data = "x".repeat(2048); // 2KB
        let large_response = CachedResponse::new(200, json!({}), json!({ "data": large_data }));
        
        let result = service.store_key("test_key".to_string(), "hash".to_string(), large_response).await;
        assert!(result.is_err());
        
        cleanup_test_data(&service.db_pool).await;
    }

    #[tokio::test]
    async fn test_database_error_handling() {
        // Use invalid database URL to simulate database errors
        let invalid_pool = sqlx::PgPool::connect("postgresql://invalid:invalid@localhost/invalid")
            .await
            .expect_err("Should fail to connect to invalid database");
        
        let service = IdempotencyService::default(invalid_pool);
        
        // Operations should return database errors
        let result = service.get_cached_response("test_key").await;
        assert!(result.is_err());
        
        let result = service.store_key("test_key".to_string(), "hash".to_string(), CachedResponse::new(200, json!({}), json!({}))).await;
        assert!(result.is_err());
    }
}
