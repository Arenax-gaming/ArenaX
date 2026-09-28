use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct IdempotencyKey {
    pub id: Uuid,
    pub key: String,
    pub request_hash: String,
    pub response_status: i16,
    pub response_headers: Option<serde_json::Value>,
    pub response_body: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct IdempotencyConfig {
    pub id: Uuid,
    pub route_pattern: String,
    pub enabled: bool,
    pub ttl_seconds: i32,
    pub max_response_size_kb: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdempotencyResponse {
    pub status: i16,
    pub headers: Option<serde_json::Value>,
    pub body: Option<serde_json::Value>,
    pub is_cached: bool,
    pub cached_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdempotencyConflict {
    pub key: String,
    pub original_hash: String,
    pub new_hash: String,
    pub original_timestamp: DateTime<Utc>,
    pub conflict_type: ConflictType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictType {
    PayloadMismatch,
    MethodMismatch,
    RouteMismatch,
    UserMismatch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdempotencyPolicy {
    /// Apply idempotency to ALL POST and PUT methods globally
    pub enabled: bool,
    /// Header name for the idempotency key (default: "Idempotency-Key")
    pub key_header_name: String,
    /// TTL in seconds for cached responses (default: 86400 = 24 hours)
    pub ttl_seconds: u64,
    /// Max response body size in KB to cache (default: 1024 = 1MB)
    pub max_response_size_kb: u32,
    /// Status code returned on idempotency key conflict (default: 422)
    pub conflict_status_code: u16,
}

impl Default for IdempotencyPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            key_header_name: "Idempotency-Key".to_string(),
            ttl_seconds: 86400, // 24 hours
            max_response_size_kb: 1024, // 1MB
            conflict_status_code: 422,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedResponse {
    pub request_hash: String,
    pub status: u16,
    pub headers: serde_json::Value,
    pub body: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

impl CachedResponse {
    pub fn new(
        request_hash: String,
        status: u16,
        headers: serde_json::Value,
        body: serde_json::Value,
    ) -> Self {
        Self {
            request_hash,
            status,
            headers,
            body,
            created_at: Utc::now(),
        }
    }

    pub fn size_bytes(&self) -> usize {
        let serialized = serde_json::to_string(&self).unwrap_or_default();
        serialized.len()
    }

    pub fn size_kb(&self) -> u32 {
        (self.size_bytes() / 1024) as u32
    }
}

/// Metrics for idempotency middleware tracking cache performance and errors.
#[derive(Debug, Clone)]
pub struct IdempotencyMetrics {
    /// Total cache hits (duplicate request with same key)
    pub hits: Arc<AtomicU64>,
    /// Total cache misses (new request key)
    pub misses: Arc<AtomicU64>,
    /// Total idempotency key conflicts (same key, different request data)
    pub conflicts: Arc<AtomicU64>,
    /// Total Redis errors (Redis unavailable, etc.)
    pub redis_errors: Arc<AtomicU64>,
}

impl IdempotencyMetrics {
    pub fn new() -> Self {
        Self {
            hits: Arc::new(AtomicU64::new(0)),
            misses: Arc::new(AtomicU64::new(0)),
            conflicts: Arc::new(AtomicU64::new(0)),
            redis_errors: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn increment_hits(&self) {
        self.hits.fetch_add(1, Ordering::Relaxed);
    }

    pub fn increment_misses(&self) {
        self.misses.fetch_add(1, Ordering::Relaxed);
    }

    pub fn increment_conflicts(&self) {
        self.conflicts.fetch_add(1, Ordering::Relaxed);
    }

    pub fn increment_redis_errors(&self) {
        self.redis_errors.fetch_add(1, Ordering::Relaxed);
    }

    pub fn get_hits(&self) -> u64 {
        self.hits.load(Ordering::Relaxed)
    }

    pub fn get_misses(&self) -> u64 {
        self.misses.load(Ordering::Relaxed)
    }

    pub fn get_conflicts(&self) -> u64 {
        self.conflicts.load(Ordering::Relaxed)
    }

    pub fn get_redis_errors(&self) -> u64 {
        self.redis_errors.load(Ordering::Relaxed)
    }

    /// Calculate hit rate as percentage (hits / (hits + misses))
    pub fn hit_rate(&self) -> f64 {
        let hits = self.get_hits();
        let misses = self.get_misses();
        let total = hits + misses;

        if total == 0 {
            0.0
        } else {
            (hits as f64 / total as f64) * 100.0
        }
    }

    /// Get snapshot of all metrics for reporting
    pub fn snapshot(&self) -> IdempotencyMetricsSnapshot {
        IdempotencyMetricsSnapshot {
            hits: self.get_hits(),
            misses: self.get_misses(),
            conflicts: self.get_conflicts(),
            redis_errors: self.get_redis_errors(),
            hit_rate: self.hit_rate(),
        }
    }
}

impl Default for IdempotencyMetrics {
    fn default() -> Self {
        Self::new()
    }
}

/// Point-in-time snapshot of idempotency metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdempotencyMetricsSnapshot {
    pub hits: u64,
    pub misses: u64,
    pub conflicts: u64,
    pub redis_errors: u64,
    pub hit_rate: f64,
}
