# ArenaX Device Management System

## Overview

The ArenaX Device Management System provides comprehensive multi-device authentication, device fingerprinting, security monitoring, and access control for the ArenaX platform. This system ensures secure access across multiple devices while maintaining user experience and security.

## Features

### Core Functionality
- **Device Registration**: Register and manage multiple devices per user
- **Device Fingerprinting**: Unique device identification using hardware and software characteristics
- **Multi-Device Management**: Support for desktop, mobile, and tablet devices
- **Security Monitoring**: Real-time threat detection and suspicious activity monitoring
- **Access Control**: Device-based access control and trust management
- **Analytics & Reporting**: Comprehensive device analytics and security reporting
- **Notification System**: Real-time notifications for security events
- **Security Policies**: Configurable security policies and rules

### Security Features
- **Risk Assessment**: Automatic security scoring and risk level determination
- **Suspicious Activity Detection**: Detection of unusual patterns and behaviors
- **Location Monitoring**: Geolocation-based security monitoring
- **Device Trust Management**: Trust-based access control
- **Security Alerts**: Automated security alert generation and management
- **Policy Enforcement**: Configurable security policy enforcement

## Architecture

### Components

1. **DeviceService**: Core device management functionality
2. **SecurityMonitor**: Real-time security monitoring and threat detection
3. **DeviceNotificationService**: Notification management and delivery
4. **SecurityPolicyEngine**: Policy evaluation and enforcement
5. **Device Models**: Data models and database schema

### Database Schema

The system uses PostgreSQL with the following main tables:

- `devices`: Device information and metadata
- `device_activities`: Activity logs and audit trail
- `security_alerts`: Security alerts and notifications
- `notification_preferences`: User notification preferences

## Installation

### Dependencies

Add the following dependencies to your `Cargo.toml`:

```toml
[dependencies]
sqlx = { version = "0.8", features = ["postgres", "runtime-tokio-rustls"] }
redis = { version = "0.32", features = ["tokio-comp"] }
serde = { version = "1.0", features = ["derive"] }
uuid = { version = "1.0", features = ["v4"] }
sha2 = "0.10"
chrono = { version = "0.4", features = ["serde"] }
anyhow = "1.0"
thiserror = "1.0"
tracing = "0.1"
```

### Database Migration

Run the database migration to create the required tables:

```bash
sqlx migrate run --database-url "postgres://user:pass@localhost:5432/arenax"
```

The migration file `20241201_create_device_tables.sql` creates:
- Device tables with proper indexes
- Activity logging tables
- Security alert tables
- Database functions for cleanup and security scoring

## Usage

### Basic Setup

```rust
use arenax_backend::auth::{DeviceService, DeviceConfig, DeviceNotificationService};

// Initialize device service
let device_config = DeviceConfig::default();
let device_service = DeviceService::new(db_pool, redis_url, Some(device_config))?;

// Initialize notification service
let notification_service = DeviceNotificationService::new(redis_url, Some("arenax"))?;
```

### Device Registration

```rust
use arenax_backend::models::{DeviceInfo, DeviceType};

let device_info = DeviceInfo {
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
    ip_address: "192.168.1.100".to_string(),
};

let device = device_service.register_device(user_id, device_info).await?;
```

### Device Management

```rust
// Get user devices
let devices = device_service.get_user_devices(user_id).await?;

// Revoke a device
device_service.revoke_device(user_id, device_id).await?;

// Update device trust
device_service.update_device_trust(device_id, true).await?;

// Validate device fingerprint
let is_valid = device_service.validate_device(device_id, fingerprint).await?;
```

### Security Monitoring

```rust
// Detect suspicious activity
if let Some(alert) = device_service.detect_suspicious_activity(device_id).await? {
    // Handle security alert
    println!("Security alert: {}", alert.title);
}

// Get device analytics
let analytics = device_service.get_device_analytics(Some(user_id)).await?;
```

### Notifications

```rust
// Send security alert notification
notification_service.send_security_alert(user_id, device_id, &alert).await?;

// Send device registration notification
notification_service.send_device_registered(
    user_id, 
    device_id, 
    "My iPhone", 
    "192.168.1.100"
).await?;

// Get user notifications
let notifications = notification_service.get_user_notifications(user_id, Some(50), Some(0)).await?;
```

## API Endpoints

### Device Management

- `POST /api/v1/devices` - Register a new device
- `GET /api/v1/devices` - Get user devices
- `GET /api/v1/devices/{device_id}` - Get specific device
- `DELETE /api/v1/devices/{device_id}` - Revoke device
- `PUT /api/v1/devices/{device_id}/trust` - Toggle device trust
- `POST /api/v1/devices/{device_id}/validate` - Validate device fingerprint

### Analytics & Monitoring

- `GET /api/v1/devices/analytics` - Get device analytics
- `POST /api/v1/devices/cleanup` - Cleanup old device data
- `GET /api/v1/security/alerts` - Get security alerts
- `PUT /api/v1/security/alerts/{alert_id}/resolve` - Resolve security alert

### Notifications

- `GET /api/v1/notifications` - Get user notifications
- `PUT /api/v1/notifications/{notification_id}/read` - Mark notification as read

### Security Policies

- `GET /api/v1/security/policies` - Get security policies
- `PUT /api/v1/security/policies` - Update security policies

## Configuration

### Device Configuration

```rust
let config = DeviceConfig {
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
};
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgres://user:pass@localhost:5432/arenax

# Redis
REDIS_URL=redis://localhost:6379

# Device Management
MAX_DEVICES_PER_USER=10
DEVICE_TRUST_THRESHOLD=70
SUSPICIOUS_ACTIVITY_THRESHOLD=3
LOCATION_CHANGE_THRESHOLD=1000.0
```

## Security Features

### Device Fingerprinting

The system generates unique device fingerprints using:
- Device name and type
- Operating system information
- Browser information
- Screen resolution
- Timezone and language settings
- User agent string

### Risk Assessment

Devices are automatically assigned security scores based on:
- Device type (desktop, mobile, tablet)
- Operating system
- Browser type
- Recent activity patterns
- Location changes
- Failed login attempts

### Security Policies

Configurable security policies include:
- Maximum devices per user
- Device trust thresholds
- Suspicious activity thresholds
- Location change thresholds
- Session timeout settings
- Cleanup policies

### Threat Detection

The system detects:
- Rapid location changes
- Multiple failed login attempts
- Unusual activity patterns
- Device compromise indicators
- Unauthorized access attempts

## Monitoring & Analytics

### Device Analytics

- Total and active device counts
- Device distribution by type and location
- Security score distributions
- Risk level analysis
- Recent activity summaries

### Security Monitoring

- Real-time threat detection
- Automated alert generation
- Security event logging
- Policy violation tracking
- Risk assessment updates

### Reporting

- Device usage reports
- Security incident reports
- Policy compliance reports
- User activity summaries
- System health metrics

## Maintenance

### Cleanup Operations

The system automatically cleans up:
- Old device activities (90 days)
- Resolved security alerts (180 days)
- Inactive devices (configurable)
- Expired notifications

### Performance Optimization

- Database indexes for fast queries
- Redis caching for session data
- Efficient fingerprint generation
- Optimized security scoring

## Testing

### Unit Tests

```bash
cargo test device_service
cargo test device_notifications
cargo test security_policies
```

### Integration Tests

```bash
cargo test --test device_integration_tests
```

## Troubleshooting

### Common Issues

1. **Device Registration Fails**
   - Check device limit configuration
   - Verify fingerprint generation
   - Check database connectivity

2. **Security Alerts Not Triggering**
   - Verify Redis connectivity
   - Check security policy configuration
   - Review activity logging

3. **Notifications Not Sent**
   - Check Redis connection
   - Verify notification preferences
   - Review notification service logs

### Debugging

Enable debug logging:

```bash
RUST_LOG=debug cargo run
```

## Security Considerations

### Data Protection

- Device fingerprints are hashed using SHA-256
- Sensitive data is encrypted in transit and at rest
- Personal information is minimized and anonymized

### Access Control

- Device-based access control
- Trust-based authentication
- Policy-driven security enforcement
- Audit logging for all activities

### Privacy

- User consent for device tracking
- Configurable notification preferences
- Data retention policies
- Right to data deletion

## Future Enhancements

### Planned Features

- Machine learning-based threat detection
- Advanced biometric authentication
- Cross-platform device synchronization
- Enhanced geolocation services
- Real-time collaboration features

### Performance Improvements

- Distributed caching
- Database sharding
- Async processing optimization
- CDN integration for notifications

## Contributing

### Development Setup

1. Clone the repository
2. Install dependencies
3. Set up database and Redis
4. Run migrations
5. Start development server

### Code Standards

- Follow Rust best practices
- Use proper error handling
- Write comprehensive tests
- Document public APIs
- Follow security guidelines

## License

This device management system is part of the ArenaX project and follows the same licensing terms.

## Support

For support and questions:
- Create an issue in the repository
- Check the documentation
- Review the troubleshooting guide
- Contact the development team
