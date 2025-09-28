use actix_web::{web, App, HttpServer};
use std::io;
use tokio::signal;

mod api_error;
mod auth;
mod config;
mod db;
mod http;
mod middleware;
mod service;
mod models;
mod realtime;
mod telemetry;

use crate::config::Config;
use crate::db::create_pool;
use crate::middleware::cors_middleware;
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

    // Create Redis client (placeholder)
    // let redis_client = redis::Client::open(config.redis.url.clone()).unwrap();

    tracing::info!(
        "Starting ArenaX backend server on {}:{}",
        config.server.host,
        config.server.port
    );

    let server = HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(db_pool.clone()))
            // .app_data(web::Data::new(redis_client.clone()))
            .wrap(cors_middleware())
            .wrap(actix_web::middleware::Logger::default())
            .service(
                web::scope("/api")
                    .route("/health", web::get().to(crate::http::health::health_check))
                    .service(
                        web::scope("/tournaments")
                            .route("", web::get().to(crate::http::tournaments::get_tournaments))
                            .route("", web::post().to(crate::http::tournaments::create_tournament))
                            .route("/{id}", web::get().to(crate::http::tournaments::get_tournament))
                            .route("/{id}/join", web::post().to(crate::http::tournaments::join_tournament))
                            .route("/{id}/status", web::put().to(crate::http::tournaments::update_tournament_status))
                            .route("/{id}/participants", web::get().to(crate::http::tournaments::get_tournament_participants))
                            .route("/{id}/bracket", web::get().to(crate::http::tournaments::get_tournament_bracket))
                    )
                    .service(
                        web::scope("/matches")
                            .route("/{id}", web::get().to(crate::http::matches::get_match))
                            .route("/{id}/report", web::post().to(crate::http::matches::report_score))
                            .route("/{id}/dispute", web::post().to(crate::http::matches::create_dispute))
                            .route("/matchmaking/join", web::post().to(crate::http::matches::join_matchmaking))
                            .route("/matchmaking/status", web::get().to(crate::http::matches::get_matchmaking_status))
                            .route("/matchmaking/leave", web::delete().to(crate::http::matches::leave_matchmaking))
                            .route("/elo/{game}", web::get().to(crate::http::matches::get_elo_rating))
                            .route("/history", web::get().to(crate::http::matches::get_match_history))
                            .route("/leaderboard", web::get().to(crate::http::matches::get_leaderboard))
                    )
                    .service(
                        web::scope("/ws")
                            .route("/tournament/{id}", web::get().to(crate::realtime::websocket::tournament_websocket))
                            .route("/match/{id}", web::get().to(crate::realtime::websocket::match_websocket))
                            .route("/global", web::get().to(crate::realtime::websocket::global_websocket))
                            .route("/user/{id}", web::get().to(crate::realtime::websocket::user_websocket))
                    )
                    .route("/health", web::get().to(crate::http::health::health_check)),
            )
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
