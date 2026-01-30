pub mod jwt_service;
pub mod middleware;

pub use jwt_service::{
    Claims, JwtConfig, JwtError, JwtService, KeyRotation, SessionData, TokenAnalytics, TokenPair,
    TokenType,
};
pub use middleware::AuthMiddleware;
pub mod device_service;

pub use device_service::{
    Device, DeviceInfo, DeviceService, DeviceError, DeviceType, DeviceConfig,
    SecurityAlert, AlertType, AlertSeverity, DeviceAnalytics,
};
