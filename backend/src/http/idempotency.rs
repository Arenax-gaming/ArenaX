use crate::api_error::ApiError;
use crate::auth::Claims;
use crate::db::DbPool;
use crate::models::idempotency::*;
use crate::service::idempotency_service::{IdempotencyService, IdempotencyKeyResponse};
use actix_web::{web, HttpResponse, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Generate a new idempotency key for client use
pub async fn generate_key(
    db_pool: web::Data<DbPool>,
    query: web::Query<IdempotencyKeyRequest>,
) -> Result<HttpResponse> {
    let idempotency_service = IdempotencyService::default(db_pool.as_ref().clone());
    
    let ttl = query.ttl_seconds.unwrap_or(86400); // Default 24 hours
    let key = IdempotencyService::generate_key();
    
    let response = IdempotencyKeyResponse::new(key.clone(), ttl);
    
    // Store the key with placeholder data (will be updated when actually used)
    let placeholder_response = CachedResponse::new(
        200,
        serde_json::json!({}),
        serde_json::json!({}),
    );
    
    if let Err(e) = idempotency_service.store_key(
        key.clone(),
        "placeholder".to_string(),
        placeholder_response,
    ).await {
        // Log error but still return the key to the client
        tracing::error!("Failed to pre-store idempotency key: {:?}", e);
    }
    
    Ok(HttpResponse::Ok().json(response))
}

/// Get idempotency statistics (admin only)
pub async fn get_stats(
    db_pool: web::Data<DbPool>,
    claims: web::ReqData<Claims>,
) -> Result<HttpResponse> {
    // Check if user is admin (implement based on your auth system)
    if !is_admin(&claims) {
        return Err(ApiError::forbidden("Admin access required").into());
    }
    
    let idempotency_service = IdempotencyService::default(db_pool.as_ref().clone());
    let stats = idempotency_service.get_usage_stats().await?;
    
    Ok(HttpResponse::Ok().json(stats))
}

/// Get user's idempotency keys (for debugging)
pub async fn get_user_keys(
    db_pool: web::Data<DbPool>,
    claims: web::ReqData<Claims>,
    query: web::Query<PaginationQuery>,
) -> Result<HttpResponse> {
    let idempotency_service = IdempotencyService::default(db_pool.as_ref().clone());
    let limit = query.limit.unwrap_or(50).min(100); // Max 100
    let offset = query.offset.unwrap_or(0);
    
    let keys = idempotency_service
        .get_user_keys(claims.user_id, limit, offset)
        .await?;
    
    Ok(HttpResponse::Ok().json(keys))
}

/// Invalidate an idempotency key (admin only)
pub async fn invalidate_key(
    db_pool: web::Data<DbPool>,
    claims: web::ReqData<Claims>,
    path: web::Path<String>,
) -> Result<HttpResponse> {
    if !is_admin(&claims) {
        return Err(ApiError::forbidden("Admin access required").into());
    }
    
    let key = path.into_inner();
    let idempotency_service = IdempotencyService::default(db_pool.as_ref().clone());
    
    idempotency_service.invalidate_key(&key).await?;
    
    Ok(HttpResponse::NoContent().finish())
}

/// Clean up expired keys (admin only)
pub async fn cleanup_expired(
    db_pool: web::Data<DbPool>,
    claims: web::ReqData<Claims>,
) -> Result<HttpResponse> {
    if !is_admin(&claims) {
        return Err(ApiError::forbidden("Admin access required").into());
    }
    
    let idempotency_service = IdempotencyService::default(db_pool.as_ref().clone());
    let cleaned_count = idempotency_service.cleanup_expired_keys().await?;
    
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "cleaned_keys": cleaned_count,
        "message": "Expired keys cleaned up successfully"
    })))
}

/// Update idempotency configuration (admin only)
pub async fn update_config(
    db_pool: web::Data<DbPool>,
    claims: web::ReqData<Claims>,
    config: web::Json<IdempotencyPolicy>,
) -> Result<HttpResponse> {
    if !is_admin(&claims) {
        return Err(ApiError::forbidden("Admin access required").into());
    }
    
    let idempotency_service = IdempotencyService::default(db_pool.as_ref().clone());
    idempotency_service.update_policy(config.into_inner()).await?;
    
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "message": "Idempotency configuration updated successfully"
    })))
}

/// Get route-specific configuration
pub async fn get_route_config(
    db_pool: web::Data<DbPool>,
    path: web::Path<String>,
) -> Result<HttpResponse> {
    let route_pattern = path.into_inner();
    let idempotency_service = IdempotencyService::default(db_pool.as_ref().clone());
    
    let config = idempotency_service.get_route_config(&route_pattern).await?;
    
    match config {
        Some(config) => Ok(HttpResponse::Ok().json(config)),
        None => Err(ApiError::not_found("Route configuration not found").into()),
    }
}

/// Validate idempotency key format
pub async fn validate_key(
    body: web::Json<ValidateKeyRequest>,
) -> Result<HttpResponse> {
    let key = &body.key;
    
    match IdempotencyService::validate_key_format(key) {
        Ok(()) => Ok(HttpResponse::Ok().json(serde_json::json!({
            "valid": true,
            "message": "Idempotency key format is valid"
        }))),
        Err(e) => Ok(HttpResponse::BadRequest().json(serde_json::json!({
            "valid": false,
            "error": e.message
        }))),
    }
}

/// Helper function to check if user is admin
fn is_admin(claims: &Claims) -> bool {
    // Implement based on your auth system
    // This could check user roles, permissions, etc.
    claims.user_id.to_string().starts_with("admin-") // Example implementation
}

#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ValidateKeyRequest {
    pub key: String,
}

#[derive(Debug, Serialize)]
pub struct IdempotencyInfo {
    pub enabled: bool,
    pub key_header: String,
    pub default_ttl: i32,
    pub max_response_size_kb: i32,
    pub enabled_routes: Vec<String>,
}

/// Get idempotency framework information
pub async fn get_framework_info() -> Result<HttpResponse> {
    let policy = IdempotencyPolicy::default();
    
    let info = IdempotencyInfo {
        enabled: true,
        key_header: policy.key_header_name,
        default_ttl: policy.default_ttl_seconds,
        max_response_size_kb: policy.max_response_size_kb,
        enabled_routes: policy.enabled_routes,
    };
    
    Ok(HttpResponse::Ok().json(info))
}

/// Test endpoint for idempotency (for testing purposes)
pub async fn test_idempotency(
    db_pool: web::Data<DbPool>,
    body: web::Json<serde_json::Value>,
) -> Result<HttpResponse> {
    let response_data = serde_json::json!({
        "message": "Test endpoint",
        "received_data": body,
        "timestamp": chrono::Utc::now(),
        "request_id": Uuid::new_v4()
    });
    
    Ok(HttpResponse::Ok().json(response_data))
}
