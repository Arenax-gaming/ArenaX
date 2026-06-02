use crate::realtime::auth::RealtimeAuth;
use crate::auth::jwt_service::{Claims, TokenType};
use uuid::Uuid;
use chrono::{Duration, Utc};

#[tokio::test]
async fn test_authorize_user_channel_success() {
    let db_pool = crate::db::DbPool::new_test().await; // Assuming this exists or I'll mock it
    let auth = RealtimeAuth::new(db_pool);

    let user_id = Uuid::new_v4();
    let claims = Claims {
        sub: user_id.to_string(),
        exp: (Utc::now() + Duration::minutes(15)).timestamp(),
        iat: Utc::now().timestamp(),
        jti: Uuid::new_v4().to_string(),
        token_type: TokenType::Access,
        device_id: None,
        session_id: Uuid::new_v4().to_string(),
        roles: vec!["user".to_string()],
    };

    let channel = format!("user:{}", user_id);
    let result = auth.authorize_subscription(&claims, &channel).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_authorize_user_channel_denied() {
    let db_pool = crate::db::DbPool::new_test().await;
    let auth = RealtimeAuth::new(db_pool);

    let user_id = Uuid::new_v4();
    let other_user_id = Uuid::new_v4();
    let claims = Claims {
        sub: user_id.to_string(),
        exp: (Utc::now() + Duration::minutes(15)).timestamp(),
        iat: Utc::now().timestamp(),
        jti: Uuid::new_v4().to_string(),
        token_type: TokenType::Access,
        device_id: None,
        session_id: Uuid::new_v4().to_string(),
        roles: vec!["user".to_string()],
    };

    let channel = format!("user:{}", other_user_id);
    let result = auth.authorize_subscription(&claims, &channel).await;
    assert!(result.is_err());
}
