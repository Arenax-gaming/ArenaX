use crate::api_error::ApiError;
use crate::config::Config;
use sqlx::{migrate::MigrateDatabase, postgres::PgPoolOptions, PgPool, Postgres};
use std::time::Duration;

pub type DbPool = PgPool;

pub async fn create_pool(config: &Config) -> Result<DbPool, sqlx::Error> {
    // Create database if it doesn't exist
    if !Postgres::database_exists(&config.database.url)
        .await
        .unwrap_or(false)
    {
        tracing::info!("Database doesn't exist, creating...");
        Postgres::create_database(&config.database.url).await?;
    }

    let pool = PgPoolOptions::new()
        .max_connections(config.database.max_connections)
        .min_connections(config.database.min_connections)
        .acquire_timeout(Duration::from_secs(config.database.acquire_timeout))
        .idle_timeout(Duration::from_secs(config.database.idle_timeout))
        .max_lifetime(Duration::from_secs(config.database.max_lifetime))
        .connect(&config.database.url)
        .await?;

    // Run migrations
    tracing::info!("Running database migrations...");
    sqlx::migrate!("./migrations").run(&pool).await?;

    tracing::info!("Database pool created and migrations applied successfully");
    Ok(pool)
}

pub async fn health_check(pool: &DbPool) -> Result<(), ApiError> {
    sqlx::query("SELECT 1")
        .execute(pool)
        .await
        .map_err(ApiError::DatabaseError)?;
    Ok(())
}

pub async fn get_pool_status(pool: &DbPool) -> serde_json::Value {
    serde_json::json!({
        "size": pool.size(),
        "idle": pool.num_idle(),
        "is_closed": pool.is_closed()
    })
}
