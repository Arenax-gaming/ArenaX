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
    Encoder, HistogramVec, IntCounterVec, IntGauge, Opts, Registry, TextEncoder,
};

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

/// Force all lazily-registered metrics to initialize (and therefore
/// register with the collector registry) at startup, before the first
/// scrape — otherwise a metric with no observations yet simply wouldn't
/// appear in `/metrics` output.
pub fn init_metrics() {
    Lazy::force(&HTTP_REQUESTS_TOTAL);
    Lazy::force(&HTTP_REQUEST_DURATION_SECONDS);
    Lazy::force(&DB_POOL_CONNECTIONS_ACTIVE);
    Lazy::force(&DB_POOL_CONNECTIONS_IDLE);

    // Process-level metrics (process_resident_memory_bytes, process_cpu_seconds_total,
    // open fds, ...) — only available on Linux in prometheus crate.
    #[cfg(target_os = "linux")]
    if let Err(e) = REGISTRY.register(Box::new(
        prometheus::process_collector::ProcessCollector::for_self(),
    )) {
        tracing::warn!(error = %e, "failed to register process metrics collector");
    }
}

/// Snapshot the DB pool's active/idle connection counts into the gauges
/// above. Called periodically by a background task in `main.rs`.
pub fn record_pool_stats(size: u32, idle: usize) {
    DB_POOL_CONNECTIONS_ACTIVE.set(size as i64 - idle as i64);
    DB_POOL_CONNECTIONS_IDLE.set(idle as i64);
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
