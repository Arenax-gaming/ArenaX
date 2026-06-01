use crate::api_error::ApiError;
use crate::config::{Config, MigrationMode};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;

pub type DbPool = PgPool;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn create_pool(config: &Config) -> Result<DbPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database.url)
        .await?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await?;

    Ok(pool)
}

pub async fn health_check(pool: &DbPool) -> Result<(), ApiError> {
    sqlx::query("SELECT 1")
        .execute(pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;
    Ok(())
}

pub async fn run_startup_migrations(
    config: &Config,
    pool: &DbPool,
) -> Result<(), sqlx::migrate::MigrateError> {
    match config.database.migration_mode {
        MigrationMode::Run => {
            info!("Running database migrations before backend startup");
            MIGRATOR.run(pool).await?;
            info!("Database migrations are up to date");
        }
        MigrationMode::Disabled => {
            info!("Skipping database migrations because BACKEND_MIGRATION_MODE=disabled");
        }
    }

    Ok(())
}
