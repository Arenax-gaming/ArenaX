use arenax_backend::auth::jwt_service::{Claims, TokenType};
use arenax_backend::db::DbPool;
use arenax_backend::realtime::auth::RealtimeAuth;
use uuid::Uuid;
use chrono::{Duration, Utc};

/// User-channel authorization is decided from the claims alone, so the pool
/// is created lazily and never connects.
fn lazy_pool() -> DbPool {
    sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://localhost/arenax")
        .expect("lazy pool construction does not connect")
}

#[tokio::test]
async fn test_authorize_user_channel_success() {
    let db_pool = lazy_pool();
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
    let db_pool = lazy_pool();
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
