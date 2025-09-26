use sqlx::{PgPool, postgres::PgPoolOptions};
use crate::config::Config;
use crate::api_error::ApiError;

pub type DbPool = PgPool;

pub async fn create_pool(config: &Config) -> Result<DbPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database.url)
        .await
}

pub async fn health_check(pool: &DbPool) -> Result<(), ApiError> {
    sqlx::query("SELECT 1")
        .execute(pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;
    Ok(())
}
