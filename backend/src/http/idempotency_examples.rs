use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::middleware::idempotency_middleware::IdempotencyMiddleware;
use crate::models::idempotency::IdempotencyPolicy;
use actix_web::{web, HttpResponse, Result};
use serde_json::json;
use std::time::Duration;

/// Apply idempotency middleware to specific routes
pub fn configure_idempotency_middleware(cfg: &mut web::ServiceConfig, db_pool: DbPool) {
    let policy = IdempotencyPolicy::default();
    let middleware = IdempotencyMiddleware::default(db_pool);

    // Apply middleware to all routes (the middleware will filter internally)
    cfg.app_data(web::Data::new(middleware));
}

/// Test endpoint to demonstrate idempotency behavior
pub async fn test_idempotency_behavior() -> Result<HttpResponse> {
    let response = json!({
        "message": "This endpoint demonstrates idempotency",
        "timestamp": chrono::Utc::now(),
        "request_id": uuid::Uuid::new_v4().to_string(),
        "note": "Send the same Idempotency-Key header to get the same response"
    });

    Ok(HttpResponse::Ok().json(response))
}

/// Simulate a payment operation that should be idempotent
pub async fn create_payment_simulation(
    body: web::Json<serde_json::Value>,
) -> Result<HttpResponse> {
    // Simulate payment processing
    let amount = body.get("amount").and_then(|v| v.as_i64()).unwrap_or(100);
    let currency = body.get("currency").and_then(|v| v.as_str()).unwrap_or("USD");
    
    let response = json!({
        "payment_id": uuid::Uuid::new_v4().to_string(),
        "amount": amount,
        "currency": currency,
        "status": "completed",
        "processed_at": chrono::Utc::now(),
        "message": "Payment processed successfully"
    });

    Ok(HttpResponse::Created().json(response))
}

/// Simulate a refund operation that should be idempotent
pub async fn create_refund_simulation(
    body: web::Json<serde_json::Value>,
) -> Result<HttpResponse> {
    let payment_id = body.get("payment_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    let amount = body.get("amount").and_then(|v| v.as_i64()).unwrap_or(0);
    
    let response = json!({
        "refund_id": uuid::Uuid::new_v4().to_string(),
        "payment_id": payment_id,
        "amount": amount,
        "status": "processed",
        "processed_at": chrono::Utc::now(),
        "message": "Refund processed successfully"
    });

    Ok(HttpResponse::Created().json(response))
}

/// Simulate a wallet deposit that should be idempotent
pub async fn wallet_deposit_simulation(
    body: web::Json<serde_json::Value>,
) -> Result<HttpResponse> {
    let amount = body.get("amount").and_then(|v| v.as_i64()).unwrap_or(0);
    let user_id = body.get("user_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    
    let response = json!({
        "transaction_id": uuid::Uuid::new_v4().to_string(),
        "user_id": user_id,
        "amount": amount,
        "type": "deposit",
        "status": "completed",
        "balance_after": 1000 + amount, // Mock balance
        "processed_at": chrono::Utc::now()
    });

    Ok(HttpResponse::Created().json(response))
}

/// Demonstrate conflict scenario
pub async fn demonstrate_conflict(
    body: web::Json<serde_json::Value>,
) -> Result<HttpResponse> {
    let operation = body.get("operation").and_then(|v| v.as_str()).unwrap_or("unknown");
    
    let response = json!({
        "operation": operation,
        "result": "success",
        "timestamp": chrono::Utc::now(),
        "note": "This response will be cached. Try sending a different body with the same Idempotency-Key to see a conflict."
    });

    Ok(HttpResponse::Ok().json(response))
}

/// Health check for idempotency system
pub async fn idempotency_health_check(
    db_pool: web::Data<DbPool>,
) -> Result<HttpResponse> {
    // Check database connectivity
    let db_check = sqlx::query_scalar!("SELECT 1 as health_check")
        .fetch_one(db_pool.as_ref())
        .await
        .is_ok();

    let status = if db_check { "healthy" } else { "unhealthy" };
    let status_code = if db_check { 200 } else { 503 };

    let response = json!({
        "status": status,
        "timestamp": chrono::Utc::now(),
        "checks": {
            "database": db_check,
            "middleware": true
        }
    });

    Ok(HttpResponse::build(actix_web::http::StatusCode::from_u16(status_code).unwrap())
        .json(response))
}

/// Get idempotency configuration (for debugging)
pub async fn get_idempotency_config() -> Result<HttpResponse> {
    let policy = IdempotencyPolicy::default();
    
    let response = json!({
        "policy": {
            "enabled_routes": policy.enabled_routes,
            "default_ttl_seconds": policy.default_ttl_seconds,
            "max_response_size_kb": policy.max_response_size_kb,
            "key_header_name": policy.key_header_name,
            "conflict_status_code": policy.conflict_status_code
        },
        "usage": {
            "header_example": "Idempotency-Key: your-unique-key-12345",
            "conflict_response": {
                "status": 409,
                "body": {
                    "error": "IdempotencyKeyConflict",
                    "message": "This idempotency key has already been used with a different request"
                }
            },
            "cached_response_headers": [
                "X-Idempotency-Cached: true",
                "X-Idempotency-Timestamp: 2024-01-01T00:00:00Z"
            ]
        }
    });

    Ok(HttpResponse::Ok().json(response))
}

/// Performance test endpoint (creates many keys)
pub async fn performance_test(
    query: web::Query<PerformanceTestQuery>,
    db_pool: web::Data<DbPool>,
) -> Result<HttpResponse> {
    let count = query.count.unwrap_or(100).min(1000); // Max 1000 for safety
    let service = crate::service::idempotency_service::IdempotencyService::default(db_pool.as_ref().clone());
    
    let start_time = std::time::Instant::now();
    let mut created_keys = Vec::new();
    
    for i in 0..count {
        let key = format!("test_key_{}_{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0), i);
        let placeholder_response = crate::models::idempotency::CachedResponse::new(
            200,
            json!({}),
            json!({})
        );
        
        if let Ok(_) = service.store_key(
            key.clone(),
            format!("hash_{}", i),
            placeholder_response,
        ).await {
            created_keys.push(key);
        }
    }
    
    let duration = start_time.elapsed();
    
    let response = json!({
        "test_results": {
            "requested_count": count,
            "created_count": created_keys.len(),
            "duration_ms": duration.as_millis(),
            "keys_per_second": (created_keys.len() as f64 / duration.as_secs_f64()) as u64,
            "avg_time_per_key_ms": (duration.as_millis() as f64 / created_keys.len() as f64) as u64
        }
    });

    Ok(HttpResponse::Ok().json(response))
}

#[derive(serde::Deserialize)]
pub struct PerformanceTestQuery {
    pub count: Option<usize>
}

/// Cleanup test data (admin only)
pub async fn cleanup_test_data(
    db_pool: web::Data<DbPool>,
) -> Result<HttpResponse> {
    let service = crate::service::idempotency_service::IdempotencyService::default(db_pool.as_ref().clone());
    
    // Clean up test keys
    let result = sqlx::query!(
        "DELETE FROM idempotency_keys WHERE key LIKE 'test_key_%'"
    )
    .execute(db_pool.as_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;
    
    let response = json!({
        "message": "Test data cleaned up",
        "deleted_count": result.rows_affected()
    });

    Ok(HttpResponse::Ok().json(response))
}
