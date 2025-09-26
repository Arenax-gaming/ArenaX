use actix_web::{web, App, HttpServer};
use std::io;
use tokio::signal;

mod config;
mod db;
mod api_error;
mod telemetry;
mod middleware;
mod auth;
mod http;
mod service;

use crate::config::Config;
use crate::db::create_pool;
use crate::telemetry::init_telemetry;
use crate::middleware::cors_middleware;

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

    // Create Redis client (placeholder)
    // let redis_client = redis::Client::open(config.redis.url.clone()).unwrap();

    tracing::info!("Starting ArenaX backend server on {}:{}", config.server.host, config.server.port);

    let server = HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(db_pool.clone()))
            // .app_data(web::Data::new(redis_client.clone()))
            .wrap(cors_middleware())
            .wrap(actix_web::middleware::Logger::default())
            .service(
                web::scope("/api")
                    .route("/health", web::get().to(crate::http::health::health_check))
            )
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
