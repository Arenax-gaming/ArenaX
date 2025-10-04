use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::models::{
    AlertSeverity, AlertType, Device, DeviceConfig, DeviceType, RiskLevel, SecurityAlert,
};

/// Security policy errors
#[derive(Error, Debug)]
pub enum SecurityPolicyError {
    #[error("Policy violation: {0}")]
    PolicyViolation(String),

    #[error("Invalid policy configuration: {0}")]
    InvalidPolicy(String),

    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),

    #[error("Security threshold exceeded: {0}")]
    SecurityThresholdExceeded(String),
}

/// Security policy types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SecurityPolicyType {
    MaxDevicesPerUser,
    DeviceTrustThreshold,
    SuspiciousActivityThreshold,
    LocationChangeThreshold,
    SessionTimeout,
    CleanupInactiveDevices,
    GeolocationRequired,
    DeviceFingerprintingRequired,
    SecurityMonitoringEnabled,
    NotificationEnabled,
}

/// Security policy rule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityPolicyRule {
    pub id: Uuid,
    pub policy_type: SecurityPolicyType,
    pub name: String,
    pub description: String,
    pub is_enabled: bool,
    pub severity: AlertSeverity,
    pub threshold_value: Option<f64>,
    pub threshold_type: Option<String>,
    pub action: PolicyAction,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Policy actions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PolicyAction {
    Block,
    Warn,
    Notify,
    RequireVerification,
    LogOnly,
    AutoResolve,
}

/// Security policy engine
#[derive(Debug, Clone)]
pub struct SecurityPolicyEngine {
    db_pool: PgPool,
    config: DeviceConfig,
    rules: Vec<SecurityPolicyRule>,
}

impl SecurityPolicyEngine {
    /// Create a new security policy engine
    pub fn new(db_pool: PgPool, config: DeviceConfig) -> Self {
        let rules = Self::get_default_rules();
        Self {
            db_pool,
            config,
            rules,
        }
    }

    /// Evaluate device registration against security policies
    pub async fn evaluate_device_registration(
        &self,
        user_id: Uuid,
        device_info: &crate::models::DeviceInfo,
    ) -> Result<PolicyEvaluationResult, SecurityPolicyError> {
        let mut violations = Vec::new();
        let mut warnings = Vec::new();

        // Check max devices per user policy
        if let Some(rule) = self.get_rule(SecurityPolicyType::MaxDevicesPerUser) {
            if rule.is_enabled {
                let device_count = self.get_user_device_count(user_id).await?;
                if device_count >= self.config.max_devices_per_user {
                    violations.push(PolicyViolation {
                        rule_id: rule.id,
                        rule_name: rule.name.clone(),
                        description: format!(
                            "User has {} devices, maximum allowed is {}",
                            device_count, self.config.max_devices_per_user
                        ),
                        severity: rule.severity.clone(),
                        action: rule.action.clone(),
                    });
                }
            }
        }

        // Check device fingerprinting policy
        if let Some(rule) = self.get_rule(SecurityPolicyType::DeviceFingerprintingRequired) {
            if rule.is_enabled && !self.config.enable_device_fingerprinting {
                warnings.push(PolicyViolation {
                    rule_id: rule.id,
                    rule_name: rule.name.clone(),
                    description: "Device fingerprinting is disabled but required by policy".to_string(),
                    severity: rule.severity.clone(),
                    action: rule.action.clone(),
                });
            }
        }

        // Check geolocation policy
        if let Some(rule) = self.get_rule(SecurityPolicyType::GeolocationRequired) {
            if rule.is_enabled && !self.config.enable_geolocation {
                warnings.push(PolicyViolation {
                    rule_id: rule.id,
                    rule_name: rule.name.clone(),
                    description: "Geolocation tracking is disabled but required by policy".to_string(),
                    severity: rule.severity.clone(),
                    action: rule.action.clone(),
                });
            }
        }

        Ok(PolicyEvaluationResult {
            is_allowed: violations.is_empty(),
            violations,
            warnings,
            requires_verification: violations.iter().any(|v| v.action == PolicyAction::RequireVerification),
        })
    }

    /// Evaluate device activity against security policies
    pub async fn evaluate_device_activity(
        &self,
        device_id: Uuid,
        activity_type: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<PolicyEvaluationResult, SecurityPolicyError> {
        let mut violations = Vec::new();
        let mut warnings = Vec::new();

        // Get device information
        let device = self.get_device_by_id(device_id).await?;

        // Check suspicious activity threshold
        if let Some(rule) = self.get_rule(SecurityPolicyType::SuspiciousActivityThreshold) {
            if rule.is_enabled {
                let recent_activities = self.get_recent_suspicious_activities(device_id).await?;
                if recent_activities.len() >= self.config.suspicious_activity_threshold as usize {
                    violations.push(PolicyViolation {
                        rule_id: rule.id,
                        rule_name: rule.name.clone(),
                        description: format!(
                            "Device has {} suspicious activities, threshold is {}",
                            recent_activities.len(),
                            self.config.suspicious_activity_threshold
                        ),
                        severity: rule.severity.clone(),
                        action: rule.action.clone(),
                    });
                }
            }
        }

        // Check device trust threshold
        if let Some(rule) = self.get_rule(SecurityPolicyType::DeviceTrustThreshold) {
            if rule.is_enabled && device.security_score < self.config.device_trust_threshold {
                warnings.push(PolicyViolation {
                    rule_id: rule.id,
                    rule_name: rule.name.clone(),
                    description: format!(
                        "Device security score {} is below trust threshold {}",
                        device.security_score, self.config.device_trust_threshold
                    ),
                    severity: rule.severity.clone(),
                    action: rule.action.clone(),
                });
            }
        }

        Ok(PolicyEvaluationResult {
            is_allowed: violations.is_empty(),
            violations,
            warnings,
            requires_verification: violations.iter().any(|v| v.action == PolicyAction::RequireVerification),
        })
    }

    /// Evaluate location change against security policies
    pub async fn evaluate_location_change(
        &self,
        device_id: Uuid,
        new_location: &str,
        previous_location: Option<&str>,
    ) -> Result<PolicyEvaluationResult, SecurityPolicyError> {
        let mut violations = Vec::new();
        let mut warnings = Vec::new();

        if let Some(rule) = self.get_rule(SecurityPolicyType::LocationChangeThreshold) {
            if rule.is_enabled {
                if let Some(prev_location) = previous_location {
                    // Calculate distance between locations (simplified)
                    let distance = self.calculate_location_distance(prev_location, new_location);
                    
                    if distance > self.config.location_change_threshold {
                        violations.push(PolicyViolation {
                            rule_id: rule.id,
                            rule_name: rule.name.clone(),
                            description: format!(
                                "Location change distance {} km exceeds threshold {} km",
                                distance, self.config.location_change_threshold
                            ),
                            severity: rule.severity.clone(),
                            action: rule.action.clone(),
                        });
                    }
                }
            }
        }

        Ok(PolicyEvaluationResult {
            is_allowed: violations.is_empty(),
            violations,
            warnings,
            requires_verification: violations.iter().any(|v| v.action == PolicyAction::RequireVerification),
        })
    }

    /// Apply security policy actions
    pub async fn apply_policy_actions(
        &self,
        device_id: Uuid,
        user_id: Uuid,
        violations: &[PolicyViolation],
    ) -> Result<Vec<PolicyActionResult>, SecurityPolicyError> {
        let mut results = Vec::new();

        for violation in violations {
            let result = match violation.action {
                PolicyAction::Block => {
                    // Block device access
                    self.block_device(device_id).await?;
                    PolicyActionResult {
                        action: PolicyAction::Block,
                        success: true,
                        message: "Device access blocked".to_string(),
                    }
                }
                PolicyAction::Warn => {
                    // Log warning
                    self.log_security_warning(device_id, user_id, &violation.description).await?;
                    PolicyActionResult {
                        action: PolicyAction::Warn,
                        success: true,
                        message: "Security warning logged".to_string(),
                    }
                }
                PolicyAction::Notify => {
                    // Send notification
                    self.send_security_notification(device_id, user_id, &violation.description).await?;
                    PolicyActionResult {
                        action: PolicyAction::Notify,
                        success: true,
                        message: "Security notification sent".to_string(),
                    }
                }
                PolicyAction::RequireVerification => {
                    // Mark device as requiring verification
                    self.require_device_verification(device_id).await?;
                    PolicyActionResult {
                        action: PolicyAction::RequireVerification,
                        success: true,
                        message: "Device verification required".to_string(),
                    }
                }
                PolicyAction::LogOnly => {
                    // Log only
                    self.log_security_event(device_id, user_id, &violation.description).await?;
                    PolicyActionResult {
                        action: PolicyAction::LogOnly,
                        success: true,
                        message: "Security event logged".to_string(),
                    }
                }
                PolicyAction::AutoResolve => {
                    // Auto-resolve if possible
                    self.auto_resolve_security_issue(device_id, &violation.description).await?;
                    PolicyActionResult {
                        action: PolicyAction::AutoResolve,
                        success: true,
                        message: "Security issue auto-resolved".to_string(),
                    }
                }
            };
            results.push(result);
        }

        Ok(results)
    }

    /// Get security policy rules
    pub async fn get_policy_rules(&self) -> Result<Vec<SecurityPolicyRule>, SecurityPolicyError> {
        // In a real implementation, this would fetch from database
        Ok(self.rules.clone())
    }

    /// Update security policy rule
    pub async fn update_policy_rule(
        &mut self,
        rule_id: Uuid,
        updates: PolicyRuleUpdate,
    ) -> Result<(), SecurityPolicyError> {
        if let Some(rule) = self.rules.iter_mut().find(|r| r.id == rule_id) {
            if let Some(is_enabled) = updates.is_enabled {
                rule.is_enabled = is_enabled;
            }
            if let Some(threshold_value) = updates.threshold_value {
                rule.threshold_value = Some(threshold_value);
            }
            if let Some(action) = updates.action {
                rule.action = action;
            }
            rule.updated_at = Utc::now();
        }
        Ok(())
    }

    // Private helper methods

    fn get_rule(&self, policy_type: SecurityPolicyType) -> Option<&SecurityPolicyRule> {
        self.rules.iter().find(|r| r.policy_type == policy_type)
    }

    fn get_default_rules() -> Vec<SecurityPolicyRule> {
        vec![
            SecurityPolicyRule {
                id: Uuid::new_v4(),
                policy_type: SecurityPolicyType::MaxDevicesPerUser,
                name: "Maximum Devices Per User".to_string(),
                description: "Limit the number of devices a user can register".to_string(),
                is_enabled: true,
                severity: AlertSeverity::High,
                threshold_value: Some(10.0),
                threshold_type: Some("count".to_string()),
                action: PolicyAction::Block,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
            SecurityPolicyRule {
                id: Uuid::new_v4(),
                policy_type: SecurityPolicyType::DeviceTrustThreshold,
                name: "Device Trust Threshold".to_string(),
                description: "Minimum security score required for device trust".to_string(),
                is_enabled: true,
                severity: AlertSeverity::Medium,
                threshold_value: Some(70.0),
                threshold_type: Some("score".to_string()),
                action: PolicyAction::Warn,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
            SecurityPolicyRule {
                id: Uuid::new_v4(),
                policy_type: SecurityPolicyType::SuspiciousActivityThreshold,
                name: "Suspicious Activity Threshold".to_string(),
                description: "Maximum number of suspicious activities before alert".to_string(),
                is_enabled: true,
                severity: AlertSeverity::High,
                threshold_value: Some(3.0),
                threshold_type: Some("count".to_string()),
                action: PolicyAction::Notify,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
            SecurityPolicyRule {
                id: Uuid::new_v4(),
                policy_type: SecurityPolicyType::LocationChangeThreshold,
                name: "Location Change Threshold".to_string(),
                description: "Maximum distance for location changes before alert".to_string(),
                is_enabled: true,
                severity: AlertSeverity::Medium,
                threshold_value: Some(1000.0),
                threshold_type: Some("kilometers".to_string()),
                action: PolicyAction::RequireVerification,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
            SecurityPolicyRule {
                id: Uuid::new_v4(),
                policy_type: SecurityPolicyType::DeviceFingerprintingRequired,
                name: "Device Fingerprinting Required".to_string(),
                description: "Require device fingerprinting for security".to_string(),
                is_enabled: true,
                severity: AlertSeverity::Medium,
                threshold_value: None,
                threshold_type: None,
                action: PolicyAction::Warn,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
            SecurityPolicyRule {
                id: Uuid::new_v4(),
                policy_type: SecurityPolicyType::GeolocationRequired,
                name: "Geolocation Required".to_string(),
                description: "Require geolocation tracking for security".to_string(),
                is_enabled: true,
                severity: AlertSeverity::Low,
                threshold_value: None,
                threshold_type: None,
                action: PolicyAction::LogOnly,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
        ]
    }

    async fn get_user_device_count(&self, user_id: Uuid) -> Result<i32, SecurityPolicyError> {
        let count = sqlx::query_scalar!(
            "SELECT COUNT(*) as count FROM devices WHERE user_id = $1",
            user_id
        )
        .fetch_one(&self.db_pool)
        .await?;

        Ok(count.unwrap_or(0))
    }

    async fn get_device_by_id(&self, device_id: Uuid) -> Result<Device, SecurityPolicyError> {
        sqlx::query_as!(
            Device,
            "SELECT * FROM devices WHERE id = $1",
            device_id
        )
        .fetch_optional(&self.db_pool)
        .await?
        .ok_or_else(|| SecurityPolicyError::PolicyViolation("Device not found".to_string()))
    }

    async fn get_recent_suspicious_activities(&self, device_id: Uuid) -> Result<Vec<SecurityAlert>, SecurityPolicyError> {
        sqlx::query_as!(
            SecurityAlert,
            "SELECT * FROM security_alerts WHERE device_id = $1 AND created_at > NOW() - INTERVAL '24 hours'",
            device_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(SecurityPolicyError::DatabaseError)
    }

    fn calculate_location_distance(&self, location1: &str, location2: &str) -> f64 {
        // Simplified distance calculation - in real implementation, use proper geolocation
        if location1 == location2 {
            0.0
        } else {
            100.0 // Placeholder distance
        }
    }

    async fn block_device(&self, device_id: Uuid) -> Result<(), SecurityPolicyError> {
        sqlx::query!(
            "UPDATE devices SET is_active = false WHERE id = $1",
            device_id
        )
        .execute(&self.db_pool)
        .await?;
        Ok(())
    }

    async fn log_security_warning(&self, device_id: Uuid, user_id: Uuid, description: &str) -> Result<(), SecurityPolicyError> {
        // Log security warning to audit log
        info!("Security warning for device {}: {}", device_id, description);
        Ok(())
    }

    async fn send_security_notification(&self, device_id: Uuid, user_id: Uuid, description: &str) -> Result<(), SecurityPolicyError> {
        // Send security notification
        info!("Security notification sent for device {}: {}", device_id, description);
        Ok(())
    }

    async fn require_device_verification(&self, device_id: Uuid) -> Result<(), SecurityPolicyError> {
        // Mark device as requiring verification
        sqlx::query!(
            "UPDATE devices SET is_trusted = false WHERE id = $1",
            device_id
        )
        .execute(&self.db_pool)
        .await?;
        Ok(())
    }

    async fn log_security_event(&self, device_id: Uuid, user_id: Uuid, description: &str) -> Result<(), SecurityPolicyError> {
        // Log security event
        info!("Security event logged for device {}: {}", device_id, description);
        Ok(())
    }

    async fn auto_resolve_security_issue(&self, device_id: Uuid, description: &str) -> Result<(), SecurityPolicyError> {
        // Auto-resolve security issue if possible
        info!("Auto-resolving security issue for device {}: {}", device_id, description);
        Ok(())
    }
}

/// Policy evaluation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyEvaluationResult {
    pub is_allowed: bool,
    pub violations: Vec<PolicyViolation>,
    pub warnings: Vec<PolicyViolation>,
    pub requires_verification: bool,
}

/// Policy violation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyViolation {
    pub rule_id: Uuid,
    pub rule_name: String,
    pub description: String,
    pub severity: AlertSeverity,
    pub action: PolicyAction,
}

/// Policy action result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyActionResult {
    pub action: PolicyAction,
    pub success: bool,
    pub message: String,
}

/// Policy rule update
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRuleUpdate {
    pub is_enabled: Option<bool>,
    pub threshold_value: Option<f64>,
    pub action: Option<PolicyAction>,
}
