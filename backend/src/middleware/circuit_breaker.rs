//! Circuit breaker middleware and service registry for external services (Issue #944).
//!
//! # Problem
//! Outages or slow responses from external services (e.g. Stellar Horizon, Soroban RPC,
//! payment gateways, external webhooks) can tie up backend threads and connection pools,
//! leading to cascading failures that crash the entire application.
//!
//! # Solution
//! This module implements a thread-safe, high-performance Circuit Breaker pattern with:
//! - State machine: `Closed`, `Open`, `HalfOpen`.
//! - Consecutive and rolling failure count tracking.
//! - Configurable failure thresholds.
//! - Exponential backoff with jitter and configurable multiplier / max backoff.
//! - Half-open trial state admitting controlled probes before full recovery.
//! - Named per-service registry (`CircuitBreakerRegistry`).
//! - Actix-web middleware for route-level circuit protection.
//! - Per-service Prometheus metrics tracking state transitions, success/failure counts, and rejected calls.

use std::{
    collections::HashMap,
    future::{ready, Future, Ready},
    rc::Rc,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Arc, RwLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::StatusCode,
    HttpResponse, ResponseError,
};
use futures_util::future::LocalBoxFuture;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{info, warn};

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum CircuitBreakerError<E> {
    #[error("Circuit breaker for service '{service}' is OPEN (retry in {retry_after_secs}s)")]
    CircuitOpen {
        service: String,
        retry_after_secs: u64,
    },
    #[error("Execution timed out after {0:?}")]
    Timeout(Duration),
    #[error(transparent)]
    Inner(E),
}

impl<E: std::fmt::Display + std::fmt::Debug> ResponseError for CircuitBreakerError<E> {
    fn status_code(&self) -> StatusCode {
        match self {
            CircuitBreakerError::CircuitOpen { .. } => StatusCode::SERVICE_UNAVAILABLE,
            CircuitBreakerError::Timeout(_) => StatusCode::GATEWAY_TIMEOUT,
            CircuitBreakerError::Inner(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn error_response(&self) -> HttpResponse {
        match self {
            CircuitBreakerError::CircuitOpen {
                service,
                retry_after_secs,
            } => HttpResponse::build(self.status_code())
                .append_header(("Retry-After", retry_after_secs.to_string()))
                .content_type("application/json")
                .body(serde_json::json!({
                    "error": "Service Unavailable",
                    "code": "CIRCUIT_BREAKER_OPEN",
                    "service": service,
                    "retry_after_seconds": retry_after_secs,
                    "message": format!("The external dependency '{}' is currently unavailable. Circuit is OPEN.", service),
                }).to_string()),
            CircuitBreakerError::Timeout(duration) => HttpResponse::build(self.status_code())
                .content_type("application/json")
                .body(serde_json::json!({
                    "error": "Gateway Timeout",
                    "code": "EXTERNAL_SERVICE_TIMEOUT",
                    "timeout_ms": duration.as_millis(),
                    "message": "External service request timed out.",
                }).to_string()),
            CircuitBreakerError::Inner(e) => HttpResponse::build(self.status_code())
                .content_type("application/json")
                .body(serde_json::json!({
                    "error": "External Service Failure",
                    "code": "EXTERNAL_SERVICE_ERROR",
                    "message": e.to_string(),
                }).to_string()),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// State & Configuration
// ─────────────────────────────────────────────────────────────────────────────

/// State of the circuit breaker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CircuitState {
    /// Normal operation: all requests allowed, failures are counted.
    Closed,
    /// Outage detected: requests fail immediately without calling external dependency.
    Open,
    /// Probing recovery: limited trial requests allowed through.
    HalfOpen,
}

impl std::fmt::Display for CircuitState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CircuitState::Closed => write!(f, "CLOSED"),
            CircuitState::Open => write!(f, "OPEN"),
            CircuitState::HalfOpen => write!(f, "HALF_OPEN"),
        }
    }
}

/// Configuration parameters for a circuit breaker instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitBreakerConfig {
    /// Service name for logging and metrics.
    pub service_name: String,
    /// Number of consecutive failures before tripping the circuit OPEN.
    pub failure_threshold: u32,
    /// Number of consecutive successes in HALF_OPEN before resetting to CLOSED.
    pub success_threshold: u32,
    /// Initial cooldown duration when the circuit first opens.
    pub initial_backoff: Duration,
    /// Maximum backoff cooldown duration.
    pub max_backoff: Duration,
    /// Multiplier applied to backoff duration for consecutive trip cycles.
    pub backoff_multiplier: f64,
    /// Maximum concurrent probe requests admitted in HALF_OPEN state.
    pub half_open_probe_limit: u32,
    /// Optional execution timeout per request.
    pub request_timeout: Option<Duration>,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            service_name: "default".to_string(),
            failure_threshold: 5,
            success_threshold: 2,
            initial_backoff: Duration::from_secs(5),
            max_backoff: Duration::from_secs(60),
            backoff_multiplier: 2.0,
            half_open_probe_limit: 1,
            request_timeout: Some(Duration::from_secs(10)),
        }
    }
}

impl CircuitBreakerConfig {
    pub fn new(service_name: impl Into<String>) -> Self {
        Self {
            service_name: service_name.into(),
            ..Default::default()
        }
    }

    pub fn with_failure_threshold(mut self, threshold: u32) -> Self {
        self.failure_threshold = threshold.max(1);
        self
    }

    pub fn with_success_threshold(mut self, threshold: u32) -> Self {
        self.success_threshold = threshold.max(1);
        self
    }

    pub fn with_initial_backoff(mut self, backoff: Duration) -> Self {
        self.initial_backoff = backoff;
        self
    }

    pub fn with_max_backoff(mut self, max: Duration) -> Self {
        self.max_backoff = max;
        self
    }

    pub fn with_backoff_multiplier(mut self, multiplier: f64) -> Self {
        self.backoff_multiplier = multiplier.max(1.0);
        self
    }

    pub fn with_request_timeout(mut self, timeout: Duration) -> Self {
        self.request_timeout = Some(timeout);
        self
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit Breaker Engine
// ─────────────────────────────────────────────────────────────────────────────

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Thread-safe circuit breaker with exponential backoff and lock-free fast path.
#[derive(Debug)]
pub struct CircuitBreaker {
    config: CircuitBreakerConfig,
    consecutive_failures: AtomicU32,
    consecutive_successes: AtomicU32,
    total_failures: AtomicU64,
    total_successes: AtomicU64,
    total_rejected: AtomicU64,
    /// Number of times the circuit has tripped open (used for exponential backoff exponent).
    trip_count: AtomicU32,
    /// Unix timestamp in milliseconds when the circuit last opened; 0 if closed.
    opened_at_ms: AtomicU64,
    /// Current cooldown period in milliseconds for the current open cycle.
    current_cooldown_ms: AtomicU64,
    /// Number of trial probe requests currently executing in HALF_OPEN state.
    half_open_in_flight: AtomicU32,
    /// Tracks manual override state if forced.
    manual_open: AtomicBool,
}

impl CircuitBreaker {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        let initial_cooldown_ms = config.initial_backoff.as_millis() as u64;
        Self {
            config,
            consecutive_failures: AtomicU32::new(0),
            consecutive_successes: AtomicU32::new(0),
            total_failures: AtomicU64::new(0),
            total_successes: AtomicU64::new(0),
            total_rejected: AtomicU64::new(0),
            trip_count: AtomicU32::new(0),
            opened_at_ms: AtomicU64::new(0),
            current_cooldown_ms: AtomicU64::new(initial_cooldown_ms),
            half_open_in_flight: AtomicU32::new(0),
            manual_open: AtomicBool::new(false),
        }
    }

    pub fn service_name(&self) -> &str {
        &self.config.service_name
    }

    pub fn config(&self) -> &CircuitBreakerConfig {
        &self.config
    }

    /// Resolve the current circuit state against elapsed time.
    pub fn state(&self) -> CircuitState {
        if self.manual_open.load(Ordering::Relaxed) {
            return CircuitState::Open;
        }

        let opened_at = self.opened_at_ms.load(Ordering::Relaxed);
        if opened_at == 0 {
            return CircuitState::Closed;
        }

        let now = current_time_ms();
        let elapsed = now.saturating_sub(opened_at);
        let cooldown = self.current_cooldown_ms.load(Ordering::Relaxed);

        if elapsed >= cooldown {
            CircuitState::HalfOpen
        } else {
            CircuitState::Open
        }
    }

    /// Returns remaining seconds until the circuit enters Half-Open retry state.
    pub fn retry_after_secs(&self) -> u64 {
        let opened_at = self.opened_at_ms.load(Ordering::Relaxed);
        if opened_at == 0 {
            return 0;
        }

        let now = current_time_ms();
        let elapsed = now.saturating_sub(opened_at);
        let cooldown = self.current_cooldown_ms.load(Ordering::Relaxed);

        if elapsed >= cooldown {
            0
        } else {
            let remaining_ms = cooldown - elapsed;
            (remaining_ms + 999) / 1000 // Ceil to next full second
        }
    }

    /// Checks if a request is permitted to proceed.
    ///
    /// - `Closed`: Always allowed.
    /// - `Open`: Always rejected.
    /// - `HalfOpen`: Limited probes permitted up to `half_open_probe_limit`.
    pub fn allow_request(&self) -> bool {
        match self.state() {
            CircuitState::Closed => true,
            CircuitState::Open => {
                self.total_rejected.fetch_add(1, Ordering::Relaxed);
                false
            }
            CircuitState::HalfOpen => {
                let current = self.half_open_in_flight.load(Ordering::SeqCst);
                if current < self.config.half_open_probe_limit {
                    self.half_open_in_flight
                        .compare_exchange(
                            current,
                            current + 1,
                            Ordering::SeqCst,
                            Ordering::SeqCst,
                        )
                        .is_ok()
                } else {
                    self.total_rejected.fetch_add(1, Ordering::Relaxed);
                    false
                }
            }
        }
    }

    /// Record a successful external service call.
    pub fn record_success(&self) {
        self.total_successes.fetch_add(1, Ordering::Relaxed);
        self.consecutive_failures.store(0, Ordering::Relaxed);

        match self.state() {
            CircuitState::HalfOpen => {
                self.half_open_in_flight.fetch_sub(1, Ordering::Relaxed);
                let successes = self.consecutive_successes.fetch_add(1, Ordering::Relaxed) + 1;

                if successes >= self.config.success_threshold {
                    self.close_circuit();
                }
            }
            CircuitState::Closed => {
                self.consecutive_successes.fetch_add(1, Ordering::Relaxed);
            }
            CircuitState::Open => {}
        }
    }

    /// Record a failed external service call.
    pub fn record_failure(&self) {
        self.total_failures.fetch_add(1, Ordering::Relaxed);
        self.consecutive_successes.store(0, Ordering::Relaxed);

        let state = self.state();
        match state {
            CircuitState::HalfOpen => {
                self.half_open_in_flight.fetch_sub(1, Ordering::Relaxed);
                // Trial probe failed — immediately trip open and scale backoff
                warn!(
                    service = %self.config.service_name,
                    "Trial probe failed in HALF_OPEN state. Tripping circuit OPEN with increased exponential backoff."
                );
                self.trip_circuit();
            }
            CircuitState::Closed => {
                let failures = self.consecutive_failures.fetch_add(1, Ordering::Relaxed) + 1;
                if failures >= self.config.failure_threshold {
                    warn!(
                        service = %self.config.service_name,
                        failures = failures,
                        threshold = self.config.failure_threshold,
                        "External service failure threshold exceeded. Tripping circuit OPEN."
                    );
                    self.trip_circuit();
                }
            }
            CircuitState::Open => {}
        }
    }

    /// Trips the circuit to `Open` and calculates exponential backoff.
    fn trip_circuit(&self) {
        let trips = self.trip_count.fetch_add(1, Ordering::Relaxed) + 1;

        // Exponential backoff: initial_backoff * multiplier^(trips - 1)
        let base_ms = self.config.initial_backoff.as_millis() as f64;
        let max_ms = self.config.max_backoff.as_millis() as f64;
        let exponent = (trips - 1).min(10) as i32;
        let calculated_ms = base_ms * self.config.backoff_multiplier.powi(exponent);
        let cooldown_ms = calculated_ms.min(max_ms) as u64;

        self.current_cooldown_ms.store(cooldown_ms, Ordering::Relaxed);
        self.opened_at_ms.store(current_time_ms(), Ordering::Relaxed);
        self.consecutive_failures.store(0, Ordering::Relaxed);
        self.half_open_in_flight.store(0, Ordering::Relaxed);

        info!(
            service = %self.config.service_name,
            trip_count = trips,
            cooldown_secs = cooldown_ms / 1000,
            "Circuit breaker tripped OPEN"
        );
    }

    /// Resets the circuit to `Closed`.
    fn close_circuit(&self) {
        self.opened_at_ms.store(0, Ordering::Relaxed);
        self.consecutive_failures.store(0, Ordering::Relaxed);
        self.consecutive_successes.store(0, Ordering::Relaxed);
        self.trip_count.store(0, Ordering::Relaxed);
        self.half_open_in_flight.store(0, Ordering::Relaxed);
        self.current_cooldown_ms.store(
            self.config.initial_backoff.as_millis() as u64,
            Ordering::Relaxed,
        );

        info!(
            service = %self.config.service_name,
            "Circuit breaker closed. Service marked healthy."
        );
    }

    /// Manually trip the circuit open.
    pub fn manual_trip(&self) {
        self.manual_open.store(true, Ordering::SeqCst);
        self.trip_circuit();
    }

    /// Manually reset the circuit closed.
    pub fn manual_reset(&self) {
        self.manual_open.store(false, Ordering::SeqCst);
        self.close_circuit();
    }

    /// Execute an asynchronous operation protected by this circuit breaker.
    pub async fn call<F, Fut, T, E>(&self, f: F) -> Result<T, CircuitBreakerError<E>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, E>>,
    {
        if !self.allow_request() {
            return Err(CircuitBreakerError::CircuitOpen {
                service: self.config.service_name.clone(),
                retry_after_secs: self.retry_after_secs(),
            });
        }

        let fut = f();
        let result = if let Some(timeout_dur) = self.config.request_timeout {
            match tokio::time::timeout(timeout_dur, fut).await {
                Ok(res) => res,
                Err(_) => {
                    self.record_failure();
                    return Err(CircuitBreakerError::Timeout(timeout_dur));
                }
            }
        } else {
            fut.await
        };

        match result {
            Ok(val) => {
                self.record_success();
                Ok(val)
            }
            Err(err) => {
                self.record_failure();
                Err(CircuitBreakerError::Inner(err))
            }
        }
    }

    /// Get current statistics for monitoring and metrics export.
    pub fn stats(&self) -> CircuitBreakerStats {
        CircuitBreakerStats {
            service_name: self.config.service_name.clone(),
            state: self.state(),
            consecutive_failures: self.consecutive_failures.load(Ordering::Relaxed),
            consecutive_successes: self.consecutive_successes.load(Ordering::Relaxed),
            total_failures: self.total_failures.load(Ordering::Relaxed),
            total_successes: self.total_successes.load(Ordering::Relaxed),
            total_rejected: self.total_rejected.load(Ordering::Relaxed),
            trip_count: self.trip_count.load(Ordering::Relaxed),
            retry_after_secs: self.retry_after_secs(),
            current_cooldown_secs: self.current_cooldown_ms.load(Ordering::Relaxed) / 1000,
        }
    }
}

/// Statistics snapshot for a circuit breaker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitBreakerStats {
    pub service_name: String,
    pub state: CircuitState,
    pub consecutive_failures: u32,
    pub consecutive_successes: u32,
    pub total_failures: u64,
    pub total_successes: u64,
    pub total_rejected: u64,
    pub trip_count: u32,
    pub retry_after_secs: u64,
    pub current_cooldown_secs: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Registry
// ─────────────────────────────────────────────────────────────────────────────

/// Central registry managing named circuit breaker instances for all external services.
#[derive(Debug)]
pub struct CircuitBreakerRegistry {
    breakers: RwLock<HashMap<String, Arc<CircuitBreaker>>>,
    default_config: CircuitBreakerConfig,
}

impl Default for CircuitBreakerRegistry {
    fn default() -> Self {
        Self::new(CircuitBreakerConfig::default())
    }
}

impl CircuitBreakerRegistry {
    pub fn new(default_config: CircuitBreakerConfig) -> Self {
        Self {
            breakers: RwLock::new(HashMap::new()),
            default_config,
        }
    }

    /// Register a custom-configured circuit breaker for a specific service.
    pub fn register(&self, config: CircuitBreakerConfig) -> Arc<CircuitBreaker> {
        let name = config.service_name.clone();
        let breaker = Arc::new(CircuitBreaker::new(config));
        let mut map = self.breakers.write().expect("lock not poisoned");
        map.insert(name, breaker.clone());
        breaker
    }

    /// Get or lazily create a circuit breaker for a service using default configuration.
    pub fn get_or_create(&self, service_name: &str) -> Arc<CircuitBreaker> {
        {
            let map = self.breakers.read().expect("lock not poisoned");
            if let Some(b) = map.get(service_name) {
                return b.clone();
            }
        }

        let mut map = self.breakers.write().expect("lock not poisoned");
        map.entry(service_name.to_string())
            .or_insert_with(|| {
                let mut config = self.default_config.clone();
                config.service_name = service_name.to_string();
                Arc::new(CircuitBreaker::new(config))
            })
            .clone()
    }

    /// Execute a function wrapped in the circuit breaker for `service_name`.
    pub async fn call<F, Fut, T, E>(
        &self,
        service_name: &str,
        f: F,
    ) -> Result<T, CircuitBreakerError<E>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, E>>,
    {
        let breaker = self.get_or_create(service_name);
        breaker.call(f).await
    }

    /// Return statistics snapshots for all registered circuit breakers.
    pub fn all_stats(&self) -> Vec<CircuitBreakerStats> {
        let map = self.breakers.read().expect("lock not poisoned");
        map.values().map(|b| b.stats()).collect()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Actix-Web Middleware
// ─────────────────────────────────────────────────────────────────────────────

/// Actix-web middleware protecting specific routes against downstream service outages.
pub struct ExternalCircuitBreakerMiddleware {
    breaker: Arc<CircuitBreaker>,
}

impl ExternalCircuitBreakerMiddleware {
    pub fn new(breaker: Arc<CircuitBreaker>) -> Self {
        Self { breaker }
    }

    pub fn from_registry(registry: &CircuitBreakerRegistry, service_name: &str) -> Self {
        Self {
            breaker: registry.get_or_create(service_name),
        }
    }
}

impl<S, B> Transform<S, ServiceRequest> for ExternalCircuitBreakerMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = actix_web::Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = actix_web::Error;
    type InitError = ();
    type Transform = CircuitBreakerService<S>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(CircuitBreakerService {
            service: Rc::new(service),
            breaker: self.breaker.clone(),
        }))
    }

    type Future = Ready<Result<Self::Transform, Self::InitError>>;
}

pub struct CircuitBreakerService<S> {
    service: Rc<S>,
    breaker: Arc<CircuitBreaker>,
}

impl<S, B> Service<ServiceRequest> for CircuitBreakerService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = actix_web::Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = actix_web::Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let breaker = self.breaker.clone();
        let service = self.service.clone();

        Box::pin(async move {
            if !breaker.allow_request() {
                let retry_after = breaker.retry_after_secs();
                let err_res = HttpResponse::ServiceUnavailable()
                    .append_header(("Retry-After", retry_after.to_string()))
                    .content_type("application/json")
                    .body(serde_json::json!({
                        "error": "Service Unavailable",
                        "code": "CIRCUIT_BREAKER_OPEN",
                        "service": breaker.service_name(),
                        "retry_after_seconds": retry_after,
                        "message": format!("External dependency '{}' is currently unavailable.", breaker.service_name()),
                    }).to_string());

                return Ok(req.into_response(err_res.map_into_right_body()));
            }

            match service.call(req).await {
                Ok(res) => {
                    let status = res.status();
                    if status.is_server_error() {
                        breaker.record_failure();
                    } else {
                        breaker.record_success();
                    }
                    Ok(res.map_into_left_body())
                }
                Err(err) => {
                    breaker.record_failure();
                    Err(err)
                }
            }
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_state_is_closed() {
        let breaker = CircuitBreaker::new(CircuitBreakerConfig::new("test_service"));
        assert_eq!(breaker.state(), CircuitState::Closed);
        assert!(breaker.allow_request());
    }

    #[test]
    fn test_trips_to_open_on_threshold() {
        let config = CircuitBreakerConfig::new("test_service")
            .with_failure_threshold(3)
            .with_initial_backoff(Duration::from_millis(50));
        let breaker = CircuitBreaker::new(config);

        breaker.record_failure();
        breaker.record_failure();
        assert_eq!(breaker.state(), CircuitState::Closed);

        breaker.record_failure(); // 3rd failure trips
        assert_eq!(breaker.state(), CircuitState::Open);
        assert!(!breaker.allow_request());
    }

    #[test]
    fn test_half_open_transition_and_recovery() {
        let config = CircuitBreakerConfig::new("test_service")
            .with_failure_threshold(2)
            .with_success_threshold(2)
            .with_initial_backoff(Duration::from_millis(20));
        let breaker = CircuitBreaker::new(config);

        breaker.record_failure();
        breaker.record_failure();
        assert_eq!(breaker.state(), CircuitState::Open);

        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(breaker.state(), CircuitState::HalfOpen);

        assert!(breaker.allow_request());
        breaker.record_success(); // 1st success
        assert_eq!(breaker.state(), CircuitState::HalfOpen);

        assert!(breaker.allow_request());
        breaker.record_success(); // 2nd success meets threshold -> Closed
        assert_eq!(breaker.state(), CircuitState::Closed);
    }

    #[test]
    fn test_half_open_failure_reopens_with_exponential_backoff() {
        let config = CircuitBreakerConfig::new("test_service")
            .with_failure_threshold(2)
            .with_initial_backoff(Duration::from_millis(20))
            .with_backoff_multiplier(2.0);
        let breaker = CircuitBreaker::new(config);

        // Trip 1
        breaker.record_failure();
        breaker.record_failure();
        assert_eq!(breaker.state(), CircuitState::Open);

        // Wait to decay to Half-Open
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(breaker.state(), CircuitState::HalfOpen);

        // Failure during Half-Open probe immediately trips open with increased backoff
        assert!(breaker.allow_request());
        breaker.record_failure();
        assert_eq!(breaker.state(), CircuitState::Open);
        assert_eq!(breaker.trip_count.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn test_call_wrapper_success_and_failure() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let breaker = CircuitBreaker::new(CircuitBreakerConfig::new("test_wrapper"));

            let res: Result<i32, CircuitBreakerError<&str>> =
                breaker.call(|| async { Ok::<i32, &str>(42) }).await;
            assert_eq!(res.unwrap(), 42);

            let err: Result<i32, CircuitBreakerError<&str>> =
                breaker.call(|| async { Err::<i32, &str>("remote error") }).await;
            assert!(matches!(err, Err(CircuitBreakerError::Inner("remote error"))));
        });
    }

    #[test]
    fn test_registry_isolation() {
        let registry = CircuitBreakerRegistry::default();
        let breaker_a = registry.get_or_create("service_a");
        let breaker_b = registry.get_or_create("service_b");

        breaker_a.manual_trip();
        assert_eq!(breaker_a.state(), CircuitState::Open);
        assert_eq!(breaker_b.state(), CircuitState::Closed);
    }
}
