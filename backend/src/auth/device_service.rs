use anyhow::Result;
use chrono::{DateTime, Utc};
use redis::{AsyncCommands, Client as RedisClient};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use thiserror::Error;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::models::{
    ActivityType, AlertSeverity, AlertType, Device, DeviceActivity, DeviceAnalytics,
    DeviceConfig, DeviceInfo, DeviceResponse, DeviceType, RegisterDeviceRequest,
    RiskLevel, SecurityAlert,
};

/// Device service errors
#[derive(Error, Debug)]
pub enum DeviceError {
    #[error("Device not found")]
    DeviceNotFound,

    #[error("Device already exists")]
    DeviceAlreadyExists,

    #[error("Maximum devices exceeded")]
    MaxDevicesExceeded,

    #[error("Invalid device fingerprint")]
    InvalidFingerprint,

    #[error("Device is not trusted")]
    DeviceNotTrusted,

    #[error("Device is inactive")]
    DeviceInactive,

    #[error("Security alert triggered")]
    SecurityAlert(String),

    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),

    #[error("Redis error: {0}")]
    RedisError(#[from] redis::RedisError),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
}

/// Security monitor for device monitoring
#[derive(Debug, Clone)]
pub struct SecurityMonitor {
    redis_client: RedisClient,
    config: DeviceConfig,
}

impl SecurityMonitor {
    pub fn new(redis_client: RedisClient, config: DeviceConfig) -> Self {
        Self {
            redis_client,
            config,
        }
    }

    /// Check for suspicious activity patterns
    pub async fn check_suspicious_activity(
        &self,
        device_id: Uuid,
        user_id: Uuid,
        ip_address: &str,
        location: Option<&str>,
    ) -> Result<Option<SecurityAlert>, DeviceError> {
        let mut conn = self.redis_client.get_async_connection().await?;

        // Check for rapid location changes
        if let Some(location) = location {
            let location_key = format!("device:{}:locations", device_id);
            let recent_locations: Vec<String> = conn.lrange(&location_key, 0, 4).await?;

            if recent_locations.len() >= 3 {
                let unique_locations: std::collections::HashSet<_> =
                    recent_locations.iter().collect();
                if unique_locations.len() >= 3 {
                    return Ok(Some(SecurityAlert {
                        id: Uuid::new_v4(),
                        device_id,
                        user_id,
                        alert_type: AlertType::SuspiciousLocation,
                        severity: AlertSeverity::High,
                        title: "Rapid Location Changes Detected".to_string(),
                        description: format!(
                            "Device has been used from {} different locations recently",
                            unique_locations.len()
                        ),
                        ip_address: ip_address.to_string(),
                        location_country: None,
                        location_city: None,
                        metadata: Some(serde_json::json!({
                            "recent_locations": recent_locations,
                            "unique_count": unique_locations.len()
                        })),
                        is_resolved: false,
                        resolved_at: None,
                        created_at: Utc::now(),
                    }));
                }
            }

            // Store current location
            conn.lpush(&location_key, location).await?;
            conn.expire(&location_key, 86400).await?; // 24 hours
        }

        // Check for multiple failed login attempts
        let failure_key = format!("device:{}:failures", device_id);
        let failure_count: i32 = conn.get(&failure_key).await.unwrap_or(0);

        if failure_count >= self.config.suspicious_activity_threshold {
            return Ok(Some(SecurityAlert {
                id: Uuid::new_v4(),
                device_id,
                user_id,
                alert_type: AlertType::FailedLoginAttempts,
                severity: AlertSeverity::High,
                title: "Multiple Failed Login Attempts".to_string(),
                description: format!(
                    "Device has {} failed login attempts recently",
                    failure_count
                ),
                ip_address: ip_address.to_string(),
                location_country: None,
                location_city: None,
                metadata: Some(serde_json::json!({
                    "failure_count": failure_count
                })),
                is_resolved: false,
                resolved_at: None,
                created_at: Utc::now(),
            }));
        }

        Ok(None)
    }

    /// Record failed login attempt
    pub async fn record_failure(&self, device_id: Uuid) -> Result<(), DeviceError> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let failure_key = format!("device:{}:failures", device_id);
        
        conn.incr(&failure_key, 1).await?;
        conn.expire(&failure_key, 3600).await?; // 1 hour
        
        Ok(())
    }

    /// Clear failure count
    pub async fn clear_failures(&self, device_id: Uuid) -> Result<(), DeviceError> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let failure_key = format!("device:{}:failures", device_id);
        
        conn.del(&failure_key).await?;
        
        Ok(())
    }
}

/// Main device service
#[derive(Debug, Clone)]
pub struct DeviceService {
    db_pool: PgPool,
    redis_client: RedisClient,
    security_monitor: SecurityMonitor,
    config: DeviceConfig,
}

impl DeviceService {
    /// Create a new device service instance
    pub fn new(
        db_pool: PgPool,
        redis_url: &str,
        config: Option<DeviceConfig>,
    ) -> Result<Self, DeviceError> {
        let redis_client = RedisClient::open(redis_url)?;
        let config = config.unwrap_or_default();
        let security_monitor = SecurityMonitor::new(redis_client.clone(), config.clone());

        Ok(Self {
            db_pool,
            redis_client,
            security_monitor,
            config,
        })
    }

    /// Register a new device for a user
    pub async fn register_device(
        &self,
        user_id: Uuid,
        device_info: DeviceInfo,
    ) -> Result<Device, DeviceError> {
        // Check if user has reached maximum device limit
        let device_count = self.get_user_device_count(user_id).await?;
        if device_count >= self.config.max_devices_per_user {
            return Err(DeviceError::MaxDevicesExceeded);
        }

        // Generate device fingerprint
        let fingerprint = self.generate_device_fingerprint(&device_info)?;

        // Check if device already exists
        if let Ok(existing_device) = self.get_device_by_fingerprint(&fingerprint).await {
            if existing_device.user_id == user_id {
                // Update existing device
                return self.update_device_info(existing_device.id, device_info).await;
            } else {
                return Err(DeviceError::DeviceAlreadyExists);
            }
        }

        // Calculate initial security score
        let security_score = self.calculate_security_score(&device_info);
        let risk_level = self.determine_risk_level(security_score);

        // Insert new device
        let device = sqlx::query_as!(
            Device,
            r#"
            INSERT INTO devices (
                user_id, device_name, device_type, os_name, os_version,
                browser_name, browser_version, fingerprint, ip_address,
                user_agent, screen_resolution, timezone, language,
                security_score, risk_level, location_country, location_city, location_region
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING *
            "#,
            user_id,
            device_info.device_name,
            device_info.device_type as _,
            device_info.os_name,
            device_info.os_version,
            device_info.browser_name,
            device_info.browser_version,
            fingerprint,
            device_info.ip_address,
            device_info.user_agent,
            device_info.screen_resolution,
            device_info.timezone,
            device_info.language,
            security_score,
            risk_level as _,
            None::<String>, // location_country
            None::<String>, // location_city
            None::<String>  // location_region
        )
        .fetch_one(&self.db_pool)
        .await?;

        // Log device registration activity
        self.log_device_activity(
            device.id,
            user_id,
            ActivityType::Registration,
            &device_info.ip_address,
            &device_info.user_agent,
            true,
            None,
            None,
        )
        .await?;

        info!("Registered new device {} for user {}", device.id, user_id);
        Ok(device)
    }

    /// Get all devices for a user
    pub async fn get_user_devices(&self, user_id: Uuid) -> Result<Vec<DeviceResponse>, DeviceError> {
        let devices = sqlx::query_as!(
            Device,
            "SELECT * FROM devices WHERE user_id = $1 ORDER BY created_at DESC",
            user_id
        )
        .fetch_all(&self.db_pool)
        .await?;

        Ok(devices.into_iter().map(DeviceResponse::from).collect())
    }

    /// Get device by ID
    pub async fn get_device_by_id(&self, device_id: Uuid) -> Result<Device, DeviceError> {
        sqlx::query_as!(
            Device,
            "SELECT * FROM devices WHERE id = $1",
            device_id
        )
        .fetch_optional(&self.db_pool)
        .await?
        .ok_or(DeviceError::DeviceNotFound)
    }

    /// Get device by fingerprint
    pub async fn get_device_by_fingerprint(&self, fingerprint: &str) -> Result<Device, DeviceError> {
        sqlx::query_as!(
            Device,
            "SELECT * FROM devices WHERE fingerprint = $1",
            fingerprint
        )
        .fetch_optional(&self.db_pool)
        .await?
        .ok_or(DeviceError::DeviceNotFound)
    }

    /// Revoke a device
    pub async fn revoke_device(&self, user_id: Uuid, device_id: Uuid) -> Result<(), DeviceError> {
        // Verify device belongs to user
        let device = self.get_device_by_id(device_id).await?;
        if device.user_id != user_id {
            return Err(DeviceError::DeviceNotFound);
        }

        // Deactivate device
        sqlx::query!(
            "UPDATE devices SET is_active = false, updated_at = NOW() WHERE id = $1",
            device_id
        )
        .execute(&self.db_pool)
        .await?;

        // Log device revocation activity
        self.log_device_activity(
            device_id,
            user_id,
            ActivityType::DeviceRevocation,
            &device.ip_address,
            &device.user_agent,
            true,
            None,
            None,
        )
        .await?;

        info!("Revoked device {} for user {}", device_id, user_id);
        Ok(())
    }

    /// Validate device fingerprint
    pub async fn validate_device(&self, device_id: Uuid, fingerprint: &str) -> Result<bool, DeviceError> {
        let device = self.get_device_by_id(device_id).await?;
        
        if !device.is_active {
            return Ok(false);
        }

        if device.fingerprint != fingerprint {
            return Ok(false);
        }

        // Update last seen
        sqlx::query!(
            "UPDATE devices SET last_seen = NOW() WHERE id = $1",
            device_id
        )
        .execute(&self.db_pool)
        .await?;

        Ok(true)
    }

    /// Detect suspicious activity for a device
    pub async fn detect_suspicious_activity(
        &self,
        device_id: Uuid,
    ) -> Result<Option<SecurityAlert>, DeviceError> {
        let device = self.get_device_by_id(device_id).await?;
        
        // Check for suspicious patterns
        let alert = self.security_monitor.check_suspicious_activity(
            device_id,
            device.user_id,
            &device.ip_address,
            device.location_city.as_deref(),
        ).await?;

        if let Some(alert) = alert {
            // Store alert in database
            self.store_security_alert(alert.clone()).await?;
            Ok(Some(alert))
        } else {
            Ok(None)
        }
    }

    /// Update device trust status
    pub async fn update_device_trust(&self, device_id: Uuid, is_trusted: bool) -> Result<(), DeviceError> {
        sqlx::query!(
            "UPDATE devices SET is_trusted = $1, updated_at = NOW() WHERE id = $2",
            is_trusted,
            device_id
        )
        .execute(&self.db_pool)
        .await?;

        // Log trust toggle activity
        let device = self.get_device_by_id(device_id).await?;
        self.log_device_activity(
            device_id,
            device.user_id,
            ActivityType::TrustToggle,
            &device.ip_address,
            &device.user_agent,
            true,
            None,
            Some(serde_json::json!({ "is_trusted": is_trusted })),
        )
        .await?;

        info!("Updated trust status for device {} to {}", device_id, is_trusted);
        Ok(())
    }

    /// Get device analytics
    pub async fn get_device_analytics(&self, user_id: Option<Uuid>) -> Result<DeviceAnalytics, DeviceError> {
        let mut analytics = DeviceAnalytics {
            total_devices: 0,
            active_devices: 0,
            trusted_devices: 0,
            suspicious_devices: 0,
            devices_by_type: HashMap::new(),
            devices_by_country: HashMap::new(),
            average_security_score: 0.0,
            risk_distribution: HashMap::new(),
            recent_activities: Vec::new(),
            security_alerts: Vec::new(),
            last_updated: Utc::now(),
        };

        // Get device counts
        let query = if let Some(user_id) = user_id {
            "SELECT COUNT(*) as count FROM devices WHERE user_id = $1"
        } else {
            "SELECT COUNT(*) as count FROM devices"
        };

        let total_devices = if let Some(user_id) = user_id {
            sqlx::query_scalar!(query, user_id)
        } else {
            sqlx::query_scalar!(query)
        }
        .fetch_one(&self.db_pool)
        .await?;

        analytics.total_devices = total_devices.unwrap_or(0);

        // Get active devices count
        let active_query = if let Some(user_id) = user_id {
            "SELECT COUNT(*) as count FROM devices WHERE user_id = $1 AND is_active = true"
        } else {
            "SELECT COUNT(*) as count FROM devices WHERE is_active = true"
        };

        let active_devices = if let Some(user_id) = user_id {
            sqlx::query_scalar!(active_query, user_id)
        } else {
            sqlx::query_scalar!(active_query)
        }
        .fetch_one(&self.db_pool)
        .await?;

        analytics.active_devices = active_devices.unwrap_or(0);

        // Get trusted devices count
        let trusted_query = if let Some(user_id) = user_id {
            "SELECT COUNT(*) as count FROM devices WHERE user_id = $1 AND is_trusted = true"
        } else {
            "SELECT COUNT(*) as count FROM devices WHERE is_trusted = true"
        };

        let trusted_devices = if let Some(user_id) = user_id {
            sqlx::query_scalar!(trusted_query, user_id)
        } else {
            sqlx::query_scalar!(trusted_query)
        }
        .fetch_one(&self.db_pool)
        .await?;

        analytics.trusted_devices = trusted_devices.unwrap_or(0);

        // Get average security score
        let score_query = if let Some(user_id) = user_id {
            "SELECT AVG(security_score) as avg_score FROM devices WHERE user_id = $1"
        } else {
            "SELECT AVG(security_score) as avg_score FROM devices"
        };

        let avg_score = if let Some(user_id) = user_id {
            sqlx::query_scalar!(score_query, user_id)
        } else {
            sqlx::query_scalar!(score_query)
        }
        .fetch_one(&self.db_pool)
        .await?;

        analytics.average_security_score = avg_score.unwrap_or(0.0);

        Ok(analytics)
    }

    /// Clean up old device data
    pub async fn cleanup_old_data(&self) -> Result<(), DeviceError> {
        // Clean up old device activities
        sqlx::query!(
            "DELETE FROM device_activities WHERE created_at < NOW() - INTERVAL '90 days'"
        )
        .execute(&self.db_pool)
        .await?;

        // Clean up resolved security alerts
        sqlx::query!(
            "DELETE FROM security_alerts WHERE created_at < NOW() - INTERVAL '180 days' AND is_resolved = true"
        )
        .execute(&self.db_pool)
        .await?;

        // Clean up inactive devices older than configured days
        sqlx::query!(
            "DELETE FROM devices WHERE is_active = false AND updated_at < NOW() - INTERVAL '{} days'",
            self.config.cleanup_inactive_days
        )
        .execute(&self.db_pool)
        .await?;

        info!("Cleaned up old device data");
        Ok(())
    }

    // Private helper methods

    /// Generate device fingerprint
    fn generate_device_fingerprint(&self, device_info: &DeviceInfo) -> Result<String, DeviceError> {
        let fingerprint_data = format!(
            "{}{}{}{}{}{}{}{}{}",
            device_info.device_name,
            device_info.device_type as i32,
            device_info.os_name,
            device_info.os_version,
            device_info.browser_name.as_deref().unwrap_or(""),
            device_info.browser_version.as_deref().unwrap_or(""),
            device_info.user_agent,
            device_info.screen_resolution.as_deref().unwrap_or(""),
            device_info.timezone.as_deref().unwrap_or("")
        );

        let mut hasher = Sha256::new();
        hasher.update(fingerprint_data.as_bytes());
        let hash = hasher.finalize();
        
        Ok(format!("{:x}", hash))
    }

    /// Calculate security score for device
    fn calculate_security_score(&self, device_info: &DeviceInfo) -> i32 {
        let mut score = 50; // Base score

        // Adjust based on device type
        match device_info.device_type {
            DeviceType::Desktop => score += 10,
            DeviceType::Mobile => score += 5,
            DeviceType::Tablet => score += 5,
            DeviceType::Unknown => score -= 10,
        }

        // Adjust based on browser
        if let Some(browser) = &device_info.browser_name {
            match browser.to_lowercase().as_str() {
                "chrome" | "firefox" | "safari" | "edge" => score += 5,
                _ => score -= 5,
            }
        }

        // Adjust based on OS
        match device_info.os_name.to_lowercase().as_str() {
            "windows" | "macos" | "linux" => score += 5,
            "android" | "ios" => score += 3,
            _ => score -= 5,
        }

        // Ensure score is within bounds
        score.max(0).min(100)
    }

    /// Determine risk level based on security score
    fn determine_risk_level(&self, score: i32) -> RiskLevel {
        match score {
            80..=100 => RiskLevel::Low,
            60..=79 => RiskLevel::Medium,
            40..=59 => RiskLevel::High,
            _ => RiskLevel::Critical,
        }
    }

    /// Get user device count
    async fn get_user_device_count(&self, user_id: Uuid) -> Result<i32, DeviceError> {
        let count = sqlx::query_scalar!(
            "SELECT COUNT(*) as count FROM devices WHERE user_id = $1",
            user_id
        )
        .fetch_one(&self.db_pool)
        .await?;

        Ok(count.unwrap_or(0))
    }

    /// Update device information
    async fn update_device_info(&self, device_id: Uuid, device_info: DeviceInfo) -> Result<Device, DeviceError> {
        let device = sqlx::query_as!(
            Device,
            r#"
            UPDATE devices SET
                device_name = $1,
                os_name = $2,
                os_version = $3,
                browser_name = $4,
                browser_version = $5,
                user_agent = $6,
                screen_resolution = $7,
                timezone = $8,
                language = $9,
                last_seen = NOW(),
                updated_at = NOW()
            WHERE id = $10
            RETURNING *
            "#,
            device_info.device_name,
            device_info.os_name,
            device_info.os_version,
            device_info.browser_name,
            device_info.browser_version,
            device_info.user_agent,
            device_info.screen_resolution,
            device_info.timezone,
            device_info.language,
            device_id
        )
        .fetch_one(&self.db_pool)
        .await?;

        Ok(device)
    }

    /// Log device activity
    async fn log_device_activity(
        &self,
        device_id: Uuid,
        user_id: Uuid,
        activity_type: ActivityType,
        ip_address: &str,
        user_agent: &str,
        success: bool,
        failure_reason: Option<&str>,
        metadata: Option<serde_json::Value>,
    ) -> Result<(), DeviceError> {
        sqlx::query!(
            r#"
            INSERT INTO device_activities (
                device_id, user_id, activity_type, ip_address, user_agent,
                success, failure_reason, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
            device_id,
            user_id,
            activity_type as _,
            ip_address,
            user_agent,
            success,
            failure_reason,
            metadata
        )
        .execute(&self.db_pool)
        .await?;

        Ok(())
    }

    /// Store security alert
    async fn store_security_alert(&self, alert: SecurityAlert) -> Result<(), DeviceError> {
        sqlx::query!(
            r#"
            INSERT INTO security_alerts (
                id, device_id, user_id, alert_type, severity, title, description,
                ip_address, location_country, location_city, metadata, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            "#,
            alert.id,
            alert.device_id,
            alert.user_id,
            alert.alert_type as _,
            alert.severity as _,
            alert.title,
            alert.description,
            alert.ip_address,
            alert.location_country,
            alert.location_city,
            alert.metadata,
            alert.created_at
        )
        .execute(&self.db_pool)
        .await?;

        Ok(())
    }
}
