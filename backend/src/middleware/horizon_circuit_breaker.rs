//! Error-rate circuit breaker for Stellar Horizon RPC calls (Issue #1346).
//!
//! # Problem
//! When Horizon is degraded every Stellar-dependent request waits on a slow or
//! failing upstream call, ties up workers, and finally surfaces as a confusing
//! 500/400 to the client.
//!
//! # Solution
//! [`HorizonCircuitBreaker`] tracks the outcome of every Horizon call over a
//! sliding time window. Unlike the consecutive-failure breaker in
//! [`super::circuit_breaker`], it trips on the *error rate* once the window has
//! seen a minimum volume of calls, so a single flaky request never opens it but
//! a sustained outage does.
//!
//! - `closed`    — calls flow; outcomes are recorded in the window.
//! - `open`      — calls fail fast with [`BreakerOpen`], which the HTTP layer
//!                 maps to `503 Service Unavailable` + `Retry-After`.
//! - `half_open` — after `open_duration`, a bounded number of probe calls are
//!                 let through. Enough probe successes close the breaker; any
//!                 probe failure re-opens it.
//!
//! The current state is exposed at `GET /api/health/stellar`.

use std::{
    collections::VecDeque,
    fmt,
    future::Future,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{Duration, Instant},
};

use serde::Serialize;
use tracing::{info, warn};

// ─────────────────────────────────────────────────────────────────────────────
// Clock
// ─────────────────────────────────────────────────────────────────────────────

/// Time source for the breaker, injectable so tests can drive state
/// transitions deterministically instead of sleeping.
pub trait Clock: Send + Sync + fmt::Debug {
    fn now(&self) -> Instant;
}

/// Wall-clock time source used in production.
#[derive(Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// Manually advanced clock for tests.
#[derive(Debug)]
pub struct ManualClock {
    now: Mutex<Instant>,
}

impl ManualClock {
    pub fn new() -> Self {
        Self {
            now: Mutex::new(Instant::now()),
        }
    }

    pub fn advance(&self, by: Duration) {
        let mut now = self.now.lock().unwrap_or_else(|e| e.into_inner());
        *now += by;
    }
}

impl Default for ManualClock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock for ManualClock {
    fn now(&self) -> Instant {
        *self.now.lock().unwrap_or_else(|e| e.into_inner())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/// Tunables for the Horizon breaker. Defaults can be overridden with the
/// `HORIZON_BREAKER_*` environment variables (see [`Self::from_env`]).
#[derive(Debug, Clone, Serialize)]
pub struct HorizonBreakerConfig {
    /// Failure ratio (0.0–1.0) within the window at or above which the breaker opens.
    pub failure_rate_threshold: f64,
    /// Minimum number of calls in the window before the rate is evaluated.
    pub minimum_requests: u32,
    /// Length of the sliding window over which outcomes are counted.
    #[serde(serialize_with = "serialize_secs")]
    pub window: Duration,
    /// How long the breaker stays open before admitting half-open probes.
    #[serde(serialize_with = "serialize_secs")]
    pub open_duration: Duration,
    /// Maximum concurrent probe calls admitted while half-open.
    pub half_open_max_probes: u32,
    /// Probe successes required to close the breaker again.
    pub half_open_success_threshold: u32,
}

fn serialize_secs<S: serde::Serializer>(d: &Duration, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_u64(d.as_secs())
}

impl Default for HorizonBreakerConfig {
    fn default() -> Self {
        Self {
            failure_rate_threshold: 0.5,
            minimum_requests: 10,
            window: Duration::from_secs(60),
            open_duration: Duration::from_secs(30),
            half_open_max_probes: 3,
            half_open_success_threshold: 2,
        }
    }
}

impl HorizonBreakerConfig {
    /// Build a config from `HORIZON_BREAKER_FAILURE_RATE`,
    /// `HORIZON_BREAKER_MIN_REQUESTS`, `HORIZON_BREAKER_WINDOW_SECS`,
    /// `HORIZON_BREAKER_OPEN_SECS`, `HORIZON_BREAKER_HALF_OPEN_PROBES` and
    /// `HORIZON_BREAKER_HALF_OPEN_SUCCESSES`, falling back to the defaults for
    /// anything unset or unparsable.
    pub fn from_env() -> Self {
        fn var<T: std::str::FromStr>(name: &str) -> Option<T> {
            std::env::var(name).ok().and_then(|v| v.trim().parse().ok())
        }

        let d = Self::default();
        Self {
            failure_rate_threshold: var::<f64>("HORIZON_BREAKER_FAILURE_RATE")
                .map(|r| r.clamp(0.01, 1.0))
                .unwrap_or(d.failure_rate_threshold),
            minimum_requests: var::<u32>("HORIZON_BREAKER_MIN_REQUESTS")
                .map(|n| n.max(1))
                .unwrap_or(d.minimum_requests),
            window: var::<u64>("HORIZON_BREAKER_WINDOW_SECS")
                .map(|s| Duration::from_secs(s.max(1)))
                .unwrap_or(d.window),
            open_duration: var::<u64>("HORIZON_BREAKER_OPEN_SECS")
                .map(|s| Duration::from_secs(s.max(1)))
                .unwrap_or(d.open_duration),
            half_open_max_probes: var::<u32>("HORIZON_BREAKER_HALF_OPEN_PROBES")
                .map(|n| n.max(1))
                .unwrap_or(d.half_open_max_probes),
            half_open_success_threshold: var::<u32>("HORIZON_BREAKER_HALF_OPEN_SUCCESSES")
                .map(|n| n.max(1))
                .unwrap_or(d.half_open_success_threshold),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BreakerState {
    Closed,
    Open,
    HalfOpen,
}

impl fmt::Display for BreakerState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BreakerState::Closed => write!(f, "closed"),
            BreakerState::Open => write!(f, "open"),
            BreakerState::HalfOpen => write!(f, "half_open"),
        }
    }
}

/// Returned when the breaker refuses a call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BreakerOpen {
    pub retry_after_secs: u64,
}

impl fmt::Display for BreakerOpen {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Stellar Horizon circuit breaker is open (retry in {}s)",
            self.retry_after_secs
        )
    }
}

impl std::error::Error for BreakerOpen {}

/// Error from [`HorizonCircuitBreaker::call`].
#[derive(Debug)]
pub enum HorizonCallError<E> {
    /// The breaker refused the call without contacting Horizon.
    Open(BreakerOpen),
    /// Horizon was called and the operation failed.
    Inner(E),
}

/// Permission to make one Horizon call. Must be resolved with
/// [`HorizonCircuitBreaker::record_success`] or
/// [`HorizonCircuitBreaker::record_failure`].
#[derive(Debug)]
#[must_use = "record the outcome of the call on the breaker"]
pub struct CallPermit {
    probe: bool,
}

impl CallPermit {
    /// Whether this call is a half-open recovery probe.
    pub fn is_probe(&self) -> bool {
        self.probe
    }
}

/// Snapshot of breaker state for `/health/stellar` and metrics.
#[derive(Debug, Clone, Serialize)]
pub struct BreakerSnapshot {
    pub state: BreakerState,
    pub window_requests: u32,
    pub window_failures: u32,
    pub failure_rate: f64,
    pub retry_after_secs: u64,
    pub trip_count: u64,
    pub total_rejected: u64,
    pub half_open_in_flight: u32,
    pub half_open_successes: u32,
    pub config: HorizonBreakerConfig,
}

#[derive(Debug)]
struct Inner {
    state: BreakerState,
    /// (timestamp, succeeded) for every call recorded while closed.
    outcomes: VecDeque<(Instant, bool)>,
    opened_at: Option<Instant>,
    half_open_in_flight: u32,
    half_open_successes: u32,
    trip_count: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Breaker
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct HorizonCircuitBreaker {
    config: HorizonBreakerConfig,
    clock: Arc<dyn Clock>,
    inner: Mutex<Inner>,
    total_rejected: AtomicU64,
}

impl Default for HorizonCircuitBreaker {
    fn default() -> Self {
        Self::new(HorizonBreakerConfig::default())
    }
}

impl HorizonCircuitBreaker {
    pub fn new(config: HorizonBreakerConfig) -> Self {
        Self::with_clock(config, Arc::new(SystemClock))
    }

    pub fn with_clock(config: HorizonBreakerConfig, clock: Arc<dyn Clock>) -> Self {
        Self {
            config,
            clock,
            inner: Mutex::new(Inner {
                state: BreakerState::Closed,
                outcomes: VecDeque::new(),
                opened_at: None,
                half_open_in_flight: 0,
                half_open_successes: 0,
                trip_count: 0,
            }),
            total_rejected: AtomicU64::new(0),
        }
    }

    pub fn config(&self) -> &HorizonBreakerConfig {
        &self.config
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Move `open` → `half_open` once the cool-down elapsed and drop window
    /// entries that slid out. Called under the lock before every decision.
    fn refresh(&self, inner: &mut Inner, now: Instant) {
        if inner.state == BreakerState::Open {
            if let Some(opened_at) = inner.opened_at {
                if now.saturating_duration_since(opened_at) >= self.config.open_duration {
                    inner.state = BreakerState::HalfOpen;
                    inner.half_open_in_flight = 0;
                    inner.half_open_successes = 0;
                    info!("Horizon circuit breaker half-open; admitting recovery probes");
                }
            }
        }

        while let Some(&(at, _)) = inner.outcomes.front() {
            if now.saturating_duration_since(at) > self.config.window {
                inner.outcomes.pop_front();
            } else {
                break;
            }
        }
    }

    fn retry_after(&self, inner: &Inner, now: Instant) -> u64 {
        match (inner.state, inner.opened_at) {
            (BreakerState::Open, Some(opened_at)) => {
                let remaining = self
                    .config
                    .open_duration
                    .saturating_sub(now.saturating_duration_since(opened_at));
                // Ceil to whole seconds, never advertise 0 while still open.
                ((remaining.as_millis() as u64 + 999) / 1000).max(1)
            }
            // Probe slots are full: a short back-off is enough.
            (BreakerState::HalfOpen, _) => 1,
            _ => 0,
        }
    }

    /// Current state (resolving any elapsed open cool-down).
    pub fn state(&self) -> BreakerState {
        let now = self.clock.now();
        let mut inner = self.lock();
        self.refresh(&mut inner, now);
        inner.state
    }

    /// Ask to make a Horizon call.
    pub fn try_acquire(&self) -> Result<CallPermit, BreakerOpen> {
        let now = self.clock.now();
        let mut inner = self.lock();
        self.refresh(&mut inner, now);

        match inner.state {
            BreakerState::Closed => Ok(CallPermit { probe: false }),
            BreakerState::HalfOpen if inner.half_open_in_flight < self.config.half_open_max_probes => {
                inner.half_open_in_flight += 1;
                Ok(CallPermit { probe: true })
            }
            _ => {
                self.total_rejected.fetch_add(1, Ordering::Relaxed);
                Err(BreakerOpen {
                    retry_after_secs: self.retry_after(&inner, now),
                })
            }
        }
    }

    pub fn record_success(&self, permit: CallPermit) {
        self.record(permit, true);
    }

    pub fn record_failure(&self, permit: CallPermit) {
        self.record(permit, false);
    }

    fn record(&self, permit: CallPermit, success: bool) {
        let now = self.clock.now();
        let mut inner = self.lock();
        self.refresh(&mut inner, now);

        if permit.probe {
            inner.half_open_in_flight = inner.half_open_in_flight.saturating_sub(1);
            if inner.state != BreakerState::HalfOpen {
                // Another probe already settled the outcome.
                return;
            }
            if success {
                inner.half_open_successes += 1;
                if inner.half_open_successes >= self.config.half_open_success_threshold {
                    self.close(&mut inner);
                }
            } else {
                warn!("Horizon recovery probe failed; re-opening circuit breaker");
                self.trip(&mut inner, now);
            }
            return;
        }

        // Late results from calls admitted while closed don't affect a
        // breaker that has since opened.
        if inner.state != BreakerState::Closed {
            return;
        }

        inner.outcomes.push_back((now, success));
        let total = inner.outcomes.len() as u32;
        if success || total < self.config.minimum_requests {
            return;
        }
        let failures = inner.outcomes.iter().filter(|(_, ok)| !ok).count() as u32;
        let rate = failures as f64 / total as f64;
        if rate >= self.config.failure_rate_threshold {
            warn!(
                failures,
                total,
                failure_rate = rate,
                threshold = self.config.failure_rate_threshold,
                "Horizon error rate exceeded threshold; opening circuit breaker"
            );
            self.trip(&mut inner, now);
        }
    }

    fn trip(&self, inner: &mut Inner, now: Instant) {
        inner.state = BreakerState::Open;
        inner.opened_at = Some(now);
        inner.outcomes.clear();
        inner.half_open_in_flight = 0;
        inner.half_open_successes = 0;
        inner.trip_count += 1;
    }

    fn close(&self, inner: &mut Inner) {
        inner.state = BreakerState::Closed;
        inner.opened_at = None;
        inner.outcomes.clear();
        inner.half_open_in_flight = 0;
        inner.half_open_successes = 0;
        info!("Horizon circuit breaker closed; Horizon is healthy again");
    }

    /// Run `f` under the breaker. `is_outage` decides whether an error counts
    /// against Horizon's health (a 404 for an unknown tx hash should not; a
    /// timeout or 5xx should).
    pub async fn call<F, Fut, T, E>(
        &self,
        is_outage: impl Fn(&E) -> bool,
        f: F,
    ) -> Result<T, HorizonCallError<E>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, E>>,
    {
        let permit = self.try_acquire().map_err(HorizonCallError::Open)?;
        match f().await {
            Ok(value) => {
                self.record_success(permit);
                Ok(value)
            }
            Err(err) => {
                if is_outage(&err) {
                    self.record_failure(permit);
                } else {
                    // Horizon answered; it's the request that was bad.
                    self.record_success(permit);
                }
                Err(HorizonCallError::Inner(err))
            }
        }
    }

    pub fn snapshot(&self) -> BreakerSnapshot {
        let now = self.clock.now();
        let mut inner = self.lock();
        self.refresh(&mut inner, now);

        let window_requests = inner.outcomes.len() as u32;
        let window_failures = inner.outcomes.iter().filter(|(_, ok)| !ok).count() as u32;
        BreakerSnapshot {
            state: inner.state,
            window_requests,
            window_failures,
            failure_rate: if window_requests == 0 {
                0.0
            } else {
                window_failures as f64 / window_requests as f64
            },
            retry_after_secs: self.retry_after(&inner, now),
            trip_count: inner.trip_count,
            total_rejected: self.total_rejected.load(Ordering::Relaxed),
            half_open_in_flight: inner.half_open_in_flight,
            half_open_successes: inner.half_open_successes,
            config: self.config.clone(),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> HorizonBreakerConfig {
        HorizonBreakerConfig {
            failure_rate_threshold: 0.5,
            minimum_requests: 4,
            window: Duration::from_secs(10),
            open_duration: Duration::from_secs(5),
            half_open_max_probes: 2,
            half_open_success_threshold: 2,
        }
    }

    fn breaker() -> (HorizonCircuitBreaker, Arc<ManualClock>) {
        let clock = Arc::new(ManualClock::new());
        (
            HorizonCircuitBreaker::with_clock(test_config(), clock.clone()),
            clock,
        )
    }

    fn succeed(b: &HorizonCircuitBreaker) {
        let p = b.try_acquire().expect("call should be admitted");
        b.record_success(p);
    }

    fn fail(b: &HorizonCircuitBreaker) {
        let p = b.try_acquire().expect("call should be admitted");
        b.record_failure(p);
    }

    #[test]
    fn full_cycle_closed_open_half_open_closed() {
        let (b, clock) = breaker();
        assert_eq!(b.state(), BreakerState::Closed);

        // 2 ok + 2 failed = 50% over the minimum volume → open.
        succeed(&b);
        succeed(&b);
        fail(&b);
        assert_eq!(b.state(), BreakerState::Closed, "below minimum volume");
        fail(&b);
        assert_eq!(b.state(), BreakerState::Open);

        // Open: calls are refused with a Retry-After hint.
        let refused = b.try_acquire().unwrap_err();
        assert_eq!(refused.retry_after_secs, 5);
        clock.advance(Duration::from_secs(2));
        assert_eq!(b.try_acquire().unwrap_err().retry_after_secs, 3);

        // Cool-down elapses → half-open.
        clock.advance(Duration::from_secs(3));
        assert_eq!(b.state(), BreakerState::HalfOpen);

        // Probe slots are bounded.
        let p1 = b.try_acquire().expect("first probe");
        let p2 = b.try_acquire().expect("second probe");
        assert!(p1.is_probe() && p2.is_probe());
        assert!(b.try_acquire().is_err(), "probe limit reached");

        // Enough probe successes → closed.
        b.record_success(p1);
        assert_eq!(b.state(), BreakerState::HalfOpen);
        b.record_success(p2);
        assert_eq!(b.state(), BreakerState::Closed);

        let snap = b.snapshot();
        assert_eq!(snap.trip_count, 1);
        assert_eq!(snap.window_requests, 0, "window resets on close");
        assert!(snap.total_rejected >= 3);
    }

    #[test]
    fn failed_probe_reopens() {
        let (b, clock) = breaker();
        for _ in 0..4 {
            fail(&b);
        }
        assert_eq!(b.state(), BreakerState::Open);

        clock.advance(Duration::from_secs(5));
        assert_eq!(b.state(), BreakerState::HalfOpen);
        fail(&b);
        assert_eq!(b.state(), BreakerState::Open);
        assert_eq!(b.snapshot().trip_count, 2);
        assert_eq!(b.try_acquire().unwrap_err().retry_after_secs, 5);
    }

    #[test]
    fn error_rate_below_threshold_stays_closed() {
        let (b, _clock) = breaker();
        for _ in 0..3 {
            succeed(&b);
        }
        fail(&b); // 25%
        succeed(&b);
        fail(&b); // 2/6 ≈ 33%
        assert_eq!(b.state(), BreakerState::Closed);
    }

    #[test]
    fn old_failures_slide_out_of_window() {
        let (b, clock) = breaker();
        fail(&b);
        fail(&b);
        fail(&b);
        clock.advance(Duration::from_secs(11));
        // The three failures expired, so a fourth failure is 1/1 but below
        // the minimum volume.
        fail(&b);
        assert_eq!(b.state(), BreakerState::Closed);
        assert_eq!(b.snapshot().window_requests, 1);
    }

    #[test]
    fn call_classifies_non_outage_errors_as_healthy() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let (b, _clock) = breaker();
            for _ in 0..6 {
                let res: Result<(), HorizonCallError<&str>> = b
                    .call(|e: &&str| *e == "timeout", || async { Err("not found") })
                    .await;
                assert!(matches!(res, Err(HorizonCallError::Inner("not found"))));
            }
            assert_eq!(b.state(), BreakerState::Closed);

            // 6 healthy + 6 outages = 50% → open.
            for _ in 0..6 {
                let _ = b
                    .call(|e: &&str| *e == "timeout", || async { Err::<(), _>("timeout") })
                    .await;
            }
            assert_eq!(b.state(), BreakerState::Open);

            let res: Result<(), HorizonCallError<&str>> = b
                .call(|_| true, || async { Ok(()) })
                .await;
            assert!(matches!(res, Err(HorizonCallError::Open(_))));
        });
    }
}
