//! Database pool with a circuit breaker (Issue #861).
//!
//! Connection failures used to cascade: every handler queued on a pool that
//! could not connect, each waiting out its own timeout, until the whole backend
//! was tied up waiting on a database that was not coming back. The fix is to
//! stop asking. A breaker in front of the pool fails fast while the database is
//! unhealthy, so callers get an immediate 503 instead of a slow timeout and the
//! service keeps serving everything that does not need the database.
//!
//! States:
//!
//! - **Closed** — normal. Failures are counted; `circuit_failure_threshold`
//!   consecutive ones trip it.
//! - **Open** — every acquire is refused immediately with 503, for
//!   `circuit_open_secs`.
//! - **HalfOpen** — one trial request is admitted. It closes the breaker if it
//!   succeeds and reopens it if it does not, so recovery needs no operator.
//!
//! A background probe runs every `health_check_interval_secs` so the breaker
//! notices recovery on its own rather than waiting for user traffic to discover
//! it.

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::api_error::ApiError;
use crate::config::{Config, DatabaseConfig, MigrationMode};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::{info, warn};

pub type DbPool = PgPool;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Circuit breaker state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

/// Failure counter and state for the database circuit breaker.
///
/// Held behind atomics rather than a mutex: every request touches this on the
/// hot path, and a lock here would be the contention point the breaker exists
/// to avoid.
#[derive(Debug)]
pub struct DbCircuitBreaker {
    consecutive_failures: AtomicU32,
    /// Unix millis when the breaker opened; 0 when closed.
    opened_at_ms: AtomicU64,
    /// Set while a half-open trial is in flight, so only one request probes.
    trial_in_flight: AtomicU32,
    failure_threshold: u32,
    open_duration: Duration,
    acquire_timeout: Duration,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl DbCircuitBreaker {
    pub fn new(config: &DatabaseConfig) -> Self {
        Self {
            consecutive_failures: AtomicU32::new(0),
            opened_at_ms: AtomicU64::new(0),
            trial_in_flight: AtomicU32::new(0),
            failure_threshold: config.circuit_failure_threshold.max(1),
            open_duration: Duration::from_secs(config.circuit_open_secs),
            acquire_timeout: Duration::from_secs(config.acquire_timeout_secs),
        }
    }

    /// Current state, resolved against the clock.
    ///
    /// Open decays into HalfOpen once the cooldown has elapsed; there is no
    /// timer to fire and nothing to schedule, so the breaker cannot get stuck
    /// open because a task died.
    pub fn state(&self) -> CircuitState {
        let opened = self.opened_at_ms.load(Ordering::Relaxed);
        if opened == 0 {
            return CircuitState::Closed;
        }
        if now_ms().saturating_sub(opened) >= self.open_duration.as_millis() as u64 {
            CircuitState::HalfOpen
        } else {
            CircuitState::Open
        }
    }

    /// Record a successful database interaction: close the breaker.
    pub fn record_success(&self) {
        self.consecutive_failures.store(0, Ordering::Relaxed);
        self.opened_at_ms.store(0, Ordering::Relaxed);
        self.trial_in_flight.store(0, Ordering::Relaxed);
    }

    /// Record a failure, tripping the breaker once the threshold is reached.
    pub fn record_failure(&self) {
        self.trial_in_flight.store(0, Ordering::Relaxed);
        let failures = self.consecutive_failures.fetch_add(1, Ordering::Relaxed) + 1;

        // A failure during a half-open trial reopens immediately: the trial was
        // the evidence, and it says the database is still unwell.
        if failures >= self.failure_threshold || self.state() == CircuitState::HalfOpen {
            let was_open = self.opened_at_ms.swap(now_ms(), Ordering::Relaxed) != 0;
            if !was_open {
                warn!(
                    failures,
                    threshold = self.failure_threshold,
                    "Database circuit breaker opened — failing fast until it recovers"
                );
            }
        }
    }

    /// May a request proceed to the pool?
    ///
    /// In half-open only the first caller is admitted; the rest are refused so a
    /// recovering database is probed by one request, not by the whole backlog.
    pub fn allows_request(&self) -> bool {
        match self.state() {
            CircuitState::Closed => true,
            CircuitState::Open => false,
            CircuitState::HalfOpen => {
                self.trial_in_flight
                    .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
            }
        }
    }

    pub fn consecutive_failures(&self) -> u32 {
        self.consecutive_failures.load(Ordering::Relaxed)
    }

    pub fn acquire_timeout(&self) -> Duration {
        self.acquire_timeout
    }
}

/// A pool paired with the breaker guarding it.
#[derive(Clone)]
pub struct GuardedPool {
    pub pool: DbPool,
    pub breaker: Arc<DbCircuitBreaker>,
}

impl GuardedPool {
    pub fn new(pool: DbPool, breaker: Arc<DbCircuitBreaker>) -> Self {
        Self { pool, breaker }
    }

    /// Borrow the pool, refusing immediately while the breaker is open.
    ///
    /// # Errors
    ///
    /// [`ApiError::ServiceUnavailable`] (HTTP 503) while the breaker is open,
    /// or when acquiring exceeds `acquire_timeout_secs`.
    pub async fn acquire(&self) -> Result<sqlx::pool::PoolConnection<sqlx::Postgres>, ApiError> {
        if !self.breaker.allows_request() {
            return Err(ApiError::ServiceUnavailable(
                "database temporarily unavailable".to_string(),
            ));
        }

        match tokio::time::timeout(self.breaker.acquire_timeout(), self.pool.acquire()).await {
            Ok(Ok(conn)) => {
                self.breaker.record_success();
                Ok(conn)
            }
            Ok(Err(err)) => {
                self.breaker.record_failure();
                Err(ApiError::DatabaseError(err))
            }
            Err(_elapsed) => {
                // A timeout is the signal that matters: the pool is saturated or
                // the database is gone, and either way waiting longer does not
                // help the caller.
                self.breaker.record_failure();
                Err(ApiError::ServiceUnavailable(format!(
                    "database did not respond within {}s",
                    self.breaker.acquire_timeout().as_secs()
                )))
            }
        }
    }

    pub fn state(&self) -> CircuitState {
        self.breaker.state()
    }
}

pub async fn create_pool(config: &Config) -> Result<DbPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(config.database.max_connections)
        .acquire_timeout(Duration::from_secs(config.database.acquire_timeout_secs))
        .test_before_acquire(true)
        .connect(&config.database.url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}

/// Build a pool with its circuit breaker attached.
pub async fn create_guarded_pool(config: &Config) -> Result<GuardedPool, sqlx::Error> {
    let pool = create_pool(config).await?;
    let breaker = Arc::new(DbCircuitBreaker::new(&config.database));
    Ok(GuardedPool::new(pool, breaker))
}

/// Probe the pool periodically so recovery is noticed without user traffic.
///
/// Returns the spawned task handle so a caller can shut it down; dropping it
/// detaches the probe, which is fine for a process-lifetime pool.
pub fn spawn_health_checks(guarded: GuardedPool, interval: Duration) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        loop {
            ticker.tick().await;

            match health_check(&guarded.pool).await {
                Ok(()) => {
                    if guarded.breaker.state() != CircuitState::Closed {
                        info!("Database health probe succeeded — closing circuit breaker");
                    }
                    guarded.breaker.record_success();
                }
                Err(err) => {
                    warn!(error = %err, "Database health probe failed");
                    guarded.breaker.record_failure();
                }
            }
        }
    })
}

/// Interval configured for the background probe.
pub fn health_check_interval(config: &Config) -> Duration {
    Duration::from_secs(config.database.health_check_interval_secs)
}

pub async fn health_check(pool: &DbPool) -> Result<(), ApiError> {
    sqlx::query("SELECT 1")
        .execute(pool)
        .await
        .map_err(ApiError::DatabaseError)?;
    Ok(())
}

pub async fn run_startup_migrations(
    config: &Config,
    pool: &DbPool,
) -> Result<(), sqlx::migrate::MigrateError> {
    match config.database.migration_mode {
        MigrationMode::Run => {
            info!("Running database migrations before backend startup");
            MIGRATOR.run(pool).await?;
            info!("Database migrations are up to date");
        }
        MigrationMode::Disabled => {
            info!("Skipping database migrations because BACKEND_MIGRATION_MODE=disabled");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(threshold: u32, open_secs: u64) -> DatabaseConfig {
        DatabaseConfig {
            url: "postgres://localhost/none".to_string(),
            migration_mode: MigrationMode::Disabled,
            max_connections: 5,
            acquire_timeout_secs: 2,
            health_check_interval_secs: 10,
            circuit_failure_threshold: threshold,
            circuit_open_secs: open_secs,
        }
    }

    #[test]
    fn starts_closed_and_allows_requests() {
        let breaker = DbCircuitBreaker::new(&config(3, 30));

        assert_eq!(breaker.state(), CircuitState::Closed);
        assert!(breaker.allows_request());
    }

    #[test]
    fn stays_closed_below_the_threshold() {
        let breaker = DbCircuitBreaker::new(&config(3, 30));

        breaker.record_failure();
        breaker.record_failure();

        assert_eq!(breaker.state(), CircuitState::Closed);
        assert!(breaker.allows_request());
    }

    #[test]
    fn opens_on_the_third_consecutive_failure() {
        let breaker = DbCircuitBreaker::new(&config(3, 30));

        breaker.record_failure();
        breaker.record_failure();
        breaker.record_failure();

        assert_eq!(breaker.state(), CircuitState::Open);
        assert!(!breaker.allows_request());
    }

    #[test]
    fn a_success_resets_the_failure_run() {
        let breaker = DbCircuitBreaker::new(&config(3, 30));

        breaker.record_failure();
        breaker.record_failure();
        breaker.record_success();
        breaker.record_failure();

        // The counter restarted, so two failures either side of a success must
        // not add up to a trip.
        assert_eq!(breaker.state(), CircuitState::Closed);
        assert_eq!(breaker.consecutive_failures(), 1);
    }

    #[test]
    fn honours_a_custom_threshold() {
        let breaker = DbCircuitBreaker::new(&config(1, 30));

        breaker.record_failure();

        assert_eq!(breaker.state(), CircuitState::Open);
    }

    #[test]
    fn moves_to_half_open_once_the_cooldown_elapses() {
        // Zero cooldown so the transition is observable without sleeping.
        let breaker = DbCircuitBreaker::new(&config(1, 0));
        breaker.record_failure();

        assert_eq!(breaker.state(), CircuitState::HalfOpen);
    }

    #[test]
    fn half_open_admits_exactly_one_trial() {
        let breaker = DbCircuitBreaker::new(&config(1, 0));
        breaker.record_failure();

        assert!(breaker.allows_request(), "first caller probes");
        assert!(!breaker.allows_request(), "the backlog must not follow it in");
    }

    #[test]
    fn a_successful_trial_closes_the_breaker() {
        let breaker = DbCircuitBreaker::new(&config(1, 0));
        breaker.record_failure();
        assert!(breaker.allows_request());

        breaker.record_success();

        assert_eq!(breaker.state(), CircuitState::Closed);
        assert!(breaker.allows_request());
    }

    #[test]
    fn a_failed_trial_reopens_the_breaker() {
        let breaker = DbCircuitBreaker::new(&config(5, 0));
        // Trip it, then let it decay to half-open.
        for _ in 0..5 {
            breaker.record_failure();
        }
        assert_eq!(breaker.state(), CircuitState::HalfOpen);
        assert!(breaker.allows_request());

        breaker.record_failure();

        // Reopened on the trial's evidence alone, without waiting for another
        // five failures.
        assert_ne!(breaker.state(), CircuitState::Closed);
    }

    #[test]
    fn acquire_timeout_comes_from_config() {
        let breaker = DbCircuitBreaker::new(&config(3, 30));

        assert_eq!(breaker.acquire_timeout(), Duration::from_secs(2));
    }

    #[test]
    fn a_zero_threshold_is_treated_as_one() {
        // A threshold of 0 would otherwise mean "open before any failure".
        let breaker = DbCircuitBreaker::new(&config(0, 30));

        assert_eq!(breaker.state(), CircuitState::Closed);
        breaker.record_failure();
        assert_eq!(breaker.state(), CircuitState::Open);
    }
}
