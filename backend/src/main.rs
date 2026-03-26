use actix_web::{web, App, HttpServer};
use std::io;
use std::sync::Arc;
use tokio::signal;

mod config;
mod db;
mod api_error;
mod telemetry;
// mod middleware; // temporarily disabled: pre-existing compilation issues
// mod auth;
// mod http;
// mod service;
mod realtime;

use crate::config::Config;
use crate::db::create_pool;
use crate::telemetry::init_telemetry;
use crate::realtime::event_bus::EventBus;
use crate::realtime::session_registry::SessionRegistry;
use crate::realtime::ws_broadcaster::{WsAddressBook, WsBroadcaster};

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

    // Create Redis connection manager
    let redis_client = redis::Client::open(config.redis.url.clone())
        .expect("Failed to create Redis client");
    let redis_conn = redis::aio::ConnectionManager::new(redis_client)
        .await
        .expect("Failed to create Redis connection manager");

    // Initialize real-time infrastructure
    let event_bus = EventBus::new(redis_conn.clone());
    let session_registry = Arc::new(SessionRegistry::new());
    let address_book = Arc::new(WsAddressBook::new());

    // Start Redis Pub/Sub subscriber (broadcasts to local WebSocket actors)
    let broadcaster = WsBroadcaster::new(
        config.redis.url.clone(),
        session_registry.clone(),
        address_book.clone(),
    );
    let _broadcaster_handles = broadcaster.start();

    tracing::info!("Starting ArenaX backend server on {}:{}", config.server.host, config.server.port);

    let server = HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(db_pool.clone()))
            .app_data(web::Data::new(event_bus.clone()))
            .app_data(web::Data::new(session_registry.clone()))
            .app_data(web::Data::new(address_book.clone()))
            .wrap(actix_web::middleware::Logger::default())
            .configure(crate::realtime::user_ws::configure_ws_route)
    })
    .bind((config.server.host.clone(), config.server.port))?
    .run();

    // Graceful shutdown
    let server_handle = server.handle();
    tokio::spawn(async move {
        signal::ctrl_c().await.expect("Failed to listen for shutdown signal");
        tracing::info!("Shutdown signal received, stopping server...");
        server_handle.stop(true).await;
    });

    server.await
}
