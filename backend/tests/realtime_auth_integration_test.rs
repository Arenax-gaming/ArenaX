use actix_web::{test, App, web};
use actix_web_actors::ws;
use arenax_backend::realtime::user_ws::{ws_handler, UserWebSocket};
use arenax_backend::realtime::session_registry::SessionRegistry;
use arenax_backend::realtime::auth::RealtimeAuth;
use arenax_backend::auth::jwt_service::{JwtService, JwtConfig};
use arenax_backend::db::DbPool;
use std::sync::Arc;
use uuid::Uuid;

#[tokio::test]
async fn test_ws_connection_requires_token() {
    let registry = Arc::new(SessionRegistry::new());
    let jwt_config = JwtConfig::default();
    let redis_client = redis::Client::open("redis://127.0.0.1/").unwrap();
    let redis_conn = redis::aio::ConnectionManager::new(redis_client).await.unwrap();
    let jwt_service = Arc::new(JwtService::new(jwt_config, redis_conn));
    let db_pool = DbPool::default(); // Mock for test
    let auth_guard = Arc::new(RealtimeAuth::new(db_pool));

    let app = test::init_service(
        App::new()
            .app_data(web::Data::new(registry.clone()))
            .app_data(web::Data::new(jwt_service.clone()))
            .app_data(web::Data::new(auth_guard.clone()))
            .route("/ws", web::get().to(ws_handler))
    ).await;

    // Test without token
    let req = test::TestRequest::with_uri("/ws").to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_ws_connection_with_valid_token() {
    let registry = Arc::new(SessionRegistry::new());
    let jwt_config = JwtConfig::default();
    let redis_client = redis::Client::open("redis://127.0.0.1/").unwrap();
    let redis_conn = redis::aio::ConnectionManager::new(redis_client).await.unwrap();
    let jwt_service = Arc::new(JwtService::new(jwt_config, redis_conn));
    let db_pool = DbPool::default();
    let auth_guard = Arc::new(RealtimeAuth::new(db_pool));

    let user_id = Uuid::new_v4();
    let token = jwt_service.generate_access_token(user_id, vec!["user".to_string()], None).await.unwrap();

    let app = test::init_service(
        App::new()
            .app_data(web::Data::new(registry.clone()))
            .app_data(web::Data::new(jwt_service.clone()))
            .app_data(web::Data::new(auth_guard.clone()))
            .route("/ws", web::get().to(ws_handler))
    ).await;

    // Test with valid token
    let uri = format="/ws?token={}", token;
    let req = test::TestRequest::with_uri(&uri).to_request();
    // ws::start would be called here, but in a test environment we'd need more setup for actual WS
    // For now, let's just assert it passes the upgrade check (which returns 101 Switching Protocols)
    let resp = test::call_service(&app, req).await;
    // Note: actix-web test::call_service for WS might return 101 or 400 depending on headers
    // But it definitely shouldn't be 401 Unauthorized
    assert_ne!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
}
