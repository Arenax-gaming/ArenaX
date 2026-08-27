//! Async validation support.
//!
//! The `validator` crate only supports synchronous validation, but several
//! checks need I/O — username/email uniqueness against the database, verifying
//! a Stellar address on the network, etc. This module provides:
//!
//! - [`AsyncValidator`] — a type-safe trait whose `validate_async` returns a
//!   boxed future. It is blanket-implemented for every sync [`Validator`], so
//!   derive-based DTOs get async validation for free.
//! - [`AsyncRule`] / [`AsyncValidatorSet`] — reusable async rules (e.g.
//!   "username is unique") that can be composed and run concurrently against a
//!   payload.
//!
//! # Example
//!
//! ```ignore
//! use crate::validators::async_validator::{AsyncRule, AsyncValidatorSet};
//! use validator::ValidationError;
//!
//! let unique_username = AsyncRule::new("username", {
//!     let db = db_pool.clone();
//!     Box::new(move |input: &RegisterInput| {
//!         let db = db.clone();
//!         Box::pin(async move {
//!             if username_exists(&db, &input.username).await {
//!                 Err(ValidationError::new("unique"))
//!             } else {
//!                 Ok(())
//!             }
//!         })
//!     })
//! });
//!
//! let set = AsyncValidatorSet::new(vec![unique_username]);
//! set.validate(&input).await?;
//! ```

use std::future::Future;
use std::pin::Pin;

use validator::{ValidationError, ValidationErrors};

use crate::validators::Validator;

/// A boxed, `Send` future — the return type of async validation methods.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Type-safe async validator.
///
/// Every sync [`Validator`] automatically implements this trait (see the
/// blanket impl below), so any DTO that derives `validator::Validate` can be
/// validated asynchronously:
///
/// ```ignore
/// DeriveValidator::<RegisterInput>::new().validate_async(&input).await?;
/// ```
pub trait AsyncValidator<T>: Sync {
    /// Validate `value` asynchronously, returning aggregated field errors.
    fn validate_async<'a>(&'a self, value: &'a T) -> BoxFuture<'a, Result<(), ValidationErrors>>;
}

impl<T, V> AsyncValidator<T> for V
where
    V: Validator<T> + Sync,
    T: Sync,
{
    fn validate_async<'a>(&'a self, value: &'a T) -> BoxFuture<'a, Result<(), ValidationErrors>> {
        Box::pin(async move { self.validate(value) })
    }
}

/// A single asynchronous check attached to a field.
///
/// The check receives the whole payload and returns a field-level error. This
/// keeps rules reusable and composable while still being able to perform I/O.
pub struct AsyncRule<T> {
    field: &'static str,
    check: AsyncCheck<T>,
}

/// Boxed async check: `Fn(&T) -> BoxFuture<Result<(), ValidationError>>`.
pub type AsyncCheck<T> = Box<
    dyn for<'a> Fn(&'a T) -> BoxFuture<'a, Result<(), ValidationError>> + Send + Sync,
>;

impl<T> AsyncRule<T> {
    /// Create a new async rule for `field`.
    pub fn new(field: &'static str, check: AsyncCheck<T>) -> Self {
        Self { field, check }
    }

    /// The field this rule reports errors against.
    pub fn field(&self) -> &'static str {
        self.field
    }
}

/// A collection of async rules that run concurrently and aggregate errors.
pub struct AsyncValidatorSet<T> {
    rules: Vec<AsyncRule<T>>,
}

impl<T> Default for AsyncValidatorSet<T> {
    fn default() -> Self {
        Self::new(Vec::new())
    }
}

impl<T> AsyncValidatorSet<T> {
    /// Create a set from the given rules.
    pub fn new(rules: Vec<AsyncRule<T>>) -> Self {
        Self { rules }
    }

    /// Append a rule (builder style).
    pub fn with_rule(mut self, rule: AsyncRule<T>) -> Self {
        self.rules.push(rule);
        self
    }

    /// Number of rules in the set.
    pub fn len(&self) -> usize {
        self.rules.len()
    }

    /// Whether the set has no rules.
    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    /// Run every rule concurrently and aggregate the errors by field.
    pub async fn validate(&self, value: &T) -> Result<(), ValidationErrors> {
        let results = futures::future::join_all(self.rules.iter().map(|rule| {
            let field = rule.field;
            let future = (rule.check)(value);
            async move { (field, future.await) }
        }))
        .await;

        let mut errors = ValidationErrors::new();
        for (field, result) in results {
            if let Err(error) = result {
                errors.add(field, error);
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[derive(Debug, validator::Validate)]
    struct RegisterInput {
        #[validate(length(min = 3, max = 32))]
        username: String,
        #[validate(email)]
        email: String,
    }

    fn unique_username_rule(taken: HashSet<String>) -> AsyncRule<RegisterInput> {
        AsyncRule::new("username", {
            Box::new(move |input: &RegisterInput| {
                let taken = taken.clone();
                Box::pin(async move {
                    if taken.contains(&input.username) {
                        Err(ValidationError::new("unique"))
                    } else {
                        Ok(())
                    }
                })
            })
        })
    }

    #[tokio::test]
    async fn async_rules_aggregate_errors_by_field() {
        let taken = HashSet::from(["taken_user".to_string()]);
        let set = AsyncValidatorSet::new(vec![unique_username_rule(taken)]);

        let bad = RegisterInput {
            username: "taken_user".to_string(),
            email: "player@example.com".to_string(),
        };
        let errors = set.validate(&bad).await.unwrap_err();
        let field_errors = errors.field_errors("username").expect("username rule ran");
        assert_eq!(field_errors[0].code.as_ref(), "unique");

        let ok = RegisterInput {
            username: "free_user".to_string(),
            email: "player@example.com".to_string(),
        };
        assert!(set.validate(&ok).await.is_ok());
    }

    #[tokio::test]
    async fn multiple_rules_run_concurrently() {
        let taken = HashSet::from(["taken_user".to_string()]);
        let set = AsyncValidatorSet::new(vec![
            unique_username_rule(taken),
            AsyncRule::new("email", {
                Box::new(|input: &RegisterInput| {
                    Box::pin(async move {
                        if input.email.starts_with("banned@") {
                            Err(ValidationError::new("unique"))
                        } else {
                            Ok(())
                        }
                    })
                })
            }),
        ]);

        let bad = RegisterInput {
            username: "taken_user".to_string(),
            email: "banned@example.com".to_string(),
        };
        let errors = set.validate(&bad).await.unwrap_err();
        assert!(errors.field_errors("username").is_some());
        assert!(errors.field_errors("email").is_some());
    }

    #[tokio::test]
    async fn builder_style_rules() {
        let taken = HashSet::new();
        let set = AsyncValidatorSet::default().with_rule(unique_username_rule(taken));
        assert_eq!(set.len(), 1);
        assert!(!set.is_empty());

        let ok = RegisterInput {
            username: "player_one".to_string(),
            email: "player@example.com".to_string(),
        };
        assert!(set.validate(&ok).await.is_ok());
    }

    #[tokio::test]
    async fn sync_validators_get_async_support() {
        // DeriveValidator<RegisterInput> implements Validator, so it gets
        // validate_async for free via the blanket impl.
        let validator = crate::validators::DeriveValidator::<RegisterInput>::new();

        let ok = RegisterInput {
            username: "player_one".to_string(),
            email: "player@example.com".to_string(),
        };
        assert!(validator.validate_async(&ok).await.is_ok());

        let bad = RegisterInput {
            username: "ab".to_string(),
            email: "nope".to_string(),
        };
        assert!(validator.validate_async(&bad).await.is_err());
    }
}
