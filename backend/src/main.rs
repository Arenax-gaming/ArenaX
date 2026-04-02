#![allow(dead_code)]

use actix_web::{web, App, HttpServer};
use std::io;
use std::sync::Arc;
use tokio::signal;

mod api_error;
mod auth;
mod config;
mod db;
mod http;
mod middleware;
mod models;
mod orchestrator;
mod realtime;
mod service;
mod telemetry;

use crate::config::Config;
use crate::db::create_pool;
use crate::middleware::cors_middleware;
use crate::middleware::idempotency_middleware::IdempotencyMiddleware;
use crate::service::ReaperService;
use crate::realtime::event_bus::EventBus;
use crate::realtime::session_registry::SessionRegistry;
use crate::realtime::ws_broadcaster::{WsAddressBook, WsBroadcaster};
use crate::service::matchmaker::{EloEngine, MatchmakerService, MatchmakingConfig};
use crate::service::ReaperService;
use crate::telemetry::init_telemetry;

#[tokio::main]
async fn main() -> io::Result<()> {
    // Load configuration
    let config = Config::from_env().expect("Failed to load configuration");

    // Initialize telemetry
    init_telemetry();

    // Create database pool
    let db_pool = create_pool(&config)
        .await
        .expect("Failed to create database pool");

    // Spawn the Reaper — forfeits players who miss the reporting deadline
    let reaper = Arc::new(ReaperService::new(db_pool.clone()));
    reaper.run();

    // Create Redis client (placeholder)
    // let redis_client = redis::Client::open(config.redis.url.clone()).unwrap();
    // Spawn tournament orchestrator polling worker
    let _orchestrator_handle =
        crate::orchestrator::TournamentOrchestrator::spawn_polling_worker(db_pool.clone(), 60);
    tracing::info!("Tournament orchestrator polling worker started");

    // Create Redis connection manager
    let redis_client =
        redis::Client::open(config.redis.url.clone()).expect("Failed to create Redis client");
    let redis_conn = redis::aio::ConnectionManager::new(redis_client.clone())
        .await
        .expect("Failed to create Redis connection manager");

    // Initialize matchmaking service
    let matchmaking_config = MatchmakingConfig::default();
    let matchmaker_service = Arc::new(MatchmakerService::new(
        db_pool.clone(),
        redis_client.clone(),
        matchmaking_config,
    ));

    // Start background matchmaker worker
    let matchmaker_worker = matchmaker_service.clone();
    tokio::spawn(async move {
        if let Err(e) = matchmaker_worker.start_matchmaker_worker().await {
            tracing::error!("Matchmaker worker error: {:?}", e);
        }
    });
    tracing::info!("Matchmaker worker started");

    // Initialize ELO engine
    let elo_engine = Arc::new(EloEngine::new(32.0)); // K-Factor 32

    // Initialize real-time infrastructure
    let event_bus = EventBus::new(redis_conn.clone());
    let session_registry = Arc::new(SessionRegistry::new());
    let address_book = Arc::new(WsAddressBook::new());

    // Initialize Auth Services for Realtime
    let jwt_config = crate::auth::jwt_service::JwtConfig::default();
    let jwt_service = Arc::new(crate::auth::jwt_service::JwtService::new(jwt_config, redis_conn.clone()));
    let auth_guard = Arc::new(crate::realtime::auth::RealtimeAuth::new(db_pool.clone()));

    // Start Redis Pub/Sub subscriber (broadcasts to local WebSocket actors)
    let broadcaster = WsBroadcaster::new(
        config.redis.url.clone(),
        session_registry.clone(),
        address_book.clone(),
    );
    let _broadcaster_handles = broadcaster.start();

    tracing::info!(
        "Starting ArenaX backend server on {}:{}",
        config.server.host,
        config.server.port
    );

    let server = HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(db_pool.clone()))
            .app_data(web::Data::new(event_bus.clone()))
            .app_data(web::Data::new(session_registry.clone()))
            .app_data(web::Data::new(address_book.clone()))
            .app_data(web::Data::new(jwt_service.clone()))
            .app_data(web::Data::new(auth_guard.clone()))
            .app_data(web::Data::new(matchmaker_service.clone()))
            .app_data(web::Data::new(elo_engine.clone()))
            .wrap(IdempotencyMiddleware::default(db_pool.clone()))
            .wrap(cors_middleware())
            .wrap(actix_web::middleware::Logger::default())
            .service(
                web::scope("/api")
                    .route("/health", web::get().to(crate::http::health::health_check))
                    .route(
                        "/notifications",
                        web::get().to(crate::http::notification_handler::get_notifications),
                    )
                    .route(
                        "/notifications",
                        web::post().to(crate::http::notification_handler::create_notification),
                    )
                    .route(
                        "/notifications/read-all",
                        web::patch().to(crate::http::notification_handler::mark_all_read),
                    )
                    .route(
                        "/notifications/{id}/read",
                        web::patch().to(crate::http::notification_handler::mark_notification_read),
                    )
                    .route(
                        "/notifications/{id}",
                        web::delete().to(crate::http::notification_handler::delete_notification),
                    )
                    // Reputation endpoints
                    .route(
                        "/reputation/player/{user_id}",
                        web::get().to(crate::http::reputation_handler::get_player_reputation),
                    )
                    .route(
                        "/reputation/history/{user_id}",
                        web::get().to(crate::http::reputation_handler::get_reputation_history),
                    )
                    .route(
                        "/reputation/bad-actors",
                        web::get().to(crate::http::reputation_handler::get_bad_actors),
                    )
                    .route(
                        "/reputation/bad-actors/{user_id}/remove",
                        web::post().to(crate::http::reputation_handler::remove_bad_actor_flag),
                    )
                    .route(
                        "/reputation/stats",
                        web::get().to(crate::http::reputation_handler::get_reputation_stats),
                    )
                    // Matchmaking endpoints
                    .service(
                        web::scope("/matchmaking")
                            .route("/join", web::post().to(crate::http::matchmaking::join_queue))
                            .route("/leave", web::post().to(crate::http::matchmaking::leave_queue))
                            .route("/status/{game}/{game_mode}", web::get().to(crate::http::matchmaking::get_queue_status))
                            .route("/stats", web::get().to(crate::http::matchmaking::get_matchmaking_stats))
                            .route("/elo/{game}", web::get().to(crate::http::matchmaking::get_elo))
                            .route("/elo/{game}/{page}/{limit}", web::get().to(crate::http::matchmaking::get_elo_history))
                    )
                    // Idempotency endpoints
                    .service(
                        web::scope("/idempotency")
                            .route("/generate-key", web::post().to(crate::http::idempotency::generate_key))
                            .route("/stats", web::get().to(crate::http::idempotency::get_stats))
                            .route("/user-keys", web::get().to(crate::http::idempotency::get_user_keys))
                            .route("/invalidate/{key}", web::delete().to(crate::http::idempotency::invalidate_key))
                            .route("/cleanup", web::post().to(crate::http::idempotency::cleanup_expired))
                            .route("/config", web::put().to(crate::http::idempotency::update_config))
                            .route("/config/{route}", web::get().to(crate::http::idempotency::get_route_config))
                            .route("/validate", web::post().to(crate::http::idempotency::validate_key))
                            .route("/info", web::get().to(crate::http::idempotency::get_framework_info))
                    )
                    // Idempotency test endpoints
                    .service(
                        web::scope("/test")
                            .route("/idempotency", web::post().to(crate::http::idempotency_examples::test_idempotency_behavior))
                            .route("/payment", web::post().to(crate::http::idempotency_examples::create_payment_simulation))
                            .route("/refund", web::post().to(crate::http::idempotency_examples::create_refund_simulation))
                            .route("/deposit", web::post().to(crate::http::idempotency_examples::wallet_deposit_simulation))
                            .route("/conflict", web::post().to(crate::http::idempotency_examples::demonstrate_conflict))
                            .route("/performance", web::get().to(crate::http::idempotency_examples::performance_test))
                            .route("/cleanup", web::delete().to(crate::http::idempotency_examples::cleanup_test_data))
                            .route("/health", web::get().to(crate::http::idempotency_examples::idempotency_health_check))
                            .route("/config", web::get().to(crate::http::idempotency_examples::get_idempotency_config))
                    ),
            )
            .configure(crate::realtime::user_ws::configure_ws_route)
    })
    .bind((config.server.host.clone(), config.server.port))?
    .run();

    // Graceful shutdown
    let server_handle = server.handle();
    tokio::spawn(async move {
        signal::ctrl_c()
            .await
            .expect("Failed to listen for shutdown signal");
        tracing::info!("Shutdown signal received, stopping server...");
        server_handle.stop(true).await;
    });

    server.await
}
