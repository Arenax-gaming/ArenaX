// Example integration of DeviceService into ArenaX application
// This file demonstrates how to integrate the device management system

use anyhow::Result;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post, put, delete},
    Router,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    auth::{
        DeviceConfig, DeviceService, DeviceNotificationService, SecurityPolicyEngine,
        PolicyEvaluationResult,
    },
    models::{DeviceInfo, DeviceType, RegisterDeviceRequest},
};

/// Example of integrating device service into main application
pub struct ArenaXApp {
    pub device_service: DeviceService,
    pub notification_service: DeviceNotificationService,
    pub security_policy_engine: SecurityPolicyEngine,
}

impl ArenaXApp {
    /// Initialize the application with device management
    pub async fn new(
        db_pool: PgPool,
        redis_url: &str,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        // Initialize device service
        let device_config = DeviceConfig::default();
        let device_service = DeviceService::new(db_pool.clone(), redis_url, Some(device_config.clone()))?;
        
        // Initialize notification service
        let notification_service = DeviceNotificationService::new(redis_url, Some("arenax"))?;
        
        // Initialize security policy engine
        let security_policy_engine = SecurityPolicyEngine::new(db_pool, device_config);

        Ok(Self {
            device_service,
            notification_service,
            security_policy_engine,
        })
    }

    /// Create device management routes
    pub fn device_routes(&self) -> Router<Self> {
        Router::new()
            .route("/devices", post(Self::register_device_handler))
            .route("/devices", get(Self::get_user_devices_handler))
            .route("/devices/:device_id", get(Self::get_device_handler))
            .route("/devices/:device_id", delete(Self::revoke_device_handler))
            .route("/devices/:device_id/trust", put(Self::toggle_device_trust_handler))
            .route("/devices/:device_id/validate", post(Self::validate_device_handler))
            .route("/devices/analytics", get(Self::get_device_analytics_handler))
            .route("/devices/cleanup", post(Self::cleanup_devices_handler))
            .route("/notifications", get(Self::get_notifications_handler))
            .route("/notifications/:notification_id/read", put(Self::mark_notification_read_handler))
            .route("/security/policies", get(Self::get_security_policies_handler))
            .route("/security/policies", put(Self::update_security_policies_handler))
            .route("/security/alerts", get(Self::get_security_alerts_handler))
            .route("/security/alerts/:alert_id/resolve", put(Self::resolve_security_alert_handler))
    }

    /// Register device handler with security policy evaluation
    async fn register_device_handler(
        State(app): State<Self>,
        Json(request): Json<RegisterDeviceRequest>,
        // TODO: Extract user_id from JWT token
    ) -> Result<Json<serde_json::Value>, StatusCode> {
        let user_id = Uuid::new_v4(); // TODO: Replace with actual user_id from JWT

        // Convert request to DeviceInfo
        let device_info = DeviceInfo {
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

        // Evaluate against security policies
        let policy_result = app.security_policy_engine
            .evaluate_device_registration(user_id, &device_info)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if !policy_result.is_allowed {
            // Apply policy actions for violations
            let _action_results = app.security_policy_engine
                .apply_policy_actions(
                    Uuid::new_v4(), // device_id - will be generated after registration
                    user_id,
                    &policy_result.violations,
                )
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            return Err(StatusCode::FORBIDDEN);
        }

        // Register device
        let device = app.device_service
            .register_device(user_id, device_info)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Send notification
        let _ = app.notification_service
            .send_device_registered(
                user_id,
                device.id,
                &device.device_name,
                &device.ip_address,
            )
            .await;

        // Apply policy actions for warnings
        if !policy_result.warnings.is_empty() {
            let _action_results = app.security_policy_engine
                .apply_policy_actions(device.id, user_id, &policy_result.warnings)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }

        Ok(Json(serde_json::json!({
            "device": device,
            "policy_evaluation": policy_result,
            "requires_verification": policy_result.requires_verification
        })))
    }

    /// Get user devices handler
    async fn get_user_devices_handler(
        State(app): State<Self>,
        // TODO: Extract user_id from JWT token
    ) -> Result<Json<Vec<crate::models::DeviceResponse>>, StatusCode> {
        let user_id = Uuid::new_v4(); // TODO: Replace with actual user_id from JWT

        let devices = app.device_service
            .get_user_devices(user_id)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        Ok(Json(devices))
    }

    /// Get device handler
    async fn get_device_handler(
        State(app): State<Self>,
        Path(device_id): Path<Uuid>,
    ) -> Result<Json<crate::models::DeviceResponse>, StatusCode> {
        let device = app.device_service
            .get_device_by_id(device_id)
            .await
            .map_err(|_| StatusCode::NOT_FOUND)?;

        Ok(Json(crate::models::DeviceResponse::from(device)))
    }

    /// Revoke device handler
    async fn revoke_device_handler(
        State(app): State<Self>,
        Path(device_id): Path<Uuid>,
        // TODO: Extract user_id from JWT token
    ) -> Result<StatusCode, StatusCode> {
        let user_id = Uuid::new_v4(); // TODO: Replace with actual user_id from JWT

        // Get device info before revocation for notification
        let device = app.device_service
            .get_device_by_id(device_id)
            .await
            .map_err(|_| StatusCode::NOT_FOUND)?;

        // Revoke device
        app.device_service
            .revoke_device(user_id, device_id)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Send notification
        let _ = app.notification_service
            .send_device_revoked(user_id, device_id, &device.device_name)
            .await;

        Ok(StatusCode::NO_CONTENT)
    }

    /// Toggle device trust handler
    async fn toggle_device_trust_handler(
        State(app): State<Self>,
        Path(device_id): Path<Uuid>,
        Json(request): Json<ToggleTrustRequest>,
    ) -> Result<StatusCode, StatusCode> {
        // Update device trust
        app.device_service
            .update_device_trust(device_id, request.is_trusted)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Get device info for notification
        let device = app.device_service
            .get_device_by_id(device_id)
            .await
            .map_err(|_| StatusCode::NOT_FOUND)?;

        // Send notification
        let _ = app.notification_service
            .send_trust_status_changed(
                device.user_id,
                device_id,
                &device.device_name,
                request.is_trusted,
            )
            .await;

        Ok(StatusCode::NO_CONTENT)
    }

    /// Validate device handler
    async fn validate_device_handler(
        State(app): State<Self>,
        Path(device_id): Path<Uuid>,
        Json(request): Json<ValidateDeviceRequest>,
    ) -> Result<Json<ValidateDeviceResponse>, StatusCode> {
        let is_valid = app.device_service
            .validate_device(device_id, &request.fingerprint)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        Ok(Json(ValidateDeviceResponse { is_valid }))
    }

    /// Get device analytics handler
    async fn get_device_analytics_handler(
        State(app): State<Self>,
        // TODO: Extract user_id from JWT token for user-specific analytics
    ) -> Result<Json<crate::models::DeviceAnalytics>, StatusCode> {
        let analytics = app.device_service
            .get_device_analytics(None) // Get global analytics
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        Ok(Json(analytics))
    }

    /// Cleanup devices handler
    async fn cleanup_devices_handler(
        State(app): State<Self>,
    ) -> Result<StatusCode, StatusCode> {
        app.device_service
            .cleanup_old_data()
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        Ok(StatusCode::NO_CONTENT)
    }

    /// Get notifications handler
    async fn get_notifications_handler(
        State(app): State<Self>,
        // TODO: Extract user_id from JWT token
    ) -> Result<Json<Vec<crate::auth::DeviceNotification>>, StatusCode> {
        let user_id = Uuid::new_v4(); // TODO: Replace with actual user_id from JWT

        let notifications = app.notification_service
            .get_user_notifications(user_id, Some(50), Some(0))
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        Ok(Json(notifications))
    }

    /// Mark notification as read handler
    async fn mark_notification_read_handler(
        State(app): State<Self>,
        Path(notification_id): Path<Uuid>,
        // TODO: Extract user_id from JWT token
    ) -> Result<StatusCode, StatusCode> {
        let user_id = Uuid::new_v4(); // TODO: Replace with actual user_id from JWT

        app.notification_service
            .mark_notification_read(user_id, notification_id)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        Ok(StatusCode::NO_CONTENT)
    }

    /// Get security policies handler
    async fn get_security_policies_handler(
        State(app): State<Self>,
    ) -> Result<Json<Vec<crate::auth::SecurityPolicyRule>>, StatusCode> {
        let policies = app.security_policy_engine
            .get_policy_rules()
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        Ok(Json(policies))
    }

    /// Update security policies handler
    async fn update_security_policies_handler(
        State(mut app): State<Self>,
        Json(request): Json<UpdateSecurityPoliciesRequest>,
    ) -> Result<StatusCode, StatusCode> {
        // Update each policy rule
        for rule_update in request.rules {
            app.security_policy_engine
                .update_policy_rule(rule_update.rule_id, rule_update.updates)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }

        Ok(StatusCode::NO_CONTENT)
    }

    /// Get security alerts handler
    async fn get_security_alerts_handler(
        State(_app): State<Self>,
        // TODO: Implement security alerts retrieval
    ) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
        // TODO: Implement security alerts retrieval
        Ok(Json(Vec::new()))
    }

    /// Resolve security alert handler
    async fn resolve_security_alert_handler(
        State(_app): State<Self>,
        Path(_alert_id): Path<Uuid>,
    ) -> Result<StatusCode, StatusCode> {
        // TODO: Implement security alert resolution
        Ok(StatusCode::NO_CONTENT)
    }
}

/// Request/Response types for the handlers

#[derive(serde::Deserialize)]
struct ToggleTrustRequest {
    is_trusted: bool,
}

#[derive(serde::Deserialize)]
struct ValidateDeviceRequest {
    fingerprint: String,
}

#[derive(serde::Serialize)]
struct ValidateDeviceResponse {
    is_valid: bool,
}

#[derive(serde::Deserialize)]
struct UpdateSecurityPoliciesRequest {
    rules: Vec<PolicyRuleUpdateRequest>,
}

#[derive(serde::Deserialize)]
struct PolicyRuleUpdateRequest {
    rule_id: Uuid,
    updates: crate::auth::PolicyRuleUpdate,
}

/// Example usage in main.rs
pub async fn example_main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize database pool
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://user:pass@localhost:5432/arenax".to_string());
    let db_pool = sqlx::PgPool::connect(&database_url).await?;

    // Initialize Redis URL
    let redis_url = std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://localhost:6379".to_string());

    // Initialize ArenaX app with device management
    let app = ArenaXApp::new(db_pool, &redis_url).await?;

    // Create router with device management routes
    let app_router = Router::new()
        .nest("/api/v1", app.device_routes())
        .with_state(app);

    // Start server
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    println!("Server running on http://0.0.0.0:8080");
    
    axum::serve(listener, app_router).await?;

    Ok(())
}

/// Example of device management workflow
pub async fn example_device_workflow() -> Result<(), Box<dyn std::error::Error>> {
    // This example shows the complete device management workflow

    // 1. User registers a new device
    let device_request = RegisterDeviceRequest {
        device_name: "My iPhone".to_string(),
        device_type: DeviceType::Mobile,
        os_name: "iOS".to_string(),
        os_version: "17.0".to_string(),
        browser_name: Some("Safari".to_string()),
        browser_version: Some("17.0".to_string()),
        user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)".to_string(),
        screen_resolution: Some("1179x2556".to_string()),
        timezone: Some("America/New_York".to_string()),
        language: Some("en-US".to_string()),
    };

    // 2. Device registration goes through security policy evaluation
    // 3. If approved, device is registered and notifications are sent
    // 4. User can manage their devices through the API
    // 5. Security monitoring continuously evaluates device activity
    // 6. Suspicious activities trigger alerts and notifications
    // 7. Users can revoke devices and manage trust status

    println!("Device management workflow example completed");
    Ok(())
}
