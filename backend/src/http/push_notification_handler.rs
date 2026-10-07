use actix_web::{web, HttpRequest, HttpResponse, Result};
use serde::Deserialize;
use std::collections::HashMap;

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::db::DbPool;
use crate::models::ApiResponse;
use std::sync::Arc;
use crate::service::PushNotificationService;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterDeviceRequest {
    pub device_token: String,
    #[serde(default = "default_platform")]
    pub platform: String,
    #[serde(default)]
    pub topics: Vec<String>,
}

fn default_platform() -> String {
    "unknown".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UnregisterDeviceRequest {
    pub device_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendPushRequest {
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub data: HashMap<String, String>,
}

/// POST /api/push/devices - Register (or update) a device token for the
/// current user (requires auth).
pub async fn register_device(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    push: web::Data<Arc<PushNotificationService>>,
    body: web::Json<RegisterDeviceRequest>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;
    if body.device_token.trim().is_empty() {
        return Err(ApiError::BadRequest("device_token is required".into()));
    }

    let id = push
        .register_device(pool.as_ref(), user_id, &body.device_token, &body.platform, &body.topics)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

    Ok(HttpResponse::Created().json(ApiResponse {
        data: serde_json::json!({ "id": id.to_string() }),
    }))
}

/// DELETE /api/push/devices - Deactivate a device token for the current user.
pub async fn unregister_device(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    push: web::Data<Arc<PushNotificationService>>,
    body: web::Json<UnregisterDeviceRequest>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;

    push.unregister_device(pool.as_ref(), user_id, &body.device_token)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

    Ok(HttpResponse::Ok().json(ApiResponse {
        data: serde_json::json!({ "ok": true }),
    }))
}

/// POST /api/push/send/{user_id} - Send a rich push notification to a user,
/// falling back to an in-app notification if delivery fails. Intended for
/// server-to-server use (admin/service callers), not end users.
pub async fn send_push_to_user(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    push: web::Data<Arc<PushNotificationService>>,
    path: web::Path<uuid::Uuid>,
    body: web::Json<SendPushRequest>,
) -> Result<HttpResponse, ApiError> {
    req.user_id().ok_or(ApiError::Unauthorized)?;
    let target_user_id = path.into_inner();

    let outcome = push
        .notify_user(pool.as_ref(), target_user_id, &body.title, &body.body, body.data.clone())
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

    Ok(HttpResponse::Ok().json(ApiResponse {
        data: serde_json::json!({ "pushed": matches!(outcome, crate::service::DeliveryOutcome::Pushed) }),
    }))
}
