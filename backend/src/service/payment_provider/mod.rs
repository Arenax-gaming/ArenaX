//! Payment provider abstraction (#1069).
//!
//! `WalletService` talks to a payment gateway only through the
//! [`PaymentProvider`] trait. Each gateway lives in its own module
//! ([`paystack`], [`flutterwave`]) and a new one is added by implementing the
//! trait in a new module and adding a [`PaymentProviderKind`] variant; the
//! wallet service itself does not change.
//!
//! The active gateway is chosen by the `PAYMENT_PROVIDER` environment
//! variable (`paystack` or `flutterwave`, default `paystack`).

pub mod flutterwave;
pub mod paystack;

use async_trait::async_trait;
use std::fmt;
use std::str::FromStr;
use std::sync::Arc;
use thiserror::Error;

pub use flutterwave::FlutterwaveProvider;
pub use paystack::PaystackProvider;

/// Environment variable that selects the active payment gateway.
pub const PAYMENT_PROVIDER_ENV: &str = "PAYMENT_PROVIDER";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PaymentError {
    #[error("unknown payment provider {0:?} (expected \"paystack\" or \"flutterwave\")")]
    UnknownProvider(String),
    #[error("{provider} does not support {operation} yet")]
    NotImplemented {
        provider: &'static str,
        operation: &'static str,
    },
    #[error("payment provider error: {0}")]
    Provider(String),
}

/// Outcome of a gateway-side payment or payout, as reported by the provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaymentStatus {
    Pending,
    Success,
    Failed,
}

/// What the gateway returns when a deposit is started.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DepositInitiation {
    /// The reference the deposit is tracked under.
    pub reference: String,
    /// Checkout page the user is sent to, when the gateway provides one.
    pub authorization_url: Option<String>,
}

/// A payment gateway. Amounts are in the currency's smallest unit (kobo for
/// NGN), matching the wallet's balance columns.
#[async_trait]
pub trait PaymentProvider: Send + Sync {
    /// Stable identifier, also the value callers send as `provider` /
    /// `payment_method` (e.g. `"paystack"`).
    fn name(&self) -> &'static str;

    async fn initiate_deposit(
        &self,
        reference: &str,
        amount: i64,
        currency: &str,
    ) -> Result<DepositInitiation, PaymentError>;

    /// Returns `true` when the gateway confirms `reference` was paid in full.
    async fn verify_deposit(
        &self,
        reference: &str,
        expected_amount: i64,
    ) -> Result<bool, PaymentError>;

    async fn initiate_withdrawal(
        &self,
        reference: &str,
        amount: i64,
        currency: &str,
        destination: &str,
    ) -> Result<PaymentStatus, PaymentError>;

    async fn check_status(&self, reference: &str) -> Result<PaymentStatus, PaymentError>;
}

/// The gateways this build knows how to construct.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaymentProviderKind {
    Paystack,
    Flutterwave,
}

impl PaymentProviderKind {
    /// Read `PAYMENT_PROVIDER`. Unset or empty means Paystack; any other
    /// unrecognised value is an error so a typo can't silently route
    /// payments through the wrong gateway.
    pub fn from_env() -> Result<Self, PaymentError> {
        match std::env::var(PAYMENT_PROVIDER_ENV) {
            Ok(value) if !value.trim().is_empty() => value.parse(),
            _ => Ok(Self::Paystack),
        }
    }

    pub fn build(self) -> Arc<dyn PaymentProvider> {
        match self {
            Self::Paystack => Arc::new(PaystackProvider::default()),
            Self::Flutterwave => Arc::new(FlutterwaveProvider::default()),
        }
    }
}

impl FromStr for PaymentProviderKind {
    type Err = PaymentError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "paystack" => Ok(Self::Paystack),
            "flutterwave" => Ok(Self::Flutterwave),
            other => Err(PaymentError::UnknownProvider(other.to_string())),
        }
    }
}

impl fmt::Display for PaymentProviderKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Paystack => "paystack",
            Self::Flutterwave => "flutterwave",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_providers_case_insensitively() {
        assert_eq!("paystack".parse(), Ok(PaymentProviderKind::Paystack));
        assert_eq!(
            " Flutterwave ".parse(),
            Ok(PaymentProviderKind::Flutterwave)
        );
    }

    #[test]
    fn rejects_unknown_provider() {
        assert_eq!(
            "stripe".parse::<PaymentProviderKind>(),
            Err(PaymentError::UnknownProvider("stripe".to_string()))
        );
    }

    #[test]
    fn built_provider_reports_its_own_name() {
        assert_eq!(PaymentProviderKind::Paystack.build().name(), "paystack");
        assert_eq!(
            PaymentProviderKind::Flutterwave.build().name(),
            "flutterwave"
        );
        assert_eq!(PaymentProviderKind::Flutterwave.to_string(), "flutterwave");
    }
}
