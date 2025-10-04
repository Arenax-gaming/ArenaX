pub mod device_notifications;
pub mod device_security_policies;
pub mod device_service;
pub mod jwt_service;

#[allow(unused_imports)]
pub use device_notifications::{
    DeviceNotification, DeviceNotificationService, NotificationError, NotificationPreferences,
    NotificationPreferencesService, NotificationType,
};
#[allow(unused_imports)]
pub use device_security_policies::{
    PolicyAction, PolicyActionResult, PolicyEvaluationResult, PolicyRuleUpdate, PolicyViolation,
    SecurityPolicyEngine, SecurityPolicyError, SecurityPolicyRule, SecurityPolicyType,
};
#[allow(unused_imports)]
pub use device_service::{
    DeviceAnalytics, DeviceConfig, DeviceError, DeviceInfo, DeviceService, RegisterDeviceRequest,
    SecurityAlert, SecurityMonitor,
};
#[allow(unused_imports)]
pub use jwt_service::{
    Claims, JwtConfig, JwtError, JwtService, SessionInfo, TokenAnalytics, TokenPair, TokenType,
};

// Re-export common functionality
#[allow(unused_imports)]
pub use jwt_service::JwtService as AuthService;
