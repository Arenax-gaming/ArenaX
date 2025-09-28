use crate::api_error::ApiError;
use crate::realtime::RedisClient;
use crate::db::DbPool;
use actix_web::{web, HttpResponse, Result};

pub async fn health_check(
    db_pool: web::Data<DbPool>,
    redis_client: Option<web::Data<RedisClient>>,
) -> Result<HttpResponse, ApiError> {
    // Check database connectivity
    let db_health = match crate::db::health_check(&db_pool).await {
        Ok(_) => {
            let pool_status = crate::db::get_pool_status(&db_pool).await;
            serde_json::json!({
                "status": "healthy",
                "connection": "ok",
                "pool_info": pool_status
            })
        }
        Err(e) => {
            tracing::error!("Database health check failed: {:?}", e);
            serde_json::json!({
                "status": "unhealthy",
                "connection": "failed",
                "error": e.to_string()
            })
        }
    };

    // Check Redis connection
    let redis_health = if let Some(redis) = redis_client {
        match redis.get_connection().await {
            Ok(_) => serde_json::json!({
                "status": "healthy",
                "connection": "connected"
            }),
            Err(e) => {
                tracing::error!("Redis health check failed: {:?}", e);
                serde_json::json!({
                    "status": "unhealthy",
                    "connection": "disconnected",
                    "error": e.to_string()
                })
            }
        }
    } else {
        serde_json::json!({
            "status": "not_configured",
            "connection": "not_configured"
        })
    };

    // TODO: Check Stellar network connectivity
    let stellar_health = serde_json::json!({
        "status": "not_implemented",
        "connection": "unknown"
    });

    // Determine overall health
    let is_healthy = db_health["status"] == "healthy" && redis_health["status"] != "unhealthy";

    let response = serde_json::json!({
        "status": if is_healthy { "healthy" } else { "unhealthy" },
        "timestamp": chrono::Utc::now(),
        "version": env!("CARGO_PKG_VERSION"),
        "services": {
            "database": db_health,
            "redis": redis_health,
            "stellar": stellar_health
        }
    });

    let status_code = if is_healthy { 200 } else { 503 };

    Ok(
        HttpResponse::build(actix_web::http::StatusCode::from_u16(status_code).unwrap())
            .json(response),
    )
}
