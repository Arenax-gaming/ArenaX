use crate::api_error::ApiError;
use crate::db::DbPool;
use actix_web::{web, HttpResponse, Result};
use redis::aio::ConnectionManager;
use serde_json::json;
use std::time::{Duration, Instant};

/// Default minimum free disk percentage (0.0-100.0) before the service is
/// considered degraded.
const MIN_FREE_DISK_PERCENT: f64 = 5.0;

/// Filesystem path inspected for free disk space. Defaults to the process
/// working directory, which follows the deployment's storage partition.
const DISK_CHECK_PATH: &str = ".";

/// Per-dependency timeout for the readiness probe (2 seconds, Issue #1079).
const CHECK_TIMEOUT: Duration = Duration::from_secs(2);

/// Soroban RPC base URL injected as app data for readiness checks.
///
/// A plain `web::Data<String>` is avoided to prevent collisions with other
/// `String` app data (same reason the match-authority handler uses a
/// `SignerSecret` newtype).
#[derive(Clone)]
pub struct SorobanRpcUrl(pub String);

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

/// GET /api/health/live
///
/// Liveness probe: returns 200 immediately without touching downstream
/// dependencies, so a load balancer / orchestrator that only needs to know the
/// process is alive does not get a false negative while (for example) Redis is
/// being restarted.
pub async fn liveness_check() -> Result<HttpResponse, ApiError> {
    Ok(HttpResponse::Ok().json(json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339()
    })))
}

/// GET /api/health/ready
///
/// Readiness probe: live checks against PostgreSQL, Redis and the Soroban RPC
/// endpoint, each with a 2-second timeout. Used for load-balancer / Kubernetes
/// readiness decisions and routing: healthy and degraded both answer 200 while
/// `unhealthy` answers 503 so traffic is pulled off the instance.
pub async fn readiness_check(
    db_pool: web::Data<DbPool>,
    redis: web::Data<ConnectionManager>,
    soroban_url: web::Data<SorobanRpcUrl>,
) -> Result<HttpResponse, ApiError> {
    // PostgreSQL ping (2s timeout)
    let db_checked = tokio::time::timeout(CHECK_TIMEOUT, crate::db::health_check(&db_pool)).await;
    let db_ok = matches!(db_checked, Ok(Ok(())));
    let db = if db_ok { "ok" } else { "error" };

    // Redis PING (2s timeout)
    let redis_checked = tokio::time::timeout(CHECK_TIMEOUT, async {
        redis::cmd("PING")
            .query_async::<String>(&mut redis_conn(&redis))
            .await
    })
    .await;
    let redis_ok = matches!(redis_checked, Ok(Ok(ref pong)) if pong == "PONG");
    let redis = if redis_ok { "ok" } else { "error" };

    // Soroban RPC reachability (2s timeout, GET on the JSON-RPC endpoint)
    let soroban_ok = check_soroban_rpc(&soroban_url.0).await;
    let soroban = if soroban_ok { "ok" } else { "error" };

    // Update the Prometheus gauge on every readiness check (Issue #1079)
    crate::metrics::record_dependency_health("db", db_ok);
    crate::metrics::record_dependency_health("redis", redis_ok);
    crate::metrics::record_dependency_health("soroban", soroban_ok);

    // Aggregate: the API cannot serve users without the database, so a DB
    // failure is `unhealthy` (503). Missing Redis / Soroban is `degraded`.
    let status = if !db_ok {
        "unhealthy"
    } else if redis_ok && soroban_ok {
        "healthy"
    } else {
        "degraded"
    };

    let body = json!({
        "status": status,
        "checks": {
            "db": db,
            "redis": redis,
            "soroban": soroban
        },
        "timestamp": chrono::Utc::now().to_rfc3339()
    });

    if status == "unhealthy" {
        Ok(HttpResponse::ServiceUnavailable().json(body))
    } else {
        Ok(HttpResponse::Ok().json(body))
    }
}

/// Probe the Soroban RPC endpoint for reachability within the 2s budget.
///
/// A plain client `GET` is sufficient — reaching the endpoint (any HTTP
/// response) proves the RPC service is up; a timeout or transport error marks
/// it down. RPC bodies are not required for reachability.
async fn check_soroban_rpc(base_url: &str) -> bool {
    if base_url.trim().is_empty() {
        return false;
    }
    let client = reqwest::Client::builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .unwrap_or_default();
    tokio::time::timeout(CHECK_TIMEOUT, async {
        client.get(base_url).send().await
    })
    .await
    .map(|result| result.map(|resp| resp.status().is_success()).unwrap_or(false))
    .unwrap_or(false)
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

    #[test]
    fn readiness_aggregation_rules() {
        // db down => unhealthy
        let db_ok = false;
        let redis_ok = true;
        let soroban_ok = true;
        assert_eq!(
            readiness_status_label(db_ok, redis_ok, soroban_ok),
            "unhealthy"
        );

        // db up, redis down => degraded
        assert_eq!(readiness_status_label(true, false, true), "degraded");

        // db up, soroban down => degraded
        assert_eq!(readiness_status_label(true, true, false), "degraded");

        // all up => healthy
        assert_eq!(readiness_status_label(true, true, true), "healthy");
    }

    // Mirrors the aggregation logic in `readiness_check` (kept as a pure
    // function so it can be unit-tested without live dependencies).
    fn readiness_status_label(db_ok: bool, redis_ok: bool, soroban_ok: bool) -> &'static str {
        if !db_ok {
            "unhealthy"
        } else if redis_ok && soroban_ok {
            "healthy"
        } else {
            "degraded"
        }
    }
}