use anyhow::Result;
use chrono::{DateTime, Utc};
use redis::{AsyncCommands, Client as RedisClient};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::models::{AlertSeverity, AlertType, SecurityAlert};

/// Device notification errors
#[derive(Error, Debug)]
pub enum NotificationError {
    #[error("Redis error: {0}")]
    RedisError(#[from] redis::RedisError),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("Notification channel error: {0}")]
    ChannelError(String),
}

/// Notification types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NotificationType {
    SecurityAlert,
    DeviceRegistered,
    DeviceRevoked,
    SuspiciousActivity,
    TrustStatusChanged,
    LoginFromNewLocation,
    MultipleDevicesDetected,
}

/// Device notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceNotification {
    pub id: Uuid,
    pub user_id: Uuid,
    pub device_id: Option<Uuid>,
    pub notification_type: NotificationType,
    pub title: String,
    pub message: String,
    pub severity: AlertSeverity,
    pub metadata: Option<serde_json::Value>,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Notification preferences
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPreferences {
    pub user_id: Uuid,
    pub email_notifications: bool,
    pub push_notifications: bool,
    pub sms_notifications: bool,
    pub security_alerts: bool,
    pub device_updates: bool,
    pub login_notifications: bool,
    pub location_alerts: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Default for NotificationPreferences {
    fn default() -> Self {
        Self {
            user_id: Uuid::new_v4(),
            email_notifications: true,
            push_notifications: true,
            sms_notifications: false,
            security_alerts: true,
            device_updates: true,
            login_notifications: true,
            location_alerts: true,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }
}

/// Device notification service
#[derive(Debug, Clone)]
pub struct DeviceNotificationService {
    redis_client: RedisClient,
    notification_channel: String,
}

impl DeviceNotificationService {
    /// Create a new notification service
    pub fn new(redis_url: &str, channel_prefix: Option<&str>) -> Result<Self, NotificationError> {
        let redis_client = RedisClient::open(redis_url)?;
        let notification_channel = format!(
            "{}:device_notifications",
            channel_prefix.unwrap_or("arenax")
        );

        Ok(Self {
            redis_client,
            notification_channel,
        })
    }

    /// Send a security alert notification
    pub async fn send_security_alert(
        &self,
        user_id: Uuid,
        device_id: Uuid,
        alert: &SecurityAlert,
    ) -> Result<(), NotificationError> {
        let notification = DeviceNotification {
            id: Uuid::new_v4(),
            user_id,
            device_id: Some(device_id),
            notification_type: NotificationType::SecurityAlert,
            title: alert.title.clone(),
            message: alert.description.clone(),
            severity: alert.severity.clone(),
            metadata: Some(serde_json::json!({
                "alert_id": alert.id,
                "alert_type": alert.alert_type,
                "ip_address": alert.ip_address,
                "location": {
                    "country": alert.location_country,
                    "city": alert.location_city
                }
            })),
            is_read: false,
            created_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::days(30)),
        };

        self.send_notification(notification).await?;
        info!("Sent security alert notification to user {}", user_id);
        Ok(())
    }

    /// Send device registration notification
    pub async fn send_device_registered(
        &self,
        user_id: Uuid,
        device_id: Uuid,
        device_name: &str,
        ip_address: &str,
    ) -> Result<(), NotificationError> {
        let notification = DeviceNotification {
            id: Uuid::new_v4(),
            user_id,
            device_id: Some(device_id),
            notification_type: NotificationType::DeviceRegistered,
            title: "New Device Registered".to_string(),
            message: format!(
                "A new device '{}' has been registered from IP address {}",
                device_name, ip_address
            ),
            severity: AlertSeverity::Low,
            metadata: Some(serde_json::json!({
                "device_name": device_name,
                "ip_address": ip_address
            })),
            is_read: false,
            created_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::days(7)),
        };

        self.send_notification(notification).await?;
        info!("Sent device registration notification to user {}", user_id);
        Ok(())
    }

    /// Send device revocation notification
    pub async fn send_device_revoked(
        &self,
        user_id: Uuid,
        device_id: Uuid,
        device_name: &str,
    ) -> Result<(), NotificationError> {
        let notification = DeviceNotification {
            id: Uuid::new_v4(),
            user_id,
            device_id: Some(device_id),
            notification_type: NotificationType::DeviceRevoked,
            title: "Device Access Revoked".to_string(),
            message: format!("Access has been revoked for device '{}'", device_name),
            severity: AlertSeverity::Medium,
            metadata: Some(serde_json::json!({
                "device_name": device_name
            })),
            is_read: false,
            created_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::days(7)),
        };

        self.send_notification(notification).await?;
        info!("Sent device revocation notification to user {}", user_id);
        Ok(())
    }

    /// Send suspicious activity notification
    pub async fn send_suspicious_activity(
        &self,
        user_id: Uuid,
        device_id: Uuid,
        activity_description: &str,
        severity: AlertSeverity,
    ) -> Result<(), NotificationError> {
        let notification = DeviceNotification {
            id: Uuid::new_v4(),
            user_id,
            device_id: Some(device_id),
            notification_type: NotificationType::SuspiciousActivity,
            title: "Suspicious Activity Detected".to_string(),
            message: activity_description.to_string(),
            severity,
            metadata: Some(serde_json::json!({
                "activity_description": activity_description
            })),
            is_read: false,
            created_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::days(14)),
        };

        self.send_notification(notification).await?;
        info!("Sent suspicious activity notification to user {}", user_id);
        Ok(())
    }

    /// Send trust status change notification
    pub async fn send_trust_status_changed(
        &self,
        user_id: Uuid,
        device_id: Uuid,
        device_name: &str,
        is_trusted: bool,
    ) -> Result<(), NotificationError> {
        let (title, message) = if is_trusted {
            (
                "Device Trusted".to_string(),
                format!("Device '{}' has been marked as trusted", device_name),
            )
        } else {
            (
                "Device Trust Removed".to_string(),
                format!("Device '{}' is no longer trusted", device_name),
            )
        };

        let notification = DeviceNotification {
            id: Uuid::new_v4(),
            user_id,
            device_id: Some(device_id),
            notification_type: NotificationType::TrustStatusChanged,
            title,
            message,
            severity: AlertSeverity::Low,
            metadata: Some(serde_json::json!({
                "device_name": device_name,
                "is_trusted": is_trusted
            })),
            is_read: false,
            created_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::days(7)),
        };

        self.send_notification(notification).await?;
        info!("Sent trust status change notification to user {}", user_id);
        Ok(())
    }

    /// Send login from new location notification
    pub async fn send_login_from_new_location(
        &self,
        user_id: Uuid,
        device_id: Uuid,
        device_name: &str,
        location: &str,
        ip_address: &str,
    ) -> Result<(), NotificationError> {
        let notification = DeviceNotification {
            id: Uuid::new_v4(),
            user_id,
            device_id: Some(device_id),
            notification_type: NotificationType::LoginFromNewLocation,
            title: "Login from New Location".to_string(),
            message: format!(
                "Device '{}' logged in from a new location: {} (IP: {})",
                device_name, location, ip_address
            ),
            severity: AlertSeverity::Medium,
            metadata: Some(serde_json::json!({
                "device_name": device_name,
                "location": location,
                "ip_address": ip_address
            })),
            is_read: false,
            created_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::days(7)),
        };

        self.send_notification(notification).await?;
        info!("Sent new location login notification to user {}", user_id);
        Ok(())
    }

    /// Send multiple devices detected notification
    pub async fn send_multiple_devices_detected(
        &self,
        user_id: Uuid,
        device_count: i32,
        max_devices: i32,
    ) -> Result<(), NotificationError> {
        let notification = DeviceNotification {
            id: Uuid::new_v4(),
            user_id,
            device_id: None,
            notification_type: NotificationType::MultipleDevicesDetected,
            title: "Multiple Devices Detected".to_string(),
            message: format!(
                "You have {} devices registered (maximum: {}). Consider reviewing your device list.",
                device_count, max_devices
            ),
            severity: AlertSeverity::Low,
            metadata: Some(serde_json::json!({
                "device_count": device_count,
                "max_devices": max_devices
            })),
            is_read: false,
            created_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::days(7)),
        };

        self.send_notification(notification).await?;
        info!("Sent multiple devices notification to user {}", user_id);
        Ok(())
    }

    /// Get notifications for a user
    pub async fn get_user_notifications(
        &self,
        user_id: Uuid,
        limit: Option<i32>,
        offset: Option<i32>,
    ) -> Result<Vec<DeviceNotification>, NotificationError> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let user_key = format!("user:{}:notifications", user_id);
        
        let limit = limit.unwrap_or(50);
        let offset = offset.unwrap_or(0);
        
        let notifications: Vec<String> = conn
            .lrange(&user_key, offset, offset + limit - 1)
            .await?;

        let mut result = Vec::new();
        for notification_json in notifications {
            if let Ok(notification) = serde_json::from_str::<DeviceNotification>(&notification_json) {
                // Check if notification has expired
                if let Some(expires_at) = notification.expires_at {
                    if expires_at < Utc::now() {
                        continue;
                    }
                }
                result.push(notification);
            }
        }

        Ok(result)
    }

    /// Mark notification as read
    pub async fn mark_notification_read(
        &self,
        user_id: Uuid,
        notification_id: Uuid,
    ) -> Result<(), NotificationError> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let user_key = format!("user:{}:notifications", user_id);
        
        let notifications: Vec<String> = conn.lrange(&user_key, 0, -1).await?;
        
        for notification_json in notifications {
            if let Ok(mut notification) = serde_json::from_str::<DeviceNotification>(&notification_json) {
                if notification.id == notification_id {
                    notification.is_read = true;
                    let updated_json = serde_json::to_string(&notification)?;
                    
                    // Replace the notification in the list
                    conn.lrem(&user_key, 1, &notification_json).await?;
                    conn.lpush(&user_key, updated_json).await?;
                    break;
                }
            }
        }

        Ok(())
    }

    /// Clear expired notifications
    pub async fn clear_expired_notifications(&self) -> Result<(), NotificationError> {
        let mut conn = self.redis_client.get_async_connection().await?;
        
        // Get all user notification keys
        let keys: Vec<String> = conn.keys("user:*:notifications").await?;
        
        for key in keys {
            let notifications: Vec<String> = conn.lrange(&key, 0, -1).await?;
            let mut valid_notifications = Vec::new();
            
            for notification_json in notifications {
                if let Ok(notification) = serde_json::from_str::<DeviceNotification>(&notification_json) {
                    // Keep notification if it hasn't expired
                    if let Some(expires_at) = notification.expires_at {
                        if expires_at >= Utc::now() {
                            valid_notifications.push(notification_json);
                        }
                    } else {
                        // Keep notifications without expiration
                        valid_notifications.push(notification_json);
                    }
                }
            }
            
            // Replace the list with valid notifications
            if valid_notifications.len() != notifications.len() {
                conn.del(&key).await?;
                if !valid_notifications.is_empty() {
                    conn.lpush(&key, valid_notifications).await?;
                }
            }
        }

        info!("Cleared expired notifications");
        Ok(())
    }

    /// Private method to send notification
    async fn send_notification(&self, notification: DeviceNotification) -> Result<(), NotificationError> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let user_key = format!("user:{}:notifications", notification.user_id);
        
        let notification_json = serde_json::to_string(&notification)?;
        
        // Add to user's notification list
        conn.lpush(&user_key, &notification_json).await?;
        
        // Limit notifications per user (keep last 100)
        conn.ltrim(&user_key, 0, 99).await?;
        
        // Set expiration for the user's notification list (30 days)
        conn.expire(&user_key, 2592000).await?;
        
        // Publish to notification channel for real-time updates
        conn.publish(&self.notification_channel, &notification_json).await?;
        
        Ok(())
    }
}

/// Notification preferences service
#[derive(Debug, Clone)]
pub struct NotificationPreferencesService {
    redis_client: RedisClient,
}

impl NotificationPreferencesService {
    /// Create a new preferences service
    pub fn new(redis_url: &str) -> Result<Self, NotificationError> {
        let redis_client = RedisClient::open(redis_url)?;
        Ok(Self { redis_client })
    }

    /// Get user notification preferences
    pub async fn get_preferences(&self, user_id: Uuid) -> Result<NotificationPreferences, NotificationError> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let key = format!("user:{}:notification_preferences", user_id);
        
        let preferences_json: Option<String> = conn.get(&key).await?;
        
        if let Some(json) = preferences_json {
            let preferences: NotificationPreferences = serde_json::from_str(&json)?;
            Ok(preferences)
        } else {
            // Return default preferences
            Ok(NotificationPreferences {
                user_id,
                ..Default::default()
            })
        }
    }

    /// Update user notification preferences
    pub async fn update_preferences(
        &self,
        preferences: NotificationPreferences,
    ) -> Result<(), NotificationError> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let key = format!("user:{}:notification_preferences", preferences.user_id);
        
        let preferences_json = serde_json::to_string(&preferences)?;
        conn.set(&key, preferences_json).await?;
        
        // Set expiration (1 year)
        conn.expire(&key, 31536000).await?;
        
        Ok(())
    }
}
