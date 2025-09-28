// Integration tests for JWT service that require Redis
// To run these tests, ensure Redis is running on localhost:6379
// Run with: REDIS_URL=redis://127.0.0.1:6379 cargo test --test jwt_integration_tests

use anyhow::Result;
use chrono::{Duration, Utc};
use redis::{AsyncCommands, Client as RedisClient};
use std::env;

use backend::auth::{JwtConfig, JwtError, JwtService, SessionInfo, TokenType};

// Test configuration
fn get_test_config() -> JwtConfig {
    JwtConfig {
        access_token_expiry: Duration::minutes(15),
        refresh_token_expiry: Duration::hours(24),
        algorithm: jsonwebtoken::Algorithm::HS256,
        issuer: "arenax-test".to_string(),
        audience: "arenax-test-users".to_string(),
        max_refresh_count: 3,
    }
}

fn get_test_jwt_service() -> Result<JwtService> {
    let secret_key = "test-secret-key-for-jwt-testing-purposes-only".to_string();
    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let config = Some(get_test_config());

    JwtService::new(secret_key, &redis_url, config)
}

async fn cleanup_redis() -> Result<(), redis::RedisError> {
    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let client = RedisClient::open(redis_url)?;
    let mut conn = client.get_multiplexed_async_connection().await?;

    // Clean up test data
    let session_keys: Vec<String> = conn.keys("session:*").await.unwrap_or_default();
    if !session_keys.is_empty() {
        let _: Result<(), redis::RedisError> = conn.del(&session_keys).await;
    }

    let blacklist_keys: Vec<String> = conn.keys("blacklisted:*").await.unwrap_or_default();
    if !blacklist_keys.is_empty() {
        let _: Result<(), redis::RedisError> = conn.del(&blacklist_keys).await;
    }

    Ok(())
}

// Helper function to check if Redis is available
async fn redis_available() -> bool {
    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    match RedisClient::open(redis_url) {
        Ok(client) => {
            if let Ok(mut conn) = client.get_multiplexed_async_connection().await {
                // Try a simple operation instead of ping
                let _: Result<String, redis::RedisError> = conn.set("test_key", "test_value").await;
                true
            } else {
                false
            }
        }
        Err(_) => false,
    }
}

#[tokio::test]
async fn test_token_validation_with_redis() {
    if !redis_available().await {
        println!("⚠️  Redis not available, skipping Redis integration test");
        return;
    }

    cleanup_redis().await.unwrap();
    let mut jwt_service = get_test_jwt_service().expect("Failed to create JWT service");

    let user_id = "test-user-validation";
    let permissions = vec!["read".to_string()];

    let token_pair = jwt_service
        .generate_token_pair(user_id, None, permissions)
        .expect("Failed to generate token pair");

    let validation_result = jwt_service.validate_token(&token_pair.access_token).await;

    assert!(
        validation_result.is_ok(),
        "Should be able to validate access token"
    );

    let claims = validation_result.unwrap();
    assert_eq!(claims.sub, user_id);
    assert_eq!(claims.token_type, TokenType::Access);
}

#[tokio::test]
async fn test_token_blacklisting_with_redis() {
    if !redis_available().await {
        println!("⚠️  Redis not available, skipping Redis integration test");
        return;
    }

    cleanup_redis().await.unwrap();
    let mut jwt_service = get_test_jwt_service().expect("Failed to create JWT service");

    let user_id = "test-user-blacklist";
    let permissions = vec!["read".to_string()];

    let token_pair = jwt_service
        .generate_token_pair(user_id, None, permissions)
        .expect("Failed to generate token pair");

    // Token should be valid initially
    let validation_result = jwt_service.validate_token(&token_pair.access_token).await;
    assert!(
        validation_result.is_ok(),
        "Token should be valid before blacklisting"
    );

    // Blacklist the token
    let blacklist_result = jwt_service.blacklist_token(&token_pair.access_token).await;
    assert!(
        blacklist_result.is_ok(),
        "Should be able to blacklist token"
    );

    // Token should be invalid after blacklisting
    let validation_result = jwt_service.validate_token(&token_pair.access_token).await;
    assert!(
        validation_result.is_err(),
        "Token should be invalid after blacklisting"
    );

    match validation_result.unwrap_err() {
        JwtError::TokenBlacklisted => {} // Expected
        other => panic!("Expected TokenBlacklisted error, got: {:?}", other),
    }
}

#[tokio::test]
async fn test_session_management_with_redis() {
    if !redis_available().await {
        println!("⚠️  Redis not available, skipping Redis integration test");
        return;
    }

    cleanup_redis().await.unwrap();
    let mut jwt_service = get_test_jwt_service().expect("Failed to create JWT service");

    let session_info = SessionInfo {
        session_id: "test-session-123".to_string(),
        user_id: "test-user-session".to_string(),
        device_id: Some("test-device".to_string()),
        created_at: Utc::now(),
        last_accessed: Utc::now(),
        refresh_count: 0,
        is_active: true,
    };

    // Create session
    let create_result = jwt_service.create_session(&session_info).await;
    assert!(create_result.is_ok(), "Should be able to create session");

    // Retrieve session
    let get_result = jwt_service.get_session(&session_info.session_id).await;
    assert!(get_result.is_ok(), "Should be able to retrieve session");

    let retrieved_session = get_result.unwrap();
    assert_eq!(retrieved_session.session_id, session_info.session_id);
    assert_eq!(retrieved_session.user_id, session_info.user_id);
    assert_eq!(retrieved_session.device_id, session_info.device_id);

    // Update session access
    let update_result = jwt_service
        .update_session_access(&session_info.session_id)
        .await;
    assert!(
        update_result.is_ok(),
        "Should be able to update session access"
    );

    // Invalidate session
    let invalidate_result = jwt_service
        .invalidate_session(&session_info.session_id)
        .await;
    assert!(
        invalidate_result.is_ok(),
        "Should be able to invalidate session"
    );

    // Session should not be found after invalidation
    let get_result = jwt_service.get_session(&session_info.session_id).await;
    assert!(
        get_result.is_err(),
        "Session should not be found after invalidation"
    );
}

#[tokio::test]
async fn test_token_refresh_with_redis() {
    if !redis_available().await {
        println!("⚠️  Redis not available, skipping Redis integration test");
        return;
    }

    cleanup_redis().await.unwrap();
    let mut jwt_service = get_test_jwt_service().expect("Failed to create JWT service");

    let user_id = "test-user-token-refresh";
    let permissions = vec!["admin".to_string()];

    let original_token_pair = jwt_service
        .generate_token_pair(user_id, None, permissions)
        .expect("Failed to generate token pair");

    let refresh_result = jwt_service
        .refresh_token(&original_token_pair.refresh_token)
        .await;

    assert!(refresh_result.is_ok(), "Should be able to refresh token");

    let new_token_pair = refresh_result.unwrap();
    assert!(!new_token_pair.access_token.is_empty());
    assert!(!new_token_pair.refresh_token.is_empty());
    assert_ne!(
        new_token_pair.access_token,
        original_token_pair.access_token
    );
    assert_ne!(
        new_token_pair.refresh_token,
        original_token_pair.refresh_token
    );
}

#[tokio::test]
async fn test_user_sessions_with_redis() {
    if !redis_available().await {
        println!("⚠️  Redis not available, skipping Redis integration test");
        return;
    }

    cleanup_redis().await.unwrap();
    let mut jwt_service = get_test_jwt_service().expect("Failed to create JWT service");

    let user_id = "test-user-sessions";

    // Create multiple sessions for the same user
    let session1 = SessionInfo {
        session_id: "session-1".to_string(),
        user_id: user_id.to_string(),
        device_id: Some("device-1".to_string()),
        created_at: Utc::now(),
        last_accessed: Utc::now(),
        refresh_count: 0,
        is_active: true,
    };

    let session2 = SessionInfo {
        session_id: "session-2".to_string(),
        user_id: user_id.to_string(),
        device_id: Some("device-2".to_string()),
        created_at: Utc::now(),
        last_accessed: Utc::now(),
        refresh_count: 0,
        is_active: true,
    };

    jwt_service
        .create_session(&session1)
        .await
        .expect("Failed to create session 1");
    jwt_service
        .create_session(&session2)
        .await
        .expect("Failed to create session 2");

    // Get user sessions
    let user_sessions = jwt_service.get_user_sessions(user_id).await;
    assert!(user_sessions.is_ok(), "Should be able to get user sessions");

    let sessions = user_sessions.unwrap();
    assert_eq!(sessions.len(), 2, "Should have 2 sessions");

    // Invalidate all user sessions
    let invalidated_count = jwt_service.invalidate_all_user_sessions(user_id).await;
    assert!(
        invalidated_count.is_ok(),
        "Should be able to invalidate all sessions"
    );
    assert_eq!(
        invalidated_count.unwrap(),
        2,
        "Should have invalidated 2 sessions"
    );

    // Check that sessions are gone
    let user_sessions = jwt_service.get_user_sessions(user_id).await;
    assert!(
        user_sessions.is_ok(),
        "Should be able to query user sessions"
    );
    let sessions = user_sessions.unwrap();
    assert_eq!(
        sessions.len(),
        0,
        "Should have no sessions after invalidation"
    );
}

#[tokio::test]
async fn test_analytics_refresh_with_redis() {
    if !redis_available().await {
        println!("⚠️  Redis not available, skipping Redis integration test");
        return;
    }

    cleanup_redis().await.unwrap();
    let mut jwt_service = get_test_jwt_service().expect("Failed to create JWT service");

    // Create some test data
    let session_info = SessionInfo {
        session_id: "analytics-session".to_string(),
        user_id: "analytics-user".to_string(),
        device_id: None,
        created_at: Utc::now(),
        last_accessed: Utc::now(),
        refresh_count: 0,
        is_active: true,
    };

    jwt_service
        .create_session(&session_info)
        .await
        .expect("Failed to create session");

    // Generate and blacklist a token
    let token_pair = jwt_service
        .generate_token_pair("test-user", None, vec!["read".to_string()])
        .expect("Failed to generate token pair");

    jwt_service
        .blacklist_token(&token_pair.access_token)
        .await
        .expect("Failed to blacklist token");

    // Refresh analytics from Redis
    let refresh_result = jwt_service.refresh_analytics().await;
    assert!(
        refresh_result.is_ok(),
        "Should be able to refresh analytics"
    );

    let analytics = jwt_service.get_analytics();
    assert!(
        analytics.active_sessions > 0,
        "Should have at least one active session"
    );
    assert!(
        analytics.blacklisted_tokens > 0,
        "Should have at least one blacklisted token"
    );
}

#[tokio::test]
async fn test_cleanup_with_redis() {
    if !redis_available().await {
        println!("⚠️  Redis not available, skipping Redis integration test");
        return;
    }

    cleanup_redis().await.unwrap();
    let mut jwt_service = get_test_jwt_service().expect("Failed to create JWT service");

    // Run cleanup (should work even with no expired sessions)
    let cleanup_result = jwt_service.cleanup_expired().await;
    assert!(cleanup_result.is_ok(), "Should be able to run cleanup");

    let cleaned_count = cleanup_result.unwrap();
    // Should be 0 since we just cleaned up and created no expired sessions
    assert_eq!(cleaned_count, 0, "Should have cleaned 0 expired sessions");
}

#[tokio::test]
async fn test_complete_flow_with_redis() {
    if !redis_available().await {
        println!("⚠️  Redis not available, skipping Redis integration test");
        return;
    }

    cleanup_redis().await.unwrap();
    let mut jwt_service = get_test_jwt_service().expect("Failed to create JWT service");

    let user_id = "test-user-complete-flow";
    let device_id = Some("test-device-123".to_string());
    let permissions = vec!["read".to_string(), "write".to_string()];

    // Step 1: Generate initial token pair
    let token_pair = jwt_service
        .generate_token_pair(user_id, device_id.clone(), permissions.clone())
        .expect("Failed to generate initial token pair");

    // Step 2: Validate access token
    let access_claims = jwt_service
        .validate_token(&token_pair.access_token)
        .await
        .expect("Failed to validate access token");

    assert_eq!(access_claims.sub, user_id);
    assert_eq!(access_claims.device_id, device_id);
    assert_eq!(access_claims.token_type, TokenType::Access);

    // Step 3: Create session
    let session_info = SessionInfo {
        session_id: access_claims.session_id.clone(),
        user_id: user_id.to_string(),
        device_id: device_id.clone(),
        created_at: Utc::now(),
        last_accessed: Utc::now(),
        refresh_count: 0,
        is_active: true,
    };

    jwt_service
        .create_session(&session_info)
        .await
        .expect("Failed to create session");

    // Step 4: Refresh tokens
    let new_token_pair = jwt_service
        .refresh_token(&token_pair.refresh_token)
        .await
        .expect("Failed to refresh token");

    // Step 5: Validate new access token
    let new_access_claims = jwt_service
        .validate_token(&new_token_pair.access_token)
        .await
        .expect("Failed to validate new access token");

    assert_eq!(new_access_claims.sub, user_id);
    assert_eq!(new_access_claims.refresh_count, 1);

    // Step 6: Clean up
    let invalidate_result = jwt_service
        .invalidate_session(&access_claims.session_id)
        .await;
    assert!(
        invalidate_result.is_ok(),
        "Should be able to invalidate session"
    );

    println!("✅ Complete Redis integration flow test passed!");
}
