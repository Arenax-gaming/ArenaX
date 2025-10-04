use anyhow::Result;
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use backend::{
    auth::{DeviceService, DeviceConfig, DeviceNotificationService},
    models::{DeviceInfo, DeviceType, RegisterDeviceRequest},
};

/// Integration tests for device management system
#[cfg(test)]
mod device_management_tests {
    use super::*;

    async fn setup_test_environment() -> Result<(PgPool, String)> {
        // Setup test database and Redis
        let database_url = std::env::var("TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgres://user:pass@localhost:5432/arenax_test".to_string());
        let redis_url = std::env::var("TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://localhost:6379".to_string());

        let db_pool = sqlx::PgPool::connect(&database_url).await?;
        
        Ok((db_pool, redis_url))
    }

    #[tokio::test]
    async fn test_device_registration() -> Result<()> {
        let (db_pool, redis_url) = setup_test_environment().await?;
        let device_config = DeviceConfig::default();
        let device_service = DeviceService::new(db_pool, &redis_url, Some(device_config))?;

        let user_id = Uuid::new_v4();
        let device_info = DeviceInfo {
            device_name: "Test Device".to_string(),
            device_type: DeviceType::Desktop,
            os_name: "Windows".to_string(),
            os_version: "11".to_string(),
            browser_name: Some("Chrome".to_string()),
            browser_version: Some("120.0".to_string()),
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),
            screen_resolution: Some("1920x1080".to_string()),
            timezone: Some("America/New_York".to_string()),
            language: Some("en-US".to_string()),
            ip_address: "192.168.1.100".to_string(),
        };

        let device = device_service.register_device(user_id, device_info).await?;
        
        assert_eq!(device.device_name, "Test Device");
        assert_eq!(device.user_id, user_id);
        assert!(device.is_active);
        assert!(!device.fingerprint.is_empty());

        Ok(())
    }

    #[tokio::test]
    async fn test_device_fingerprinting() -> Result<()> {
        let (db_pool, redis_url) = setup_test_environment().await?;
        let device_config = DeviceConfig::default();
        let device_service = DeviceService::new(db_pool, &redis_url, Some(device_config))?;

        let user_id = Uuid::new_v4();
        let device_info = DeviceInfo {
            device_name: "Test Device".to_string(),
            device_type: DeviceType::Mobile,
            os_name: "iOS".to_string(),
            os_version: "17.0".to_string(),
            browser_name: Some("Safari".to_string()),
            browser_version: Some("17.0".to_string()),
            user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)".to_string(),
            screen_resolution: Some("1179x2556".to_string()),
            timezone: Some("America/New_York".to_string()),
            language: Some("en-US".to_string()),
            ip_address: "192.168.1.100".to_string(),
        };

        let device1 = device_service.register_device(user_id, device_info.clone()).await?;
        
        // Register same device info again - should update existing device
        let device2 = device_service.register_device(user_id, device_info).await?;
        
        assert_eq!(device1.id, device2.id);
        assert_eq!(device1.fingerprint, device2.fingerprint);

        Ok(())
    }

    #[tokio::test]
    async fn test_device_validation() -> Result<()> {
        let (db_pool, redis_url) = setup_test_environment().await?;
        let device_config = DeviceConfig::default();
        let device_service = DeviceService::new(db_pool, &redis_url, Some(device_config))?;

        let user_id = Uuid::new_v4();
        let device_info = DeviceInfo {
            device_name: "Test Device".to_string(),
            device_type: DeviceType::Desktop,
            os_name: "Windows".to_string(),
            os_version: "11".to_string(),
            browser_name: Some("Chrome".to_string()),
            browser_version: Some("120.0".to_string()),
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),
            screen_resolution: Some("1920x1080".to_string()),
            timezone: Some("America/New_York".to_string()),
            language: Some("en-US".to_string()),
            ip_address: "192.168.1.100".to_string(),
        };

        let device = device_service.register_device(user_id, device_info).await?;
        
        // Validate with correct fingerprint
        let is_valid = device_service.validate_device(device.id, &device.fingerprint).await?;
        assert!(is_valid);

        // Validate with incorrect fingerprint
        let is_valid = device_service.validate_device(device.id, "invalid_fingerprint").await?;
        assert!(!is_valid);

        Ok(())
    }

    #[tokio::test]
    async fn test_device_revocation() -> Result<()> {
        let (db_pool, redis_url) = setup_test_environment().await?;
        let device_config = DeviceConfig::default();
        let device_service = DeviceService::new(db_pool, &redis_url, Some(device_config))?;

        let user_id = Uuid::new_v4();
        let device_info = DeviceInfo {
            device_name: "Test Device".to_string(),
            device_type: DeviceType::Desktop,
            os_name: "Windows".to_string(),
            os_version: "11".to_string(),
            browser_name: Some("Chrome".to_string()),
            browser_version: Some("120.0".to_string()),
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),
            screen_resolution: Some("1920x1080".to_string()),
            timezone: Some("America/New_York".to_string()),
            language: Some("en-US".to_string()),
            ip_address: "192.168.1.100".to_string(),
        };

        let device = device_service.register_device(user_id, device_info).await?;
        
        // Revoke device
        device_service.revoke_device(user_id, device.id).await?;
        
        // Try to validate revoked device
        let is_valid = device_service.validate_device(device.id, &device.fingerprint).await?;
        assert!(!is_valid);

        Ok(())
    }

    #[tokio::test]
    async fn test_max_devices_limit() -> Result<()> {
        let (db_pool, redis_url) = setup_test_environment().await?;
        let mut device_config = DeviceConfig::default();
        device_config.max_devices_per_user = 2; // Set low limit for testing
        let device_service = DeviceService::new(db_pool, &redis_url, Some(device_config))?;

        let user_id = Uuid::new_v4();
        
        // Register first device
        let device_info1 = DeviceInfo {
            device_name: "Device 1".to_string(),
            device_type: DeviceType::Desktop,
            os_name: "Windows".to_string(),
            os_version: "11".to_string(),
            browser_name: Some("Chrome".to_string()),
            browser_version: Some("120.0".to_string()),
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),
            screen_resolution: Some("1920x1080".to_string()),
            timezone: Some("America/New_York".to_string()),
            language: Some("en-US".to_string()),
            ip_address: "192.168.1.100".to_string(),
        };
        let _device1 = device_service.register_device(user_id, device_info1).await?;

        // Register second device
        let device_info2 = DeviceInfo {
            device_name: "Device 2".to_string(),
            device_type: DeviceType::Mobile,
            os_name: "iOS".to_string(),
            os_version: "17.0".to_string(),
            browser_name: Some("Safari".to_string()),
            browser_version: Some("17.0".to_string()),
            user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)".to_string(),
            screen_resolution: Some("1179x2556".to_string()),
            timezone: Some("America/New_York".to_string()),
            language: Some("en-US".to_string()),
            ip_address: "192.168.1.101".to_string(),
        };
        let _device2 = device_service.register_device(user_id, device_info2).await?;

        // Try to register third device - should fail
        let device_info3 = DeviceInfo {
            device_name: "Device 3".to_string(),
            device_type: DeviceType::Tablet,
            os_name: "Android".to_string(),
            os_version: "13".to_string(),
            browser_name: Some("Chrome".to_string()),
            browser_version: Some("120.0".to_string()),
            user_agent: "Mozilla/5.0 (Linux; Android 13; SM-T970) AppleWebKit/537.36".to_string(),
            screen_resolution: Some("2560x1600".to_string()),
            timezone: Some("America/New_York".to_string()),
            language: Some("en-US".to_string()),
            ip_address: "192.168.1.102".to_string(),
        };
        
        let result = device_service.register_device(user_id, device_info3).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), backend::auth::DeviceError::MaxDevicesExceeded));

        Ok(())
    }

    #[tokio::test]
    async fn test_device_analytics() -> Result<()> {
        let (db_pool, redis_url) = setup_test_environment().await?;
        let device_config = DeviceConfig::default();
        let device_service = DeviceService::new(db_pool, &redis_url, Some(device_config))?;

        let user_id = Uuid::new_v4();
        
        // Register a device
        let device_info = DeviceInfo {
            device_name: "Test Device".to_string(),
            device_type: DeviceType::Desktop,
            os_name: "Windows".to_string(),
            os_version: "11".to_string(),
            browser_name: Some("Chrome".to_string()),
            browser_version: Some("120.0".to_string()),
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),
            screen_resolution: Some("1920x1080".to_string()),
            timezone: Some("America/New_York".to_string()),
            language: Some("en-US".to_string()),
            ip_address: "192.168.1.100".to_string(),
        };
        let _device = device_service.register_device(user_id, device_info).await?;

        // Get analytics
        let analytics = device_service.get_device_analytics(Some(user_id)).await?;
        
        assert_eq!(analytics.total_devices, 1);
        assert_eq!(analytics.active_devices, 1);
        assert!(analytics.average_security_score > 0.0);

        Ok(())
    }

    #[tokio::test]
    async fn test_notification_service() -> Result<()> {
        let redis_url = std::env::var("TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://localhost:6379".to_string());
        let notification_service = DeviceNotificationService::new(&redis_url, Some("arenax_test"))?;

        let user_id = Uuid::new_v4();
        let device_id = Uuid::new_v4();

        // Send device registration notification
        notification_service.send_device_registered(
            user_id,
            device_id,
            "Test Device",
            "192.168.1.100",
        ).await?;

        // Get notifications
        let notifications = notification_service.get_user_notifications(user_id, Some(10), Some(0)).await?;
        
        assert!(!notifications.is_empty());
        assert_eq!(notifications[0].user_id, user_id);
        assert_eq!(notifications[0].device_id, Some(device_id));

        Ok(())
    }

    #[tokio::test]
    async fn test_security_monitoring() -> Result<()> {
        let (db_pool, redis_url) = setup_test_environment().await?;
        let device_config = DeviceConfig::default();
        let device_service = DeviceService::new(db_pool, &redis_url, Some(device_config))?;

        let user_id = Uuid::new_v4();
        let device_info = DeviceInfo {
            device_name: "Test Device".to_string(),
            device_type: DeviceType::Desktop,
            os_name: "Windows".to_string(),
            os_version: "11".to_string(),
            browser_name: Some("Chrome".to_string()),
            browser_version: Some("120.0".to_string()),
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),
            screen_resolution: Some("1920x1080".to_string()),
            timezone: Some("America/New_York".to_string()),
            language: Some("en-US".to_string()),
            ip_address: "192.168.1.100".to_string(),
        };

        let device = device_service.register_device(user_id, device_info).await?;

        // Check for suspicious activity (should be none initially)
        let alert = device_service.detect_suspicious_activity(device.id).await?;
        assert!(alert.is_none());

        Ok(())
    }
}

/// Performance tests
#[cfg(test)]
mod performance_tests {
    use super::*;
    use std::time::Instant;

    #[tokio::test]
    async fn test_device_registration_performance() -> Result<()> {
        let (db_pool, redis_url) = setup_test_environment().await?;
        let device_config = DeviceConfig::default();
        let device_service = DeviceService::new(db_pool, &redis_url, Some(device_config))?;

        let start = Instant::now();
        
        // Register 100 devices
        for i in 0..100 {
            let user_id = Uuid::new_v4();
            let device_info = DeviceInfo {
                device_name: format!("Device {}", i),
                device_type: DeviceType::Desktop,
                os_name: "Windows".to_string(),
                os_version: "11".to_string(),
                browser_name: Some("Chrome".to_string()),
                browser_version: Some("120.0".to_string()),
                user_agent: format!("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Device{}", i),
                screen_resolution: Some("1920x1080".to_string()),
                timezone: Some("America/New_York".to_string()),
                language: Some("en-US".to_string()),
                ip_address: format!("192.168.1.{}", i % 255),
            };
            
            let _device = device_service.register_device(user_id, device_info).await?;
        }

        let duration = start.elapsed();
        println!("Registered 100 devices in {:?}", duration);
        
        // Should complete within reasonable time (adjust threshold as needed)
        assert!(duration.as_secs() < 30);

        Ok(())
    }

    #[tokio::test]
    async fn test_device_validation_performance() -> Result<()> {
        let (db_pool, redis_url) = setup_test_environment().await?;
        let device_config = DeviceConfig::default();
        let device_service = DeviceService::new(db_pool, &redis_url, Some(device_config))?;

        let user_id = Uuid::new_v4();
        let device_info = DeviceInfo {
            device_name: "Test Device".to_string(),
            device_type: DeviceType::Desktop,
            os_name: "Windows".to_string(),
            os_version: "11".to_string(),
            browser_name: Some("Chrome".to_string()),
            browser_version: Some("120.0".to_string()),
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),
            screen_resolution: Some("1920x1080".to_string()),
            timezone: Some("America/New_York".to_string()),
            language: Some("en-US".to_string()),
            ip_address: "192.168.1.100".to_string(),
        };

        let device = device_service.register_device(user_id, device_info).await?;

        let start = Instant::now();
        
        // Validate device 1000 times
        for _ in 0..1000 {
            let _is_valid = device_service.validate_device(device.id, &device.fingerprint).await?;
        }

        let duration = start.elapsed();
        println!("Validated device 1000 times in {:?}", duration);
        
        // Should complete within reasonable time
        assert!(duration.as_secs() < 10);

        Ok(())
    }
}
