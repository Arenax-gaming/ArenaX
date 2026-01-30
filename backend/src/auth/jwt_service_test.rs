#[cfg(test)]
mod integration_tests {
    use crate::auth::jwt_service::*;
    use chrono::Duration;
    use redis::aio::ConnectionManager;
    use redis::Client;
    use uuid::Uuid;

    async fn create_test_service() -> JwtService {
        let config = JwtConfig {
            secret_key: "test_secret_key_for_integration_testing_12345".to_string(),
            access_token_expiry: Duration::minutes(15),
            refresh_token_expiry: Duration::days(7),
            algorithm: jsonwebtoken::Algorithm::HS256,
            issuer: Some("ArenaX-Test".to_string()),
            audience: Some("ArenaX-Test-API".to_string()),
        };

        // Try to connect to Redis, fallback to mock if not available
        let redis_client = Client::open("redis://127.0.0.1:6379/")
            .expect("Failed to create Redis client for testing");
        let conn = ConnectionManager::new(redis_client)
            .await
            .expect("Failed to connect to Redis for testing");

        JwtService::new(config, conn)
    }

    #[tokio::test]
    async fn test_generate_access_token() {
        let service = create_test_service().await;
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string(), "premium".to_string()];

        let token = service
            .generate_access_token(user_id, roles.clone(), None)
            .await;

        assert!(token.is_ok());
        let token_str = token.unwrap();
        assert!(!token_str.is_empty());
    }

    #[tokio::test]
    async fn test_generate_refresh_token() {
        let service = create_test_service().await;
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string()];

        let token = service
            .generate_refresh_token(user_id, roles, None)
            .await;

        assert!(token.is_ok());
    }

    #[tokio::test]
    async fn test_generate_token_pair() {
        let service = create_test_service().await;
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string()];

        let result = service
            .generate_token_pair(user_id, roles, None)
            .await;

        assert!(result.is_ok());

        let token_pair = result.unwrap();
        assert!(!token_pair.access_token.is_empty());
        assert!(!token_pair.refresh_token.is_empty());
        assert_eq!(token_pair.token_type, "Bearer");
        assert_eq!(token_pair.expires_in, 15 * 60); // 15 minutes
    }

    #[tokio::test]
    async fn test_validate_token_success() {
        let service = create_test_service().await;
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string()];

        let token = service
            .generate_access_token(user_id, roles.clone(), Some("device-123".to_string()))
            .await
            .unwrap();

        let result = service.validate_token(&token).await;

        assert!(result.is_ok());

        let claims = result.unwrap();
        assert_eq!(claims.sub, user_id.to_string());
        assert_eq!(claims.token_type, TokenType::Access);
        assert_eq!(claims.device_id, Some("device-123".to_string()));
        assert_eq!(claims.roles, roles);
    }

    #[tokio::test]
    async fn test_validate_invalid_token() {
        let service = create_test_service().await;
        let invalid_token = "invalid.token.string";

        let result = service.validate_token(invalid_token).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_token_refresh() {
        let service = create_test_service().await;
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string()];

        // Generate initial token pair
        let initial_pair = service
            .generate_token_pair(user_id, roles, None)
            .await
            .unwrap();

        // Refresh using refresh token
        let result = service.refresh_token(&initial_pair.refresh_token).await;

        assert!(result.is_ok());

        let new_pair = result.unwrap();
        assert!(!new_pair.access_token.is_empty());
        assert_ne!(new_pair.access_token, initial_pair.access_token);
    }

    #[tokio::test]
    async fn test_refresh_with_access_token_fails() {
        let service = create_test_service().await;
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string()];

        let token_pair = service
            .generate_token_pair(user_id, roles, None)
            .await
            .unwrap();

        // Try to refresh with access token (should fail)
        let result = service.refresh_token(&token_pair.access_token).await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), JwtError::InvalidToken));
    }

    #[tokio::test]
    async fn test_token_blacklisting() {
        let service = create_test_service().await;
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string()];

        let token = service
            .generate_access_token(user_id, roles, None)
            .await
            .unwrap();

        // Validate token (should succeed)
        assert!(service.validate_token(&token).await.is_ok());

        // Blacklist token
        let blacklist_result = service.blacklist_token(&token, "Test blacklist").await;
        assert!(blacklist_result.is_ok());

        // Validate token again (should fail)
        let result = service.validate_token(&token).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), JwtError::TokenBlacklisted));
    }

    #[tokio::test]
    async fn test_session_management() {
        let service = create_test_service().await;
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string()];

        // Generate token (creates session)
        service
            .generate_access_token(user_id, roles, Some("device-1".to_string()))
            .await
            .unwrap();

        // Get user sessions
        let sessions = service.get_user_sessions(user_id).await;
        assert!(sessions.is_ok());

        let session_list = sessions.unwrap();
        assert!(!session_list.is_empty());
        assert_eq!(session_list[0].user_id, user_id);
    }

    #[tokio::test]
    async fn test_revoke_user_sessions() {
        let service = create_test_service().await;
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string()];

        // Create multiple sessions
        for i in 0..3 {
            service
                .generate_access_token(
                    user_id,
                    roles.clone(),
                    Some(format!("device-{}", i)),
                )
                .await
                .unwrap();
        }

        // Verify sessions exist
        let sessions_before = service.get_user_sessions(user_id).await.unwrap();
        assert_eq!(sessions_before.len(), 3);

        // Revoke all sessions
        let count = service.revoke_user_sessions(user_id).await;
        assert!(count.is_ok());
        assert_eq!(count.unwrap(), 3);

        // Verify sessions are gone
        let sessions_after = service.get_user_sessions(user_id).await.unwrap();
        assert!(sessions_after.is_empty());
    }

    #[tokio::test]
    async fn test_token_analytics() {
        let service = create_test_service().await;
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string()];

        // Generate and validate some tokens
        let token = service
            .generate_access_token(user_id, roles, None)
            .await
            .unwrap();

        service.validate_token(&token).await.unwrap();

        // Get analytics
        let analytics = service.get_analytics().await;
        assert!(analytics.is_ok());

        let stats = analytics.unwrap();
        assert!(stats.total_validated > 0);
    }

    #[tokio::test]
    async fn test_key_rotation() {
        let service = create_test_service().await;

        // Check if rotation is needed
        let should_rotate = service.check_key_rotation().await;
        assert!(!should_rotate); // Should not rotate immediately

        // Perform key rotation
        let new_key = "new_rotated_key_for_testing_67890".to_string();
        let rotation_result = service.rotate_keys(new_key.clone()).await;
        assert!(rotation_result.is_ok());

        // Generate token with new key
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string()];
        let token = service
            .generate_access_token(user_id, roles, None)
            .await
            .unwrap();

        // Should be able to validate with new key
        assert!(service.validate_token(&token).await.is_ok());
    }

    #[tokio::test]
    async fn test_multi_device_sessions() {
        let service = create_test_service().await;
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string()];

        // Create sessions from multiple devices
        let devices = vec!["mobile", "desktop", "tablet"];
        for device in &devices {
            service
                .generate_access_token(user_id, roles.clone(), Some(device.to_string()))
                .await
                .unwrap();
        }

        // Get all sessions
        let sessions = service.get_user_sessions(user_id).await.unwrap();
        assert_eq!(sessions.len(), devices.len());

        // Verify each device has a session
        for device in &devices {
            assert!(sessions
                .iter()
                .any(|s| s.device_id.as_ref().map(|d| d.as_str()) == Some(*device)));
        }
    }

    #[tokio::test]
    async fn test_session_cleanup() {
        let service = create_test_service().await;

        // Create some test sessions
        for _ in 0..5 {
            let user_id = Uuid::new_v4();
            service
                .generate_access_token(user_id, vec!["user".to_string()], None)
                .await
                .unwrap();
        }

        // Run cleanup (should not remove non-expired sessions)
        let cleaned = service.cleanup_expired_sessions().await;
        assert!(cleaned.is_ok());
    }

    #[tokio::test]
    async fn test_claims_roles() {
        let service = create_test_service().await;
        let user_id = Uuid::new_v4();
        let roles = vec!["user".to_string(), "admin".to_string(), "premium".to_string()];

        let token = service
            .generate_access_token(user_id, roles.clone(), None)
            .await
            .unwrap();

        let claims = service.validate_token(&token).await.unwrap();

        assert_eq!(claims.roles.len(), 3);
        assert!(claims.roles.contains(&"user".to_string()));
        assert!(claims.roles.contains(&"admin".to_string()));
        assert!(claims.roles.contains(&"premium".to_string()));
    }
}
