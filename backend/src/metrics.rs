//! Prometheus metrics export.
//!
//! Exposes a `/metrics` endpoint (Prometheus text exposition format) so a
//! Prometheus server can scrape this service the same way it already
//! scrapes `arenax-server` (see `server/infra/monitoring/prometheus.yml`),
//! giving both services a single, unified monitoring stack instead of one
//! per service.
use actix_web::{HttpResponse, Result};
use once_cell::sync::Lazy;
use prometheus::{
    Encoder, HistogramVec, IntCounterVec, IntGauge, IntGaugeVec, Opts, Registry, TextEncoder,
};
use std::sync::atomic::{AtomicU64, Ordering};

pub static REGISTRY: Lazy<Registry> = Lazy::new(Registry::new);

pub static HTTP_REQUESTS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    let counter = IntCounterVec::new(
        Opts::new("http_requests_total", "Total HTTP requests processed"),
        &["method", "route", "status_code"],
    )
    .expect("metric can be created");
    REGISTRY
        .register(Box::new(counter.clone()))
        .expect("metric can be registered");
    counter
});

pub static HTTP_REQUEST_DURATION_SECONDS: Lazy<HistogramVec> = Lazy::new(|| {
    let histogram = HistogramVec::new(
        prometheus::HistogramOpts::new(
            "http_request_duration_seconds",
            "HTTP request latency in seconds",
        )
        .buckets(vec![
            0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
        ]),
        &["method", "route"],
    )
    .expect("metric can be created");
    REGISTRY
        .register(Box::new(histogram.clone()))
        .expect("metric can be registered");
    histogram
});

pub static DB_POOL_CONNECTIONS_ACTIVE: Lazy<IntGauge> = Lazy::new(|| {
    let gauge = IntGauge::new(
        "db_pool_connections_active",
        "Active PostgreSQL connections held by the pool",
    )
    .expect("metric can be created");
    REGISTRY
        .register(Box::new(gauge.clone()))
        .expect("metric can be registered");
    gauge
});

pub static DB_POOL_CONNECTIONS_IDLE: Lazy<IntGauge> = Lazy::new(|| {
    let gauge = IntGauge::new(
        "db_pool_connections_idle",
        "Idle PostgreSQL connections held by the pool",
    )
    .expect("metric can be created");
    REGISTRY
        .register(Box::new(gauge.clone()))
        .expect("metric can be registered");
    gauge
});

// Circuit Breaker Metrics (Issue #944)
pub static CIRCUIT_BREAKER_STATE: Lazy<IntGaugeVec> = Lazy::new(|| {
    let gauge = IntGaugeVec::new(
        Opts::new(
            "circuit_breaker_state",
            "Current state of external service circuit breaker (0=Closed, 1=HalfOpen, 2=Open)",
        ),
        &["service"],
    )
    .expect("metric can be created");
    REGISTRY
        .register(Box::new(gauge.clone()))
        .expect("metric can be registered");
    gauge
});

pub static CIRCUIT_BREAKER_REQUESTS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    let counter = IntCounterVec::new(
        Opts::new(
            "circuit_breaker_requests_total",
            "Total external service requests processed by circuit breaker",
        ),
        &["service", "status"],
    )
    .expect("metric can be created");
    REGISTRY
        .register(Box::new(counter.clone()))
        .expect("metric can be registered");
    counter
});

pub static CIRCUIT_BREAKER_TRIPS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    let counter = IntCounterVec::new(
        Opts::new(
            "circuit_breaker_trips_total",
            "Total number of times external service circuit breaker tripped OPEN",
        ),
        &["service"],
    )
    .expect("metric can be created");
    REGISTRY
        .register(Box::new(counter.clone()))
        .expect("metric can be registered");
    counter
});

/// Count of WebSocket messages dropped for exceeding the per-connection
/// rate limit (#1083), labeled by user so a single flooding user stands out.
pub static WS_MESSAGES_RATE_LIMITED_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    let counter = IntCounterVec::new(
        Opts::new(
            "ws_messages_rate_limited_total",
            "Total WebSocket messages dropped for exceeding the per-connection rate limit",
        ),
        &["user_id"],
    )
    .expect("metric can be created");
    REGISTRY
        .register(Box::new(counter.clone()))
        .expect("metric can be registered");
    counter
});

/// Per-named-query latency (#1084). `sqlx`'s own connection-level slow-query
/// log (see `db.rs::create_pool`) covers every query automatically, but it
/// has no `query_name` label to build a P99-per-query Prometheus alert from —
/// that needs the caller to name the query, via `time_query` below.
pub static DB_QUERY_DURATION_SECONDS: Lazy<HistogramVec> = Lazy::new(|| {
    let histogram = HistogramVec::new(
        prometheus::HistogramOpts::new(
            "db_query_duration_seconds",
            "Database query latency in seconds, labeled by a caller-assigned query name",
        )
        .buckets(vec![
            0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1.0, 2.5, 5.0, 10.0,
        ]),
        &["query_name"],
    )
    .expect("metric can be created");
    REGISTRY
        .register(Box::new(histogram.clone()))
        .expect("metric can be registered");
    histogram
});

/// Same default as `DatabaseConfig::slow_query_threshold_ms` (#1084);
/// duplicated here (rather than threading `Config` into every service) so
/// `time_query` call sites don't need config access, just the pool they
/// already have.
static SLOW_QUERY_THRESHOLD_MS: Lazy<u64> = Lazy::new(|| {
    std::env::var("DATABASE_SLOW_QUERY_THRESHOLD_MS")
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(200)
});

/// Runs `fut`, recording its wall-clock duration into
/// `db_query_duration_seconds{query_name}` and logging at WARN (with the
/// query name, duration, and whatever `user_id`/`correlation_id`/`route`
/// fields are on the ambient tracing span) when it exceeds
/// `DATABASE_SLOW_QUERY_THRESHOLD_MS` (#1084).
///
/// `sqlx`'s built-in slow-statement log (`db.rs`) already covers every query
/// with the raw SQL text; this is the complementary per-named-query metric
/// and log line used to build per-endpoint P99 dashboards/alerts.
pub async fn time_query<T, E>(
    query_name: &'static str,
    fut: impl std::future::Future<Output = Result<T, E>>,
) -> Result<T, E> {
    let start = std::time::Instant::now();
    let result = fut.await;
    let elapsed = start.elapsed();

    DB_QUERY_DURATION_SECONDS
        .with_label_values(&[query_name])
        .observe(elapsed.as_secs_f64());

    if elapsed.as_millis() as u64 >= *SLOW_QUERY_THRESHOLD_MS {
        tracing::warn!(
            query_name,
            duration_ms = elapsed.as_millis() as u64,
            "Slow database query"
        );
    }

    result
}

/// Force all lazily-registered metrics to initialize (and therefore
/// register with the collector registry) at startup, before the first
/// scrape — otherwise a metric with no observations yet simply wouldn't
/// appear in `/metrics` output.
pub fn init_metrics() {
    Lazy::force(&HTTP_REQUESTS_TOTAL);
    Lazy::force(&HTTP_REQUEST_DURATION_SECONDS);
    Lazy::force(&DB_POOL_CONNECTIONS_ACTIVE);
    Lazy::force(&DB_POOL_CONNECTIONS_IDLE);
    Lazy::force(&CIRCUIT_BREAKER_STATE);
    Lazy::force(&CIRCUIT_BREAKER_REQUESTS_TOTAL);
    Lazy::force(&CIRCUIT_BREAKER_TRIPS_TOTAL);
    Lazy::force(&PROFILE_CACHE_REQUESTS_TOTAL);
    Lazy::force(&CACHE_HIT_RATE);

    // Process-level metrics (process_resident_memory_bytes, process_cpu_seconds_total,
    // open fds, ...) — only available on Linux in prometheus crate.
    #[cfg(target_os = "linux")]
    if let Err(e) = REGISTRY.register(Box::new(
        prometheus::process_collector::ProcessCollector::for_self(),
    )) {
        tracing::warn!(error = %e, "failed to register process metrics collector");
    }
}

pub fn record_profile_cache_hit() {
    PROFILE_CACHE_REQUESTS_TOTAL
        .with_label_values(&["hit"])
        .inc();
    PROFILE_CACHE_HITS.fetch_add(1, Ordering::Relaxed);
    let reads = PROFILE_CACHE_READS.fetch_add(1, Ordering::Relaxed) + 1;
    CACHE_HIT_RATE.set((PROFILE_CACHE_HITS.load(Ordering::Relaxed) * 100 / reads) as i64);
}

pub fn record_profile_cache_miss() {
    PROFILE_CACHE_REQUESTS_TOTAL
        .with_label_values(&["miss"])
        .inc();
    let reads = PROFILE_CACHE_READS.fetch_add(1, Ordering::Relaxed) + 1;
    CACHE_HIT_RATE.set((PROFILE_CACHE_HITS.load(Ordering::Relaxed) * 100 / reads) as i64);
}

/// Snapshot the DB pool's active/idle connection counts into the gauges
/// above. Called periodically by a background task in `main.rs`.
pub fn record_pool_stats(size: u32, idle: usize) {
    DB_POOL_CONNECTIONS_ACTIVE.set(size as i64 - idle as i64);
    DB_POOL_CONNECTIONS_IDLE.set(idle as i64);
}

/// Record circuit breaker state metric snapshot for an external service.
pub fn record_circuit_breaker_state(service: &str, state_code: i64) {
    CIRCUIT_BREAKER_STATE
        .with_label_values(&[service])
        .set(state_code);
}

/// Record a circuit breaker request outcome.
pub fn record_circuit_breaker_request(service: &str, status: &str) {
    CIRCUIT_BREAKER_REQUESTS_TOTAL
        .with_label_values(&[service, status])
        .inc();
}

/// Record a circuit breaker trip event.
pub fn record_circuit_breaker_trip(service: &str) {
    CIRCUIT_BREAKER_TRIPS_TOTAL
        .with_label_values(&[service])
        .inc();
}

/// A Soroban contract invocation was attempted.
pub fn record_soroban_submitted(contract: &str, method: &str) {
    SOROBAN_TX_SUBMITTED_TOTAL
        .with_label_values(&[contract, method])
        .inc();
}

/// A Soroban transaction was confirmed successful, `elapsed_secs` after the
/// invocation started.
pub fn record_soroban_success(contract: &str, method: &str, elapsed_secs: f64) {
    SOROBAN_TX_SUCCESS_TOTAL
        .with_label_values(&[contract, method])
        .inc();
    SOROBAN_TX_LATENCY_SECONDS
        .with_label_values(&[contract, method])
        .observe(elapsed_secs);
}

/// A Soroban invocation ended without a confirmed success. `reason` is one of
/// a fixed set of values chosen in `SorobanService::invoke`.
pub fn record_soroban_failed(contract: &str, method: &str, reason: &str) {
    SOROBAN_TX_FAILED_TOTAL
        .with_label_values(&[contract, method, reason])
        .inc();
}

/// One more status poll was needed before the transaction settled.
pub fn record_soroban_retry(contract: &str, method: &str) {
    SOROBAN_TX_RETRIES_TOTAL
        .with_label_values(&[contract, method])
        .inc();
}

/// Set the current dead-letter queue depth.
///
/// Nothing calls this yet: the backend has no Soroban DLQ table (the handler
/// module declared for it by #864 was never added). Whatever stores
/// dead-lettered transactions should call this with its row count so
/// `soroban_dlq_depth` and the `SorobanDlqBacklog` alert reflect it.
pub fn set_soroban_dlq_depth(depth: i64) {
    SOROBAN_DLQ_DEPTH.set(depth);
}

pub async fn metrics_handler() -> Result<HttpResponse> {
    let encoder = TextEncoder::new();
    let metric_families = REGISTRY.gather();
    let mut buffer = Vec::new();
    if let Err(e) = encoder.encode(&metric_families, &mut buffer) {
        tracing::error!(error = %e, "failed to encode prometheus metrics");
        return Ok(HttpResponse::InternalServerError().finish());
    }

    Ok(HttpResponse::Ok()
        .content_type(encoder.format_type())
        .body(buffer))
}

#[cfg(test)]
mod time_query_tests {
    use super::*;

    #[tokio::test]
    async fn records_duration_and_passes_through_ok_results() {
        let result: Result<i32, ()> =
            time_query("test.ok_query", async { Ok(42) }).await;

        assert_eq!(result, Ok(42));
        assert!(
            DB_QUERY_DURATION_SECONDS
                .with_label_values(&["test.ok_query"])
                .get_sample_count()
                >= 1
        );
    }

    #[tokio::test]
    async fn passes_through_errors_and_still_records_duration() {
        let result: Result<i32, &str> =
            time_query("test.err_query", async { Err("boom") }).await;

        assert_eq!(result, Err("boom"));
        assert!(
            DB_QUERY_DURATION_SECONDS
                .with_label_values(&["test.err_query"])
                .get_sample_count()
                >= 1
        );
    }
}
