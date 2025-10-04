use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post, delete, put},
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    api_error::ApiError,
    auth::{DeviceService, DeviceError, RegisterDeviceRequest, DeviceResponse, DeviceAnalytics},
    models::{DeviceType, RiskLevel},
};

/// Device management routes
pub fn device_routes() -> Router<DeviceService> {
    Router::new()
        .route("/", post(register_device))
        .route("/", get(get_user_devices))
        .route("/:device_id", get(get_device))
        .route("/:device_id", delete(revoke_device))
        .route("/:device_id/trust", put(toggle_device_trust))
        .route("/:device_id/validate", post(validate_device))
        .route("/analytics", get(get_device_analytics))
        .route("/cleanup", post(cleanup_devices))
}

/// Register a new device
async fn register_device(
    State(device_service): State<DeviceService>,
    Json(request): Json<RegisterDeviceRequest>,
    // TODO: Extract user_id from JWT token
    // user_id: Uuid,
) -> Result<Json<DeviceResponse>, ApiError> {
    // For now, use a placeholder user_id - this should come from JWT token
    let user_id = Uuid::new_v4(); // TODO: Replace with actual user_id from JWT
    
    let device_info = crate::models::DeviceInfo {
        device_name: request.device_name,
        device_type: request.device_type,
        os_name: request.os_name,
        os_version: request.os_version,
        browser_name: request.browser_name,
        browser_version: request.browser_version,
        user_agent: request.user_agent,
        screen_resolution: request.screen_resolution,
        timezone: request.timezone,
        language: request.language,
        ip_address: "127.0.0.1".to_string(), // TODO: Extract from request
    };

    let device = device_service
        .register_device(user_id, device_info)
        .await
        .map_err(|e| match e {
            DeviceError::MaxDevicesExceeded => ApiError::new(
                "Maximum number of devices exceeded",
                StatusCode::BAD_REQUEST,
            ),
            DeviceError::DeviceAlreadyExists => ApiError::new(
                "Device already exists",
                StatusCode::CONFLICT,
            ),
            _ => ApiError::new(
                "Failed to register device",
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        })?;

    Ok(Json(DeviceResponse::from(device)))
}

/// Get all devices for the current user
async fn get_user_devices(
    State(device_service): State<DeviceService>,
    // TODO: Extract user_id from JWT token
    // user_id: Uuid,
) -> Result<Json<Vec<DeviceResponse>>, ApiError> {
    // For now, use a placeholder user_id - this should come from JWT token
    let user_id = Uuid::new_v4(); // TODO: Replace with actual user_id from JWT

    let devices = device_service
        .get_user_devices(user_id)
        .await
        .map_err(|_| ApiError::new(
            "Failed to get user devices",
            StatusCode::INTERNAL_SERVER_ERROR,
        ))?;

    Ok(Json(devices))
}

/// Get a specific device
async fn get_device(
    State(device_service): State<DeviceService>,
    Path(device_id): Path<Uuid>,
) -> Result<Json<DeviceResponse>, ApiError> {
    let device = device_service
        .get_device_by_id(device_id)
        .await
        .map_err(|e| match e {
            DeviceError::DeviceNotFound => ApiError::new(
                "Device not found",
                StatusCode::NOT_FOUND,
            ),
            _ => ApiError::new(
                "Failed to get device",
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        })?;

    Ok(Json(DeviceResponse::from(device)))
}

/// Revoke a device
async fn revoke_device(
    State(device_service): State<DeviceService>,
    Path(device_id): Path<Uuid>,
    // TODO: Extract user_id from JWT token
    // user_id: Uuid,
) -> Result<StatusCode, ApiError> {
    // For now, use a placeholder user_id - this should come from JWT token
    let user_id = Uuid::new_v4(); // TODO: Replace with actual user_id from JWT

    device_service
        .revoke_device(user_id, device_id)
        .await
        .map_err(|e| match e {
            DeviceError::DeviceNotFound => ApiError::new(
                "Device not found",
                StatusCode::NOT_FOUND,
            ),
            _ => ApiError::new(
                "Failed to revoke device",
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// Toggle device trust status
async fn toggle_device_trust(
    State(device_service): State<DeviceService>,
    Path(device_id): Path<Uuid>,
    Json(request): Json<ToggleTrustRequest>,
) -> Result<StatusCode, ApiError> {
    device_service
        .update_device_trust(device_id, request.is_trusted)
        .await
        .map_err(|_| ApiError::new(
            "Failed to update device trust",
            StatusCode::INTERNAL_SERVER_ERROR,
        ))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Validate device fingerprint
async fn validate_device(
    State(device_service): State<DeviceService>,
    Path(device_id): Path<Uuid>,
    Json(request): Json<ValidateDeviceRequest>,
) -> Result<Json<ValidateDeviceResponse>, ApiError> {
    let is_valid = device_service
        .validate_device(device_id, &request.fingerprint)
        .await
        .map_err(|_| ApiError::new(
            "Failed to validate device",
            StatusCode::INTERNAL_SERVER_ERROR,
        ))?;

    Ok(Json(ValidateDeviceResponse { is_valid }))
}

/// Get device analytics
async fn get_device_analytics(
    State(device_service): State<DeviceService>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<DeviceAnalytics>, ApiError> {
    let user_id = params
        .get("user_id")
        .and_then(|s| Uuid::parse_str(s).ok());

    let analytics = device_service
        .get_device_analytics(user_id)
        .await
        .map_err(|_| ApiError::new(
            "Failed to get device analytics",
            StatusCode::INTERNAL_SERVER_ERROR,
        ))?;

    Ok(Json(analytics))
}

/// Cleanup old device data
async fn cleanup_devices(
    State(device_service): State<DeviceService>,
) -> Result<StatusCode, ApiError> {
    device_service
        .cleanup_old_data()
        .await
        .map_err(|_| ApiError::new(
            "Failed to cleanup devices",
            StatusCode::INTERNAL_SERVER_ERROR,
        ))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Request/Response types

#[derive(Debug, Serialize, Deserialize)]
pub struct ToggleTrustRequest {
    pub is_trusted: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateDeviceRequest {
    pub fingerprint: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateDeviceResponse {
    pub is_valid: bool,
}

/// Device security policies endpoint
pub fn device_security_routes() -> Router<DeviceService> {
    Router::new()
        .route("/policies", get(get_security_policies))
        .route("/policies", put(update_security_policies))
        .route("/alerts", get(get_security_alerts))
        .route("/alerts/:alert_id/resolve", put(resolve_security_alert))
        .route("/monitor/:device_id", get(monitor_device))
}

/// Get security policies
async fn get_security_policies(
    State(device_service): State<DeviceService>,
) -> Result<Json<SecurityPoliciesResponse>, ApiError> {
    // TODO: Implement security policies retrieval
    let policies = SecurityPoliciesResponse {
        max_devices_per_user: 10,
        device_trust_threshold: 70,
        suspicious_activity_threshold: 3,
        location_change_threshold: 1000.0,
        session_timeout_minutes: 30,
        cleanup_inactive_days: 90,
        enable_geolocation: true,
        enable_device_fingerprinting: true,
        enable_security_monitoring: true,
        enable_notifications: true,
    };

    Ok(Json(policies))
}

/// Update security policies
async fn update_security_policies(
    State(_device_service): State<DeviceService>,
    Json(request): Json<UpdateSecurityPoliciesRequest>,
) -> Result<StatusCode, ApiError> {
    // TODO: Implement security policies update
    // This would update the DeviceConfig in the service
    
    Ok(StatusCode::NO_CONTENT)
}

/// Get security alerts
async fn get_security_alerts(
    State(_device_service): State<DeviceService>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<SecurityAlertResponse>>, ApiError> {
    // TODO: Implement security alerts retrieval
    let alerts = Vec::new();
    Ok(Json(alerts))
}

/// Resolve security alert
async fn resolve_security_alert(
    State(_device_service): State<DeviceService>,
    Path(alert_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    // TODO: Implement security alert resolution
    Ok(StatusCode::NO_CONTENT)
}

/// Monitor device for suspicious activity
async fn monitor_device(
    State(device_service): State<DeviceService>,
    Path(device_id): Path<Uuid>,
) -> Result<Json<DeviceMonitorResponse>, ApiError> {
    let alert = device_service
        .detect_suspicious_activity(device_id)
        .await
        .map_err(|_| ApiError::new(
            "Failed to monitor device",
            StatusCode::INTERNAL_SERVER_ERROR,
        ))?;

    let response = DeviceMonitorResponse {
        has_alert: alert.is_some(),
        alert: alert.map(|a| SecurityAlertResponse {
            id: a.id,
            alert_type: format!("{:?}", a.alert_type),
            severity: format!("{:?}", a.severity),
            title: a.title,
            description: a.description,
            created_at: a.created_at,
        }),
    };

    Ok(Json(response))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SecurityPoliciesResponse {
    pub max_devices_per_user: i32,
    pub device_trust_threshold: i32,
    pub suspicious_activity_threshold: i32,
    pub location_change_threshold: f64,
    pub session_timeout_minutes: i32,
    pub cleanup_inactive_days: i32,
    pub enable_geolocation: bool,
    pub enable_device_fingerprinting: bool,
    pub enable_security_monitoring: bool,
    pub enable_notifications: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateSecurityPoliciesRequest {
    pub max_devices_per_user: Option<i32>,
    pub device_trust_threshold: Option<i32>,
    pub suspicious_activity_threshold: Option<i32>,
    pub location_change_threshold: Option<f64>,
    pub session_timeout_minutes: Option<i32>,
    pub cleanup_inactive_days: Option<i32>,
    pub enable_geolocation: Option<bool>,
    pub enable_device_fingerprinting: Option<bool>,
    pub enable_security_monitoring: Option<bool>,
    pub enable_notifications: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SecurityAlertResponse {
    pub id: Uuid,
    pub alert_type: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceMonitorResponse {
    pub has_alert: bool,
    pub alert: Option<SecurityAlertResponse>,
}
