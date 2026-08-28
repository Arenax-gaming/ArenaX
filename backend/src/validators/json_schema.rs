//! JSON Schema (draft-07) validation.
//!
//! Schemas are declared once (see [`schemas`]) and compiled into reusable
//! [`JsonSchemaValidator`]s. Validation results are aggregated into
//! `validator::ValidationErrors` (code `json_schema`) so they flow through the
//! same localization and error-handling path as the derive-based validators.
//!
//! # Example
//!
//! ```ignore
//! use crate::validators::json_schema::{register_validator, schemas};
//!
//! let validator = register_validator()?;
//! let payload = serde_json::json!({ "username": "player", "password": "StrongPass1" });
//! validator.validate(&payload)?;
//! ```

use std::borrow::Cow;
use std::fmt;

use serde_json::Value;
use validator::{ValidationError, ValidationErrors};

/// A compiled JSON Schema validator.
///
/// Compiles the schema once (in `new`) and can then be reused for any number
/// of instances — prefer this over one-off validation in request handlers.
pub struct JsonSchemaValidator {
    name: &'static str,
    compiled: jsonschema::Validator,
}

/// Raised when a schema document cannot be compiled.
#[derive(Debug, Clone)]
pub struct JsonSchemaError(pub String);

impl fmt::Display for JsonSchemaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid JSON schema: {}", self.0)
    }
}

impl std::error::Error for JsonSchemaError {}

impl JsonSchemaValidator {
    /// Compile `schema` (draft-07) under `name`.
    ///
    /// `name` is used as the field key when errors are aggregated, so
    /// localization reports failures against the schema that rejected the
    /// payload.
    pub fn new(name: &'static str, schema: &Value) -> Result<Self, JsonSchemaError> {
        let compiled = jsonschema::draft7::options()
            .should_validate_formats(true)
            .build(schema)
            .map_err(|e| JsonSchemaError(e.to_string()))?;
        Ok(Self { name, compiled })
    }

    /// The schema name this validator was compiled under.
    pub fn name(&self) -> &'static str {
        self.name
    }

    /// Whether `instance` satisfies the schema.
    pub fn is_valid(&self, instance: &Value) -> bool {
        self.compiled.is_valid(instance)
    }

    /// Validate `instance` against the compiled schema.
    ///
    /// On failure, every schema violation is collected into a single
    /// `ValidationErrors` (field = schema name, code = `json_schema`) with the
    /// instance path and a human-readable detail attached as params.
    pub fn validate(&self, instance: &Value) -> Result<(), ValidationErrors> {
        let mut errors = ValidationErrors::new();
        for error in self.compiled.iter_errors(instance) {
            let mut ve = ValidationError::new("json_schema");
            ve.add_param(Cow::from("path"), &error.instance_path.to_string());
            ve.add_param(Cow::from("detail"), &error.to_string());
            errors.add(self.name, ve);
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

/// One-off validation of `instance` against an arbitrary `schema`.
///
/// Prefer compiling a [`JsonSchemaValidator`] when the same schema is used for
/// many requests.
pub fn validate_instance(schema: &Value, instance: &Value) -> Result<(), ValidationErrors> {
    let validator = JsonSchemaValidator::new("instance", schema).map_err(|e| {
        let mut ve = ValidationError::new("schema");
        ve.add_param(Cow::from("detail"), &e.to_string());
        let mut errors = ValidationErrors::new();
        errors.add("instance", ve);
        errors
    })?;
    validator.validate(instance)
}

/// JSON Schema documents for the ArenaX request payloads.
///
/// Schemas live here so the API contract is reviewable in one place. New
/// payloads should add a schema function plus a convenience constructor below.
pub mod schemas {
    use serde_json::{json, Value};

    const DRAFT_07: &str = "http://json-schema.org/draft-07/schema#";

    /// `POST /api/auth/register` — `CreateUserRequest`.
    pub fn register() -> Value {
        json!({
            "$schema": DRAFT_07,
            "type": "object",
            "additionalProperties": false,
            "required": ["username", "password"],
            "properties": {
                "username": {
                    "type": "string",
                    "minLength": 3,
                    "maxLength": 32,
                    "pattern": "^[a-zA-Z0-9_.-]+$"
                },
                "email": { "type": "string", "format": "email" },
                "phone_number": { "type": "string", "pattern": "^\\+?[0-9]{7,15}$" },
                "password": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 128,
                    "pattern": "^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).*$"
                }
            }
        })
    }

    /// `POST /api/auth/login` — `LoginRequest`.
    pub fn login() -> Value {
        json!({
            "$schema": DRAFT_07,
            "type": "object",
            "additionalProperties": false,
            "required": ["email", "password"],
            "properties": {
                "email": { "type": "string", "format": "email" },
                "password": { "type": "string", "minLength": 1, "maxLength": 128 }
            }
        })
    }

    /// `POST /api/auth/change-password` — `ChangePasswordRequest`.
    pub fn change_password() -> Value {
        json!({
            "$schema": DRAFT_07,
            "type": "object",
            "additionalProperties": false,
            "required": ["old_password", "new_password"],
            "properties": {
                "old_password": { "type": "string", "minLength": 1, "maxLength": 128 },
                "new_password": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 128,
                    "pattern": "^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).*$"
                }
            }
        })
    }

    /// `POST /api/wallet/deposit` — `DepositRequest`.
    pub fn deposit() -> Value {
        json!({
            "$schema": DRAFT_07,
            "type": "object",
            "additionalProperties": false,
            "required": ["amount", "currency"],
            "properties": {
                "amount": { "type": ["number", "string"], "exclusiveMinimum": 0 },
                "currency": { "type": "string", "pattern": "^[A-Z0-9]{3,10}$" },
                "payment_method": { "type": "string", "minLength": 1, "maxLength": 50 }
            }
        })
    }

    /// `POST /api/wallet/withdraw` — `WithdrawalRequest`.
    pub fn withdraw() -> Value {
        json!({
            "$schema": DRAFT_07,
            "type": "object",
            "additionalProperties": false,
            "required": ["amount", "currency", "destination"],
            "properties": {
                "amount": { "type": ["number", "string"], "exclusiveMinimum": 0 },
                "currency": { "type": "string", "pattern": "^[A-Z0-9]{3,10}$" },
                "destination": { "type": "string", "minLength": 1, "maxLength": 255 },
                "payment_method": { "type": "string", "minLength": 1, "maxLength": 50 }
            }
        })
    }

    /// `POST /api/match-authority/.../create` — `CreateMatchDTO`.
    pub fn create_match() -> Value {
        json!({
            "$schema": DRAFT_07,
            "type": "object",
            "additionalProperties": false,
            "required": ["player_a", "player_b"],
            "properties": {
                "player_a": { "type": "string", "minLength": 56, "maxLength": 56, "pattern": "^[A-Z2-7]{56}$" },
                "player_b": { "type": "string", "minLength": 56, "maxLength": 56, "pattern": "^[A-Z2-7]{56}$" },
                "idempotency_key": { "type": "string", "minLength": 8, "maxLength": 128 }
            }
        })
    }

    /// `POST /api/analytics/match` — `RecordMatchBody`.
    pub fn record_match() -> Value {
        json!({
            "$schema": DRAFT_07,
            "type": "object",
            "additionalProperties": false,
            "required": [
                "game_id", "match_id", "duration_secs",
                "wager_amount", "reward_amount", "player_count"
            ],
            "properties": {
                "game_id": { "type": "integer", "minimum": 1 },
                "match_id": {
                    "type": "string",
                    "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
                },
                "duration_secs": { "type": "integer", "minimum": 0 },
                "wager_amount": { "type": "integer", "minimum": 0 },
                "reward_amount": { "type": "integer", "minimum": 0 },
                "player_count": { "type": "integer", "minimum": 1 }
            }
        })
    }
}

macro_rules! named_validator {
    ($validator:ident, $schema_fn:ident, $schema_name:literal) => {
        /// Compile the corresponding schema from [`schemas`] into a reusable validator.
        pub fn $validator() -> Result<JsonSchemaValidator, JsonSchemaError> {
            JsonSchemaValidator::new($schema_name, &schemas::$schema_fn())
        }
    };
}

named_validator!(register_validator, register, "register");
named_validator!(login_validator, login, "login");
named_validator!(change_password_validator, change_password, "change_password");
named_validator!(deposit_validator, deposit, "deposit");
named_validator!(withdraw_validator, withdraw, "withdraw");
named_validator!(create_match_validator, create_match, "create_match");
named_validator!(record_match_validator, record_match, "record_match");

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn register_schema_accepts_valid_payload() {
        let validator = register_validator().unwrap();
        let payload = json!({
            "username": "player_one",
            "email": "player@example.com",
            "phone_number": "+2348012345678",
            "password": "StrongPass1"
        });
        assert!(validator.is_valid(&payload));
        assert!(validator.validate(&payload).is_ok());
    }

    #[test]
    fn register_schema_rejects_invalid_payload() {
        let validator = register_validator().unwrap();
        let payload = json!({
            "username": "x",
            "password": "weak"
        });
        let errors = validator.validate(&payload).unwrap_err();
        let field_errors = errors
            .field_errors("register")
            .expect("errors are keyed by schema name");
        assert!(!field_errors.is_empty());
        for e in field_errors {
            assert_eq!(e.code.as_ref(), "json_schema");
            assert!(e.params.contains_key("path"));
            assert!(e.params.contains_key("detail"));
        }
    }

    #[test]
    fn login_schema_rejects_unknown_fields() {
        let validator = login_validator().unwrap();
        // additionalProperties: false
        let payload = json!({
            "email": "player@example.com",
            "password": "password",
            "admin": true
        });
        assert!(validator.validate(&payload).is_err());
    }

    #[test]
    fn deposit_schema_accepts_number_and_string_amounts() {
        let validator = deposit_validator().unwrap();
        assert!(validator.is_valid(&json!({ "amount": 1000, "currency": "NGN" })));
        assert!(validator.is_valid(&json!({ "amount": "1000.50", "currency": "XLM" })));
        // Zero / negative amounts are rejected regardless of representation.
        assert!(!validator.is_valid(&json!({ "amount": 0, "currency": "NGN" })));
        assert!(!validator.is_valid(&json!({ "amount": "-5", "currency": "NGN" })));
    }

    #[test]
    fn withdraw_schema_requires_destination() {
        let validator = withdraw_validator().unwrap();
        assert!(validator
            .validate(&json!({ "amount": 500, "currency": "NGN", "destination": "bank" }))
            .is_ok());
        assert!(validator
            .validate(&json!({ "amount": 500, "currency": "NGN" }))
            .is_err());
    }

    #[test]
    fn create_match_schema_validates_player_keys() {
        let validator = create_match_validator().unwrap();
        let player_a = format!("G{}", "A".repeat(55));
        let player_b = format!("G{}", "B".repeat(55));
        assert!(validator
            .validate(&json!({
                "player_a": player_a,
                "player_b": player_b,
                "idempotency_key": "unique-key-123"
            }))
            .is_ok());
        assert!(validator
            .validate(&json!({ "player_a": "SHORT", "player_b": player_b }))
            .is_err());
    }

    #[test]
    fn record_match_schema_rejects_negative_metrics() {
        let validator = record_match_validator().unwrap();
        let match_id = "550e8400-e29b-41d4-a716-446655440000";
        assert!(validator
            .validate(&json!({
                "game_id": 1,
                "match_id": match_id,
                "duration_secs": 120,
                "wager_amount": 100,
                "reward_amount": 180,
                "player_count": 2
            }))
            .is_ok());
        assert!(validator
            .validate(&json!({
                "game_id": 1,
                "match_id": match_id,
                "duration_secs": -1,
                "wager_amount": 100,
                "reward_amount": 180,
                "player_count": 2
            }))
            .is_err());
    }

    #[test]
    fn validate_instance_is_one_off() {
        let schema = json!({ "type": "string", "minLength": 3 });
        assert!(validate_instance(&schema, &json!("abc")).is_ok());
        assert!(validate_instance(&schema, &json!(42)).is_err());
        assert!(validate_instance(&schema, &json!("ab")).is_err());
    }

    #[test]
    fn schema_error_converts_aggregate_into_validation_errors() {
        let errors = validate_instance(&json!({ "type": "integer" }), &json!("oops")).unwrap_err();
        let field_errors = errors.field_errors("instance").unwrap();
        assert_eq!(field_errors[0].code.as_ref(), "json_schema");
    }

    #[test]
    fn json_schema_error_display() {
        let err = JsonSchemaError("boom".to_string());
        assert!(err.to_string().contains("boom"));
    }
}
