//! Circuit breaker implementation for fault tolerance
//! Prevents cascading failures in microservices

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

/// Circuit breaker states
#[derive(Debug, Clone, PartialEq)]
pub enum CircuitState {
    Closed,   // Normal operation
    Open,     // Failing fast
    HalfOpen, // Testing if service recovered
}

/// Circuit breaker statistics
#[derive(Debug, Clone)]
pub struct CircuitStats {
    pub total_requests: u32,
    pub failed_requests: u32,
    pub success_requests: u32,
    pub last_failure_time: u64,
    pub state: CircuitState,
}

/// Circuit breaker configuration
#[derive(Debug, Clone)]
pub struct CircuitConfig {
    pub failure_threshold: u32,
    pub recovery_timeout: Duration,
    pub request_volume_threshold: u32,
    pub success_threshold: u32,
}

impl Default for CircuitConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 5,
            recovery_timeout: Duration::from_secs(60),
            request_volume_threshold: 10,
            success_threshold: 3,
        }
    }
}

/// Circuit breaker implementation
pub struct CircuitBreaker {
    config: CircuitConfig,
    state: Arc<RwLock<CircuitState>>,
    failure_count: AtomicU32,
    success_count: AtomicU32,
    total_requests: AtomicU32,
    last_failure_time: AtomicU64,
    last_success_time: AtomicU64,
}

impl CircuitBreaker {
    pub fn new(config: CircuitConfig) -> Self {
        Self {
            config,
            state: Arc::new(RwLock::new(CircuitState::Closed)),
            failure_count: AtomicU32::new(0),
            success_count: AtomicU32::new(0),
            total_requests: AtomicU32::new(0),
            last_failure_time: AtomicU64::new(0),
            last_success_time: AtomicU64::new(0),
        }
    }

    /// Execute a function with circuit breaker protection
    pub async fn call<F, Fut, T, E>(&self, f: F) -> Result<T, CircuitBreakerError<E>>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, E>>,
    {
        // Check if circuit is open
        if !self.can_execute().await {
            return Err(CircuitBreakerError::CircuitOpen);
        }

        self.total_requests.fetch_add(1, Ordering::SeqCst);

        match f().await {
            Ok(result) => {
                self.on_success().await;
                Ok(result)
            }
            Err(e) => {
                self.on_failure().await;
                Err(CircuitBreakerError::CallFailed(e))
            }
        }
    }

    /// Check if the circuit breaker allows execution
    async fn can_execute(&self) -> bool {
        let state = self.state.read().await;
        match *state {
            CircuitState::Closed => true,
            CircuitState::Open => {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                let last_failure = self.last_failure_time.load(Ordering::SeqCst);
                
                if now - last_failure >= self.config.recovery_timeout.as_secs() {
                    drop(state);
                    let mut state = self.state.write().await;
                    *state = CircuitState::HalfOpen;
                    true
                } else {
                    false
                }
            }
            CircuitState::HalfOpen => true,
        }
    }

    /// Handle successful execution
    async fn on_success(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        self.last_success_time.store(now, Ordering::SeqCst);
        let success_count = self.success_count.fetch_add(1, Ordering::SeqCst) + 1;
        
        let state = self.state.read().await;
        if *state == CircuitState::HalfOpen {
            if success_count >= self.config.success_threshold {
                drop(state);
                let mut state = self.state.write().await;
                *state = CircuitState::Closed;
                self.reset_counts();
            }
        }
    }

    /// Handle failed execution
    async fn on_failure(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        self.last_failure_time.store(now, Ordering::SeqCst);
        let failure_count = self.failure_count.fetch_add(1, Ordering::SeqCst) + 1;
        let total_requests = self.total_requests.load(Ordering::SeqCst);
        
        let mut state = self.state.write().await;
        match *state {
            CircuitState::Closed => {
                if total_requests >= self.config.request_volume_threshold
                    && failure_count >= self.config.failure_threshold
                {
                    *state = CircuitState::Open;
                    tracing::warn!("Circuit breaker opened due to {} failures", failure_count);
                }
            }
            CircuitState::HalfOpen => {
                *state = CircuitState::Open;
                tracing::warn!("Circuit breaker reopened after failure in half-open state");
            }
            CircuitState::Open => {
                // Already open, do nothing
            }
        }
    }

    /// Reset failure and success counts
    fn reset_counts(&self) {
        self.failure_count.store(0, Ordering::SeqCst);
        self.success_count.store(0, Ordering::SeqCst);
        self.total_requests.store(0, Ordering::SeqCst);
    }

    /// Get current circuit breaker statistics
    pub async fn get_stats(&self) -> CircuitStats {
        let state = self.state.read().await;
        CircuitStats {
            total_requests: self.total_requests.load(Ordering::SeqCst),
            failed_requests: self.failure_count.load(Ordering::SeqCst),
            success_requests: self.success_count.load(Ordering::SeqCst),
            last_failure_time: self.last_failure_time.load(Ordering::SeqCst),
            state: state.clone(),
        }
    }

    /// Force circuit breaker to open state
    pub async fn force_open(&self) {
        let mut state = self.state.write().await;
        *state = CircuitState::Open;
    }

    /// Force circuit breaker to closed state
    pub async fn force_close(&self) {
        let mut state = self.state.write().await;
        *state = CircuitState::Closed;
        self.reset_counts();
    }
}

/// Circuit breaker error types
#[derive(Debug)]
pub enum CircuitBreakerError<E> {
    CircuitOpen,
    CallFailed(E),
}

impl<E: std::fmt::Display> std::fmt::Display for CircuitBreakerError<E> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CircuitBreakerError::CircuitOpen => write!(f, "Circuit breaker is open"),
            CircuitBreakerError::CallFailed(e) => write!(f, "Call failed: {}", e),
        }
    }
}

impl<E: std::error::Error> std::error::Error for CircuitBreakerError<E> {}