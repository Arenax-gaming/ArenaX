use crate::api_error::ApiError;
use crate::realtime::RedisClient;
use crate::db::DbPool;
use actix_web::{web, HttpResponse, Result};

pub async fn health_check(
    db_pool: web::Data<DbPool>,
    redis_client: Option<web::Data<RedisClient>>,
) -> Result<HttpResponse, ApiError> {
    // Check database
    crate::db::health_check(&db_pool).await?;

    // Check Redis connection
    let redis_status = if let Some(redis) = redis_client {
        match redis.get_connection().await {
            Ok(_) => "connected",
            Err(_) => "disconnected",
        }
    } else {
        "not_configured"
    };

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "database": "connected",
        "redis": redis_status,
        "timestamp": chrono::Utc::now()
    })))
}
