//! Cache observability endpoint (Issue #910).
//!
//! Hit rate is the number that tells you whether the cache is earning its
//! keep. A cache with a 5% hit rate is pure overhead plus a staleness risk,
//! and without this endpoint there is no way to notice that from the outside.

use actix_web::{web, HttpRequest, HttpResponse, Result};
use serde::Serialize;

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::middleware::cache::{CacheMetricsSnapshot, ResponseCache};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheStatsResponse {
    hits: u64,
    stale_hits: u64,
    misses: u64,
    errors: u64,
    /// Fraction in `0.0..=1.0`. Stale hits count as hits — they still spared
    /// the database a query, which is what the rate measures.
    hit_rate: f64,
}

impl From<CacheMetricsSnapshot> for CacheStatsResponse {
    fn from(snapshot: CacheMetricsSnapshot) -> Self {
        Self {
            hits: snapshot.hits,
            stale_hits: snapshot.stale_hits,
            misses: snapshot.misses,
            errors: snapshot.errors,
            hit_rate: snapshot.hit_rate(),
        }
    }
}

/// GET /api/cache/stats — hit/miss counters for this process.
///
/// Per-process, not cluster-wide: the counters live in the instance that
/// served the reads. Scraping every instance and summing is the caller's job,
/// which is what a metrics collector does anyway.
pub async fn cache_stats(
    req: HttpRequest,
    cache: web::Data<ResponseCache>,
) -> Result<HttpResponse, ApiError> {
    // Admin-only: the counters leak a rough picture of traffic shape.
    let is_admin = req
        .claims()
        .map(|c| c.roles.iter().any(|r| r == "admin"))
        .unwrap_or(false);

    if !is_admin {
        return Err(ApiError::Forbidden);
    }

    let stats: CacheStatsResponse = cache.metrics().into();
    Ok(HttpResponse::Ok().json(serde_json::json!({ "data": stats })))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(web::scope("/api/cache").route("/stats", web::get().to(cache_stats)));
}
