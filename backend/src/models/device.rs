use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

/// Device information structure
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Device {
    pub id: Uuid,
    pub user_id: Uuid,
    pub device_name: String,
    pub device_type: DeviceType,
    pub os_name: String,
    pub os_version: String,
    pub browser_name: Option<String>,
    pub browser_version: Option<String>,
    pub fingerprint: String,
    pub ip_address: String,
    pub user_agent: String,
    pub screen_resolution: Option<String>,
    pub timezone: Option<String>,
    pub language: Option<String>,
    pub is_trusted: bool,
    pub is_active: bool,
    pub last_seen: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub security_score: i32,
    pub risk_level: RiskLevel,
    pub location_country: Option<String>,
    pub location_city: Option<String>,
    pub location_region: Option<String>,
}

/// Device type enumeration
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "device_type", rename_all = "lowercase")]
pub enum DeviceType {
    Desktop,
    Mobile,
    Tablet,
    Unknown,
}

/// Risk level enumeration
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "risk_level", rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

/// Device information for registration
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct DeviceInfo {
    #[validate(length(min = 1, max = 100))]
    pub device_name: String,
    pub device_type: DeviceType,
    #[validate(length(min = 1, max = 50))]
    pub os_name: String,
    #[validate(length(min = 1, max = 50))]
    pub os_version: String,
    pub browser_name: Option<String>,
    pub browser_version: Option<String>,
    #[validate(length(min = 1, max = 1000))]
    pub user_agent: String,
    pub screen_resolution: Option<String>,
    pub timezone: Option<String>,
    pub language: Option<String>,
    #[validate(length(min = 1, max = 45))]
    pub ip_address: String,
}

/// Device registration request
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct RegisterDeviceRequest {
    #[validate(length(min = 1, max = 100))]
    pub device_name: String,
    pub device_type: DeviceType,
    #[validate(length(min = 1, max = 50))]
    pub os_name: String,
    #[validate(length(min = 1, max = 50))]
    pub os_version: String,
    pub browser_name: Option<String>,
    pub browser_version: Option<String>,
    #[validate(length(min = 1, max = 1000))]
    pub user_agent: String,
    pub screen_resolution: Option<String>,
    pub timezone: Option<String>,
    pub language: Option<String>,
}

/// Device response for API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceResponse {
    pub id: Uuid,
    pub device_name: String,
    pub device_type: DeviceType,
    pub os_name: String,
    pub os_version: String,
    pub browser_name: Option<String>,
    pub browser_version: Option<String>,
    pub is_trusted: bool,
    pub is_active: bool,
    pub last_seen: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub security_score: i32,
    pub risk_level: RiskLevel,
    pub location_country: Option<String>,
    pub location_city: Option<String>,
}

impl From<Device> for DeviceResponse {
    fn from(device: Device) -> Self {
        Self {
            id: device.id,
            device_name: device.device_name,
            device_type: device.device_type,
            os_name: device.os_name,
            os_version: device.os_version,
            browser_name: device.browser_name,
            browser_version: device.browser_version,
            is_trusted: device.is_trusted,
            is_active: device.is_active,
            last_seen: device.last_seen,
            created_at: device.created_at,
            security_score: device.security_score,
            risk_level: device.risk_level,
            location_country: device.location_country,
            location_city: device.location_city,
        }
    }
}

/// Device activity log
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DeviceActivity {
    pub id: Uuid,
    pub device_id: Uuid,
    pub user_id: Uuid,
    pub activity_type: ActivityType,
    pub ip_address: String,
    pub user_agent: String,
    pub location_country: Option<String>,
    pub location_city: Option<String>,
    pub location_region: Option<String>,
    pub success: bool,
    pub failure_reason: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

/// Activity type enumeration
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "activity_type", rename_all = "lowercase")]
pub enum ActivityType {
    Login,
    Logout,
    Registration,
    PasswordChange,
    SecurityCheck,
    SuspiciousActivity,
    DeviceRevocation,
    TrustToggle,
}

/// Security alert
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SecurityAlert {
    pub id: Uuid,
    pub device_id: Uuid,
    pub user_id: Uuid,
    pub alert_type: AlertType,
    pub severity: AlertSeverity,
    pub title: String,
    pub description: String,
    pub ip_address: String,
    pub location_country: Option<String>,
    pub location_city: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub is_resolved: bool,
    pub resolved_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// Alert type enumeration
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "alert_type", rename_all = "lowercase")]
pub enum AlertType {
    SuspiciousLocation,
    MultipleDevices,
    UnusualActivity,
    FailedLoginAttempts,
    DeviceCompromise,
    UnauthorizedAccess,
    GeolocationMismatch,
    TimeAnomaly,
}

/// Alert severity enumeration
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "alert_severity", rename_all = "lowercase")]
pub enum AlertSeverity {
    Low,
    Medium,
    High,
    Critical,
}

/// Device analytics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceAnalytics {
    pub total_devices: i64,
    pub active_devices: i64,
    pub trusted_devices: i64,
    pub suspicious_devices: i64,
    pub devices_by_type: std::collections::HashMap<String, i64>,
    pub devices_by_country: std::collections::HashMap<String, i64>,
    pub average_security_score: f64,
    pub risk_distribution: std::collections::HashMap<String, i64>,
    pub recent_activities: Vec<DeviceActivity>,
    pub security_alerts: Vec<SecurityAlert>,
    pub last_updated: DateTime<Utc>,
}

/// Device configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceConfig {
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

impl Default for DeviceConfig {
    fn default() -> Self {
        Self {
            max_devices_per_user: 10,
            device_trust_threshold: 70,
            suspicious_activity_threshold: 3,
            location_change_threshold: 1000.0, // kilometers
            session_timeout_minutes: 30,
            cleanup_inactive_days: 90,
            enable_geolocation: true,
            enable_device_fingerprinting: true,
            enable_security_monitoring: true,
            enable_notifications: true,
        }
    }
}
