use crate::api_error::ApiError;
use crate::db::DbPool;
use chrono::{DateTime, Utc};
use redis::Client as RedisClient;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tracing::{error, info, warn};
use uuid::Uuid;

/// Device information provided during registration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub user_agent: String,
    pub platform: String,
    pub os: String,
    pub browser: Option<String>,
    pub screen_resolution: Option<String>,
    pub timezone: Option<String>,
    pub language: Option<String>,
    pub ip_address: String,
    pub device_type: DeviceType,
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

/// Device model representing a registered device
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Device {
    pub id: Uuid,
    pub user_id: Uuid,
    pub fingerprint: String,
    pub name: Option<String>,
    pub device_type: DeviceType,
    pub platform: String,
    pub os: String,
    pub browser: Option<String>,
    pub ip_address: String,
    pub last_seen: DateTime<Utc>,
    pub first_seen: DateTime<Utc>,
    pub is_active: bool,
    pub is_trusted: bool,
    pub is_blocked: bool,
    pub login_count: i64,
    pub failed_login_count: i64,
    pub last_login: Option<DateTime<Utc>>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Security alert for suspicious device activity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityAlert {
    pub device_id: Uuid,
    pub user_id: Uuid,
    pub alert_type: AlertType,
    pub severity: AlertSeverity,
    pub message: String,
    pub details: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

/// Types of security alerts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AlertType {
    SuspiciousLocation,
    MultipleFailedLogins,
    UnusualActivity,
    DeviceMismatch,
    RapidDeviceChanges,
    UnauthorizedAccess,
}

/// Alert severity levels
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AlertSeverity {
    Low,
    Medium,
    High,
    Critical,
}

/// Device analytics data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceAnalytics {
    pub total_devices: i64,
    pub active_devices: i64,
    pub blocked_devices: i64,
    pub suspicious_devices: i64,
    pub devices_by_type: HashMap<String, i64>,
    pub devices_by_platform: HashMap<String, i64>,
    pub recent_logins: i64,
    pub failed_logins: i64,
}

/// Device configuration
#[derive(Debug, Clone)]
pub struct DeviceConfig {
    pub max_devices_per_user: u32,
    pub device_fingerprint_salt: String,
    pub suspicious_login_threshold: u32,
    pub device_inactivity_days: u32,
    pub enable_notifications: bool,
    pub enable_analytics: bool,
}

impl Default for DeviceConfig {
    fn default() -> Self {
        Self {
            max_devices_per_user: 10,
            device_fingerprint_salt: "arenax-device-salt".to_string(),
            suspicious_login_threshold: 5,
            device_inactivity_days: 90,
            enable_notifications: true,
            enable_analytics: true,
        }
    }
}

/// Security monitor for tracking device security events
#[derive(Debug, Clone)]
pub struct SecurityMonitor {
    redis_client: Arc<RedisClient>,
}

impl SecurityMonitor {
    pub fn new(redis_client: Arc<RedisClient>) -> Self {
        Self { redis_client }
    }

    pub async fn record_login_attempt(
        &self,
        device_id: Uuid,
        success: bool,
    ) -> Result<(), DeviceError> {
        let mut conn = self
            .redis_client
            .get_async_connection()
            .await
            .map_err(|e| DeviceError::RedisError(e.to_string()))?;

        let key = format!("device:login:{}", device_id);
        let value = if success { "1" } else { "0" };

        redis::cmd("LPUSH")
            .arg(&key)
            .arg(value)
            .query_async(&mut conn)
            .await
            .map_err(|e| DeviceError::RedisError(e.to_string()))?;

        // Keep only last 100 attempts
        redis::cmd("LTRIM")
            .arg(&key)
            .arg(0)
            .arg(99)
            .query_async(&mut conn)
            .await
            .map_err(|e| DeviceError::RedisError(e.to_string()))?;

        // Set expiration (30 days)
        redis::cmd("EXPIRE")
            .arg(&key)
            .arg(2592000)
            .query_async(&mut conn)
            .await
            .map_err(|e| DeviceError::RedisError(e.to_string()))?;

        Ok(())
    }

    pub async fn get_failed_login_count(
        &self,
        device_id: Uuid,
        window_minutes: u64,
    ) -> Result<u32, DeviceError> {
        let mut conn = self
            .redis_client
            .get_async_connection()
            .await
            .map_err(|e| DeviceError::RedisError(e.to_string()))?;

        let key = format!("device:login:{}", device_id);
        let now = chrono::Utc::now().timestamp() as u64;
        let cutoff = now - (window_minutes * 60);

        let attempts: Vec<String> = redis::cmd("LRANGE")
            .arg(&key)
            .arg(0)
            .arg(99)
            .query_async(&mut conn)
            .await
            .map_err(|e| DeviceError::RedisError(e.to_string()))?;

        let failed_count = attempts.iter().filter(|&a| a == "0").count() as u32;
        Ok(failed_count)
    }
}

/// Device service errors
#[derive(Debug, Error)]
pub enum DeviceError {
    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),

    #[error("Redis error: {0}")]
    RedisError(String),

    #[error("Device not found")]
    DeviceNotFound,

    #[error("Device limit exceeded: max {0} devices allowed")]
    DeviceLimitExceeded(u32),

    #[error("Device is blocked")]
    DeviceBlocked,

    #[error("Device validation failed")]
    DeviceValidationFailed,

    #[error("Invalid device information")]
    InvalidDeviceInfo(String),

    #[error("Security alert: {0}")]
    SecurityAlert(String),
}

impl From<DeviceError> for ApiError {
    fn from(err: DeviceError) -> Self {
        match err {
            DeviceError::DatabaseError(e) => ApiError::DatabaseError(e),
            DeviceError::RedisError(e) => ApiError::RedisError(e),
            DeviceError::DeviceNotFound => ApiError::NotFound,
            DeviceError::DeviceLimitExceeded(_) => ApiError::BadRequest(err.to_string()),
            DeviceError::DeviceBlocked => ApiError::Forbidden,
            DeviceError::DeviceValidationFailed => ApiError::Unauthorized,
            DeviceError::InvalidDeviceInfo(_) => ApiError::BadRequest(err.to_string()),
            DeviceError::SecurityAlert(_) => ApiError::BadRequest(err.to_string()),
        }
    }
}

/// Device Service - Main service for device management
pub struct DeviceService {
    db_pool: DbPool,
    redis_client: Arc<RedisClient>,
    security_monitor: SecurityMonitor,
    config: DeviceConfig,
}

impl DeviceService {
    /// Create a new device service instance
    pub fn new(
        db_pool: DbPool,
        redis_client: Arc<RedisClient>,
        config: Option<DeviceConfig>,
    ) -> Self {
        let config = config.unwrap_or_else(|| DeviceConfig::default());
        let security_monitor = SecurityMonitor::new(redis_client.clone());

        Self {
            db_pool,
            redis_client,
            security_monitor,
            config,
        }
    }

    /// Generate a device fingerprint from device information
    pub fn generate_fingerprint(&self, device_info: &DeviceInfo) -> String {
        let mut hasher = Sha256::new();

        // Combine device characteristics
        let fingerprint_data = format!(
            "{}{}{}{}{}{}{}{}{}",
            self.config.device_fingerprint_salt,
            device_info.user_agent,
            device_info.platform,
            device_info.os,
            device_info.browser.as_ref().unwrap_or(&"unknown".to_string()),
            device_info.screen_resolution.as_ref().unwrap_or(&"unknown".to_string()),
            device_info.timezone.as_ref().unwrap_or(&"unknown".to_string()),
            device_info.language.as_ref().unwrap_or(&"unknown".to_string()),
            device_info.ip_address,
        );

        hasher.update(fingerprint_data.as_bytes());
        let result = hasher.finalize();
        format!("{:x}", result)
    }

    /// Register a new device for a user
    pub async fn register_device(
        &self,
        user_id: Uuid,
        device_info: DeviceInfo,
        device_name: Option<String>,
    ) -> Result<Device, DeviceError> {
        // Check device limit
        let device_count = self.get_user_device_count(user_id).await?;
        if device_count >= self.config.max_devices_per_user as i64 {
            return Err(DeviceError::DeviceLimitExceeded(
                self.config.max_devices_per_user,
            ));
        }

        // Generate fingerprint
        let fingerprint = self.generate_fingerprint(&device_info);

        // Check if device already exists
        let existing_device = sqlx::query_as::<_, Device>(
            "SELECT * FROM devices WHERE user_id = $1 AND fingerprint = $2",
        )
        .bind(user_id)
        .bind(&fingerprint)
        .fetch_optional(&self.db_pool)
        .await?;

        if let Some(mut device) = existing_device {
            // Update existing device
            device.last_seen = Utc::now();
            device.is_active = true;
            device.login_count += 1;
            device.last_login = Some(Utc::now());
            device.ip_address = device_info.ip_address.clone();
            device.updated_at = Utc::now();

            sqlx::query(
                "UPDATE devices SET last_seen = $1, is_active = $2, login_count = $3,
                 last_login = $4, ip_address = $5, updated_at = $6 WHERE id = $7",
            )
            .bind(device.last_seen)
            .bind(device.is_active)
            .bind(device.login_count)
            .bind(device.last_login)
            .bind(&device.ip_address)
            .bind(device.updated_at)
            .bind(device.id)
            .execute(&self.db_pool)
            .await?;

            // Record login attempt
            self.security_monitor
                .record_login_attempt(device.id, true)
                .await?;

            return Ok(device);
        }

        // Create new device
        let device_id = Uuid::new_v4();
        let now = Utc::now();
        let device_name = device_name.unwrap_or_else(|| {
            format!(
                "{} {}",
                device_info.platform,
                device_info.device_type.to_string()
            )
        });

        let metadata = serde_json::json!({
            "screen_resolution": device_info.screen_resolution,
            "timezone": device_info.timezone,
            "language": device_info.language,
        });

        sqlx::query(
            "INSERT INTO devices (
                id, user_id, fingerprint, name, device_type, platform, os, browser,
                ip_address, last_seen, first_seen, is_active, is_trusted, is_blocked,
                login_count, failed_login_count, metadata, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)",
        )
        .bind(device_id)
        .bind(user_id)
        .bind(&fingerprint)
        .bind(&device_name)
        .bind(&device_info.device_type)
        .bind(&device_info.platform)
        .bind(&device_info.os)
        .bind(&device_info.browser)
        .bind(&device_info.ip_address)
        .bind(now)
        .bind(now)
        .bind(true)
        .bind(false)
        .bind(false)
        .bind(1)
        .bind(0)
        .bind(&metadata)
        .bind(now)
        .bind(now)
        .execute(&self.db_pool)
        .await?;

        // Record login attempt
        self.security_monitor
            .record_login_attempt(device_id, true)
            .await?;

        // Get the created device
        let device = sqlx::query_as::<_, Device>(
            "SELECT * FROM devices WHERE id = $1",
        )
        .bind(device_id)
        .fetch_one(&self.db_pool)
        .await?;

        info!(
            device_id = %device_id,
            user_id = %user_id,
            "Device registered successfully"
        );

        Ok(device)
    }

    /// Get all devices for a user
    pub async fn get_user_devices(&self, user_id: Uuid) -> Result<Vec<Device>, DeviceError> {
        let devices = sqlx::query_as::<_, Device>(
            "SELECT * FROM devices WHERE user_id = $1 ORDER BY last_seen DESC",
        )
        .bind(user_id)
        .fetch_all(&self.db_pool)
        .await?;

        Ok(devices)
    }

    /// Get a specific device by ID
    pub async fn get_device(&self, device_id: Uuid) -> Result<Device, DeviceError> {
        let device = sqlx::query_as::<_, Device>(
            "SELECT * FROM devices WHERE id = $1",
        )
        .bind(device_id)
        .fetch_optional(&self.db_pool)
        .await?
        .ok_or(DeviceError::DeviceNotFound)?;

        Ok(device)
    }

    /// Get device count for a user
    async fn get_user_device_count(&self, user_id: Uuid) -> Result<i64, DeviceError> {
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM devices WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&self.db_pool)
        .await?;

        Ok(count.0)
    }

    /// Revoke/remove a device
    pub async fn revoke_device(
        &self,
        user_id: Uuid,
        device_id: Uuid,
    ) -> Result<(), DeviceError> {
        // Verify device belongs to user
        let device = self.get_device(device_id).await?;
        if device.user_id != user_id {
            return Err(DeviceError::DeviceNotFound);
        }

        sqlx::query("DELETE FROM devices WHERE id = $1 AND user_id = $2")
            .bind(device_id)
            .bind(user_id)
            .execute(&self.db_pool)
            .await?;

        // Clean up Redis cache
        let mut conn = self
            .redis_client
            .get_async_connection()
            .await
            .map_err(|e| DeviceError::RedisError(e.to_string()))?;

        let key = format!("device:login:{}", device_id);
        redis::cmd("DEL")
            .arg(&key)
            .query_async(&mut conn)
            .await
            .map_err(|e| DeviceError::RedisError(e.to_string()))?;

        info!(
            device_id = %device_id,
            user_id = %user_id,
            "Device revoked successfully"
        );

        Ok(())
    }

    /// Validate a device fingerprint
    pub async fn validate_device(
        &self,
        device_id: Uuid,
        fingerprint: &str,
    ) -> Result<bool, DeviceError> {
        let device = self.get_device(device_id).await?;

        if device.is_blocked {
            return Err(DeviceError::DeviceBlocked);
        }

        if device.fingerprint != fingerprint {
            // Record failed validation
            self.security_monitor
                .record_login_attempt(device_id, false)
                .await?;

            // Update failed login count
            sqlx::query(
                "UPDATE devices SET failed_login_count = failed_login_count + 1 WHERE id = $1",
            )
            .bind(device_id)
            .execute(&self.db_pool)
            .await?;

            return Ok(false);
        }

        // Update last seen
        sqlx::query("UPDATE devices SET last_seen = $1, is_active = true WHERE id = $2")
            .bind(Utc::now())
            .bind(device_id)
            .execute(&self.db_pool)
            .await?;

        Ok(true)
    }

    /// Detect suspicious activity for a device
    pub async fn detect_suspicious_activity(
        &self,
        device_id: Uuid,
    ) -> Result<Option<SecurityAlert>, DeviceError> {
        let device = self.get_device(device_id).await?;

        // Check for multiple failed logins
        let failed_count = self
            .security_monitor
            .get_failed_login_count(device_id, 60)
            .await?;

        if failed_count >= self.config.suspicious_login_threshold {
            let alert = SecurityAlert {
                device_id,
                user_id: device.user_id,
                alert_type: AlertType::MultipleFailedLogins,
                severity: AlertSeverity::High,
                message: format!(
                    "Multiple failed login attempts detected: {} attempts in the last hour",
                    failed_count
                ),
                details: Some(serde_json::json!({
                    "failed_count": failed_count,
                    "threshold": self.config.suspicious_login_threshold,
                })),
                created_at: Utc::now(),
            };

            // Store alert in database
            self.store_security_alert(&alert).await?;

            warn!(
                device_id = %device_id,
                user_id = %device.user_id,
                failed_count = failed_count,
                "Suspicious activity detected"
            );

            return Ok(Some(alert));
        }

        // Check for unusual activity patterns
        if device.failed_login_count > 10 {
            let alert = SecurityAlert {
                device_id,
                user_id: device.user_id,
                alert_type: AlertType::UnusualActivity,
                severity: AlertSeverity::Medium,
                message: "Unusual activity pattern detected on device".to_string(),
                details: Some(serde_json::json!({
                    "failed_login_count": device.failed_login_count,
                })),
                created_at: Utc::now(),
            };

            self.store_security_alert(&alert).await?;
            return Ok(Some(alert));
        }

        Ok(None)
    }

    /// Store a security alert
    async fn store_security_alert(&self, alert: &SecurityAlert) -> Result<(), DeviceError> {
        sqlx::query(
            "INSERT INTO device_security_alerts (
                id, device_id, user_id, alert_type, severity, message, details, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(Uuid::new_v4())
        .bind(alert.device_id)
        .bind(alert.user_id)
        .bind(serde_json::to_string(&alert.alert_type).unwrap())
        .bind(serde_json::to_string(&alert.severity).unwrap())
        .bind(&alert.message)
        .bind(&alert.details)
        .bind(alert.created_at)
        .execute(&self.db_pool)
        .await?;

        Ok(())
    }

    /// Block a device
    pub async fn block_device(
        &self,
        user_id: Uuid,
        device_id: Uuid,
    ) -> Result<(), DeviceError> {
        let device = self.get_device(device_id).await?;
        if device.user_id != user_id {
            return Err(DeviceError::DeviceNotFound);
        }

        sqlx::query("UPDATE devices SET is_blocked = true, updated_at = $1 WHERE id = $2")
            .bind(Utc::now())
            .bind(device_id)
            .execute(&self.db_pool)
            .await?;

        info!(
            device_id = %device_id,
            user_id = %user_id,
            "Device blocked"
        );

        Ok(())
    }

    /// Unblock a device
    pub async fn unblock_device(
        &self,
        user_id: Uuid,
        device_id: Uuid,
    ) -> Result<(), DeviceError> {
        let device = self.get_device(device_id).await?;
        if device.user_id != user_id {
            return Err(DeviceError::DeviceNotFound);
        }

        sqlx::query("UPDATE devices SET is_blocked = false, updated_at = $1 WHERE id = $2")
            .bind(Utc::now())
            .bind(device_id)
            .execute(&self.db_pool)
            .await?;

        info!(
            device_id = %device_id,
            user_id = %user_id,
            "Device unblocked"
        );

        Ok(())
    }

    /// Trust a device
    pub async fn trust_device(
        &self,
        user_id: Uuid,
        device_id: Uuid,
    ) -> Result<(), DeviceError> {
        let device = self.get_device(device_id).await?;
        if device.user_id != user_id {
            return Err(DeviceError::DeviceNotFound);
        }

        sqlx::query("UPDATE devices SET is_trusted = true, updated_at = $1 WHERE id = $2")
            .bind(Utc::now())
            .bind(device_id)
            .execute(&self.db_pool)
            .await?;

        Ok(())
    }

    /// Update device last seen timestamp
    pub async fn update_last_seen(&self, device_id: Uuid) -> Result<(), DeviceError> {
        sqlx::query("UPDATE devices SET last_seen = $1, is_active = true WHERE id = $2")
            .bind(Utc::now())
            .bind(device_id)
            .execute(&self.db_pool)
            .await?;

        Ok(())
    }

    /// Get device analytics
    pub async fn get_device_analytics(
        &self,
        user_id: Option<Uuid>,
    ) -> Result<DeviceAnalytics, DeviceError> {
        let query = if let Some(uid) = user_id {
            "SELECT * FROM devices WHERE user_id = $1"
        } else {
            "SELECT * FROM devices"
        };

        let devices: Vec<Device> = if let Some(uid) = user_id {
            sqlx::query_as(query).bind(uid).fetch_all(&self.db_pool).await?
        } else {
            sqlx::query_as(query).fetch_all(&self.db_pool).await?
        };

        let total_devices = devices.len() as i64;
        let active_devices = devices.iter().filter(|d| d.is_active).count() as i64;
        let blocked_devices = devices.iter().filter(|d| d.is_blocked).count() as i64;
        let suspicious_devices = devices
            .iter()
            .filter(|d| d.failed_login_count > 5)
            .count() as i64;

        let mut devices_by_type = HashMap::new();
        let mut devices_by_platform = HashMap::new();
        let mut recent_logins = 0;
        let mut failed_logins = 0;

        for device in &devices {
            let device_type_str = format!("{:?}", device.device_type);
            *devices_by_type.entry(device_type_str).or_insert(0) += 1;
            *devices_by_platform.entry(device.platform.clone()).or_insert(0) += 1;

            if device.last_login.is_some() {
                recent_logins += 1;
            }
            failed_logins += device.failed_login_count;
        }

        Ok(DeviceAnalytics {
            total_devices,
            active_devices,
            blocked_devices,
            suspicious_devices,
            devices_by_type,
            devices_by_platform,
            recent_logins,
            failed_logins: failed_logins as i64,
        })
    }

    /// Clean up inactive devices
    pub async fn cleanup_inactive_devices(&self) -> Result<u64, DeviceError> {
        let cutoff_date = Utc::now()
            - chrono::Duration::days(self.config.device_inactivity_days as i64);

        let result = sqlx::query(
            "DELETE FROM devices WHERE last_seen < $1 AND is_active = false",
        )
        .bind(cutoff_date)
        .execute(&self.db_pool)
        .await?;

        let deleted_count = result.rows_affected();

        info!(
            deleted_count = deleted_count,
            "Cleaned up inactive devices"
        );

        Ok(deleted_count)
    }

    /// Get security alerts for a device
    pub async fn get_device_security_alerts(
        &self,
        device_id: Uuid,
        limit: Option<i64>,
    ) -> Result<Vec<SecurityAlert>, DeviceError> {
        let limit = limit.unwrap_or(50);

        // Note: This assumes a device_security_alerts table exists
        // For now, we'll return alerts from memory or create a simplified version
        let alerts: Vec<(Uuid, Uuid, String, String, String, Option<serde_json::Value>, DateTime<Utc>)> =
            sqlx::query_as(
                "SELECT device_id, user_id, alert_type, severity, message, details, created_at
                 FROM device_security_alerts
                 WHERE device_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2",
            )
            .bind(device_id)
            .bind(limit)
            .fetch_all(&self.db_pool)
            .await?;

        let security_alerts = alerts
            .into_iter()
            .map(|(device_id, user_id, alert_type_str, severity_str, message, details, created_at)| {
                let alert_type: AlertType = serde_json::from_str(&alert_type_str)
                    .unwrap_or(AlertType::UnusualActivity);
                let severity: AlertSeverity = serde_json::from_str(&severity_str)
                    .unwrap_or(AlertSeverity::Medium);

                SecurityAlert {
                    device_id,
                    user_id,
                    alert_type,
                    severity,
                    message,
                    details,
                    created_at,
                }
            })
            .collect();

        Ok(security_alerts)
    }

    /// Check if device access should be allowed
    pub async fn check_device_access(
        &self,
        device_id: Uuid,
        fingerprint: &str,
    ) -> Result<bool, DeviceError> {
        let device = self.get_device(device_id).await?;

        // Check if device is blocked
        if device.is_blocked {
            return Err(DeviceError::DeviceBlocked);
        }

        // Validate fingerprint
        if device.fingerprint != fingerprint {
            // Record failed attempt
            self.security_monitor
                .record_login_attempt(device_id, false)
                .await?;

            // Check for suspicious activity
            if let Some(alert) = self.detect_suspicious_activity(device_id).await? {
                return Err(DeviceError::SecurityAlert(alert.message));
            }

            return Ok(false);
        }

        // Update last seen
        self.update_last_seen(device_id).await?;

        // Record successful attempt
        self.security_monitor
            .record_login_attempt(device_id, true)
            .await?;

        Ok(true)
    }
}

impl ToString for DeviceType {
    fn to_string(&self) -> String {
        match self {
            DeviceType::Desktop => "Desktop".to_string(),
            DeviceType::Mobile => "Mobile".to_string(),
            DeviceType::Tablet => "Tablet".to_string(),
            DeviceType::Unknown => "Unknown".to_string(),
        }
    }
}
