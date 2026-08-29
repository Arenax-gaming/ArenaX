use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::service::api_key_service::{
    ApiKeyService, CreateApiKeyRequest, CreateApiKeyResponse, GenerateApiKeyRequest,
    GenerateApiKeyResponse, RevokeApiKeyRequest, RotateApiKeyRequest, UpdateApiKeyRequest,
};
use crate::models::api_key::{ApiKeySummary, KeyStatus};
use actix_web::{web, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

// ── Request/Response DTOs ─────────────────────────────────────────────────────

/// Create API Key response (includes the raw key)
#[derive(Debug, Serialize)]
pub struct CreateApiKeyResponseDto {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub scopes: Vec<String>,
    pub expiration_date: Option<chrono::DateTime<chrono::Utc>>,
}

/// List API Keys response
#[derive(Debug, Serialize)]
pub struct ListApiKeysResponseDto {
    pub api_keys: Vec<ApiKeySummary>,
    pub total: usize,
}

/// Rotate API Key response
#[derive(Debug, Serialize)]
pub struct RotateApiKeyResponseDto {
    pub old_key_id: Uuid,
    pub new_key_id: Uuid,
    pub new_key: String,
    pub rotated_at: chrono::DateTime<chrono::Utc>,
}

/// Usage log entry
#[derive(Debug, Serialize)]
pub struct UsageLogDto {
    pub id: Uuid,
    pub endpoint: String,
    pub method: String,
    pub client_ip: Option<String>,
    pub user_agent: Option<String>,
    pub response_status: Option<i32>,
    pub request_duration_ms: Option<i32>,
    pub scopes_used: Vec<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// List usage logs response
#[derive(Debug, Serialize)]
pub struct ListUsageLogsResponseDto {
    pub logs: Vec<UsageLogDto>,
    pub total: usize,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /api/api-keys
///
/// Create a new API key with scoped permissions and optional rotation.
pub async fn create_api_key(
    api_key_service: web::Data<ApiKeyService>,
    req: actix_web::HttpRequest,
    request: web::Json<CreateApiKeyRequest>,
) -> Result<impl Responder, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let response: CreateApiKeyResponse = api_key_service
        .create_key(request.into_inner(), user_id)
        .await?;

    Ok(HttpResponse::Created().json(CreateApiKeyResponseDto {
        id: response.id,
        key: response.key,
        name: response.name,
        scopes: response.scopes,
        expiration_date: response.expiration_date,
    }))
}

/// GET /api/api-keys
///
/// List all API keys for the authenticated user.
pub async fn list_api_keys(
    api_key_service: web::Data<ApiKeyService>,
    req: actix_web::HttpRequest,
) -> Result<impl Responder, ApiError> {
    let _user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let api_keys = api_key_service
        .list_keys(_user_id)
        .await?;

    let total = api_keys.len();

    Ok(HttpResponse::Ok().json(ListApiKeysResponseDto { api_keys, total }))
}

/// GET /api/api-keys/{key_id}
///
/// Get details of a specific API key.
pub async fn get_api_key(
    api_key_service: web::Data<ApiKeyService>,
    req: actix_web::HttpRequest,
    path: web::Path<Uuid>,
) -> Result<impl Responder, ApiError> {
    let key_id = path.into_inner();
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let summary = api_key_service
        .get_key_summary_by_id(key_id, user_id)
        .await?;

    Ok(HttpResponse::Ok().json(summary))
}

/// PUT /api/api-keys/{key_id}
///
/// Update an API key's configuration.
pub async fn update_api_key(
    api_key_service: web::Data<ApiKeyService>,
    req: actix_web::HttpRequest,
    path: web::Path<Uuid>,
    request: web::Json<UpdateApiKeyRequest>,
) -> Result<impl Responder, ApiError> {
    let key_id = path.into_inner();
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let updated_key = api_key_service
        .update_key(key_id, user_id, request.into_inner())
        .await?;

    Ok(HttpResponse::Ok().json(updated_key))
}

/// DELETE /api/api-keys/{key_id}
///
/// Revoke an API key.
pub async fn revoke_api_key(
    api_key_service: web::Data<ApiKeyService>,
    req: actix_web::HttpRequest,
    path: web::Path<Uuid>,
    request: web::Json<RevokeApiKeyRequest>,
) -> Result<impl Responder, ApiError> {
    let key_id = path.into_inner();
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    api_key_service
        .revoke_key(key_id, user_id, request.into_inner())
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "message": "API key revoked successfully",
        "key_id": key_id
    })))
}

/// POST /api/api-keys/{key_id}/rotate
///
/// Rotate an API key (invalidate old key, create new key).
pub async fn rotate_api_key(
    api_key_service: web::Data<ApiKeyService>,
    req: actix_web::HttpRequest,
    path: web::Path<Uuid>,
    request: web::Json<RotateApiKeyRequest>,
) -> Result<impl Responder, ApiError> {
    let key_id = path.into_inner();
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let response = api_key_service
        .rotate_key(key_id, user_id, request.into_inner())
        .await?;

    Ok(HttpResponse::Ok().json(RotateApiKeyResponseDto {
        old_key_id: response.old_key_id,
        new_key_id: response.new_key_id,
        new_key: response.new_key,
        rotated_at: response.rotated_at,
    }))
}

/// GET /api/api-keys/{key_id}/usage
///
/// Get usage logs for a specific API key.
pub async fn list_usage_logs(
    api_key_service: web::Data<ApiKeyService>,
    req: actix_web::HttpRequest,
    path: web::Path<Uuid>,
    query: web::Query<UsageLogQuery>,
) -> Result<impl Responder, ApiError> {
    let key_id = path.into_inner();
    let _user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let logs = api_key_service
        .get_usage_logs(key_id, query.limit, query.offset)
        .await?;

    let total = logs.len();

    Ok(HttpResponse::Ok().json(ListUsageLogsResponseDto { logs, total }))
}

/// GET /api/api-keys/stats
///
/// Get API key statistics.
pub async fn get_api_key_stats(
    api_key_service: web::Data<ApiKeyService>,
    req: actix_web::HttpRequest,
) -> Result<impl Responder, ApiError> {
    let _claims = req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let stats = api_key_service.get_stats().await?;

    Ok(HttpResponse::Ok().json(stats))
}

/// Query parameters for usage logs
#[derive(Debug, Deserialize)]
pub struct UsageLogQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default = "default_offset")]
    pub offset: i64,
}

fn default_limit() -> i64 {
    50
}

fn default_offset() -> i64 {
    0
}

// ── Configure Routes ────────────────────────────────��───────────────────────

/// Configure API key routes
pub fn configure_api_key_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api-keys")
            .route("", web::post().to(create_api_key))
            .route("", web::get().to(list_api_keys))
            .route("/stats", web::get().to(get_api_key_stats))
            .route("/{key_id}", web::get().to(get_api_key))
            .route("/{key_id}", web::put().to(update_api_key))
            .route("/{key_id}", web::delete().to(revoke_api_key))
            .route("/{key_id}/rotate", web::post().to(rotate_api_key))
            .route("/{key_id}/usage", web::get().to(list_usage_logs)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_query_params() {
        let query = UsageLogQuery {
            limit: default_limit(),
            offset: default_offset(),
        };
        assert_eq!(query.limit, 50);
        assert_eq!(query.offset, 0);
    }
}