use crate::api_error::ApiError;
use crate::db::DbPool;
use actix_web::{web, HttpResponse, Result};
use redis::aio::ConnectionManager;
use serde_json::json;
use std::time::Instant;

/// Default minimum free disk percentage (0.0-100.0) before the service is
/// considered degraded.
const MIN_FREE_DISK_PERCENT: f64 = 5.0;

/// Filesystem path inspected for free disk space. Defaults to the process
/// working directory, which follows the deployment's storage partition.
const DISK_CHECK_PATH: &str = ".";

/// Aggregate overall health from per-dependency results.
///
/// The service is `healthy` only when the database and Redis are both reachable
/// and the disk has at least `MIN_FREE_DISK_PERCENT` free. Any other combination
/// is `degraded`.
fn aggregate_status(database_ok: bool, redis_ok: bool, disk_free_percent: f64) -> &'static str {
    if database_ok && redis_ok && disk_free_percent >= MIN_FREE_DISK_PERCENT {
        "healthy"
    } else {
        "degraded"
    }
}

/// Runs all dependency checks and returns the detailed health report.
pub async fn health_check(
    db_pool: web::Data<DbPool>,
    redis: web::Data<ConnectionManager>,
    query: web::Query<HealthQuery>,
) -> Result<HttpResponse, ApiError> {
    let started = Instant::now();

    // Database connectivity
    let db_started = Instant::now();
    let database_status = match crate::db::health_check(&db_pool).await {
        Ok(()) => "ok",
        Err(_) => "error",
    };
    let database_latency_ms = db_started.elapsed().as_secs_f64() * 1000.0;

    // Redis connectivity
    let redis_started = Instant::now();
    let redis_status: Result<String, _> = redis::cmd("PING")
        .query_async(&mut redis_conn(&redis))
        .await;
    let redis_ok = redis_status.as_deref() == Ok("PONG");
    let redis_latency_ms = redis_started.elapsed().as_secs_f64() * 1000.0;

    // Disk space
    let (disk_free_bytes, disk_total_bytes) = disk_stats(DISK_CHECK_PATH);
    let disk_free_percent = if disk_total_bytes > 0 {
        (disk_free_bytes as f64 / disk_total_bytes as f64) * 100.0
    } else {
        0.0
    };
    let disk_status = if disk_free_percent >= MIN_FREE_DISK_PERCENT {
        "ok"
    } else {
        "low"
    };

    let status = aggregate_status(database_status == "ok", redis_ok, disk_free_percent);
    let response_time_ms = started.elapsed().as_secs_f64() * 1000.0;

    // Simple mode returns only the status.
    if query.simple {
        return Ok(HttpResponse::Ok().json(json!({ "status": status })));
    }

    Ok(HttpResponse::Ok().json(json!({
        "status": status,
        "database": {
            "status": database_status,
            "latency_ms": round2(database_latency_ms)
        },
        "redis": {
            "status": if redis_ok { "ok" } else { "error" },
            "latency_ms": round2(redis_latency_ms)
        },
        "disk": {
            "status": disk_status,
            "free_bytes": disk_free_bytes,
            "total_bytes": disk_total_bytes,
            "free_percent": round2(disk_free_percent)
        },
        "response_time_ms": round2(response_time_ms),
        "timestamp": chrono::Utc::now().to_rfc3339()
    })))
}

#[derive(serde::Deserialize)]
struct HealthQuery {
    #[serde(default)]
    simple: bool,
}

/// Borrows the shared Redis connection to issue a `PING`.
fn redis_conn(redis: &web::Data<ConnectionManager>) -> ConnectionManager {
    redis.get_ref().clone()
}

/// Returns (free_bytes, total_bytes) for the given path, or (0, 0) on error.
fn disk_stats(path: &str) -> (u64, u64) {
    match (fs2::available_space(path), fs2::total_space(path)) {
        (Ok(free), Ok(total)) => (free, total),
        _ => (0, 0),
    }
}

/// Rounds an f64 millisecond value to two decimal places.
fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregate_status_healthy_when_all_ok() {
        assert_eq!(aggregate_status(true, true, 10.0), "healthy");
        assert_eq!(
            aggregate_status(true, true, MIN_FREE_DISK_PERCENT),
            "healthy"
        );
    }

    #[test]
    fn aggregate_status_degraded_when_database_fails() {
        assert_eq!(aggregate_status(false, true, 50.0), "degraded");
    }

    #[test]
    fn aggregate_status_degraded_when_redis_fails() {
        assert_eq!(aggregate_status(true, false, 50.0), "degraded");
    }

    #[test]
    fn aggregate_status_degraded_when_disk_low() {
        assert_eq!(aggregate_status(true, true, 4.99), "degraded");
        assert_eq!(aggregate_status(true, true, 0.0), "degraded");
    }

    #[test]
    fn round2_rounds_to_two_decimal_places() {
        assert_eq!(round2(1.236), 1.24);
        assert_eq!(round2(2.0), 2.0);
    }
}
