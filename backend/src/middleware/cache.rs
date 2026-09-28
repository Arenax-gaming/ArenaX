//! Response caching for read-heavy endpoints (Issue #910).
//!
//! Leaderboards, player stats and tournament listings are read far more often
//! than they change, and every one of those reads was reaching Postgres. This
//! module adds a Redis-backed cache in front of them with three properties the
//! issue asks for: per-endpoint TTLs, invalidation on write, and
//! stale-while-revalidate so a cold key never stampedes the database.
//!
//! # Why stale-while-revalidate
//!
//! A plain TTL cache has a failure mode that shows up exactly when it matters
//! most: the moment a popular key expires, every concurrent request misses at
//! once and they all query the database together. Serving the stale value
//! while a single refresh runs in the background turns that thundering herd
//! into one query, and the reader gets an answer immediately rather than
//! waiting behind the refresh.
//!
//! An entry therefore has two ages: `fresh_for` (served without question) and
//! `stale_for` (still served, but a refresh is kicked off). Past both, the
//! entry is gone and the caller must compute.
//!
//! # Invalidation
//!
//! Entries are tagged. A write to a player's stats invalidates the
//! `player:<id>` tag, which drops every cached response derived from it
//! regardless of which endpoint or query parameters produced it. Tag sets are
//! Redis sets of cache keys, so invalidation is one `SMEMBERS` plus one `DEL`.

use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, warn};

/// How long a cached response stays fresh, and how long past that it may still
/// be served while a refresh runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CachePolicy {
    pub fresh_for: Duration,
    pub stale_for: Duration,
}

impl CachePolicy {
    pub const fn new(fresh_for: Duration, stale_for: Duration) -> Self {
        Self {
            fresh_for,
            stale_for,
        }
    }

    /// Total lifetime of the Redis key.
    fn total_ttl(&self) -> Duration {
        self.fresh_for + self.stale_for
    }
}

/// Per-endpoint TTLs.
///
/// These are separate constants rather than one global TTL because the
/// endpoints tolerate staleness very differently. A leaderboard that is a few
/// seconds behind is fine — deltas over WebSocket (Issue #900) carry the
/// urgent updates anyway. A wallet balance that is thirty seconds behind is a
/// support ticket, so it is not cached here at all.
pub mod policies {
    use super::CachePolicy;
    use std::time::Duration;

    /// Leaderboard pages: heavy query, high traffic, tolerant of lag.
    pub const LEADERBOARD: CachePolicy =
        CachePolicy::new(Duration::from_secs(15), Duration::from_secs(45));

    /// A single player's stats — cheaper to compute, read on every profile view.
    pub const PLAYER_STATS: CachePolicy =
        CachePolicy::new(Duration::from_secs(30), Duration::from_secs(60));

    /// Tournament listings change only when an organiser edits them.
    pub const TOURNAMENT_LIST: CachePolicy =
        CachePolicy::new(Duration::from_secs(60), Duration::from_secs(120));

    /// Achievement definitions are effectively static.
    pub const ACHIEVEMENT_CATALOG: CachePolicy =
        CachePolicy::new(Duration::from_secs(600), Duration::from_secs(600));
}

/// Cache hit/miss counters (Issue #910).
///
/// Plain atomics rather than the Prometheus registry so the cache can be used
/// from contexts that do not have it wired up; `snapshot` is what the metrics
/// endpoint reads.
#[derive(Debug, Default)]
pub struct CacheMetrics {
    hits: AtomicU64,
    stale_hits: AtomicU64,
    misses: AtomicU64,
    errors: AtomicU64,
}

/// Point-in-time copy of the counters.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct CacheMetricsSnapshot {
    pub hits: u64,
    pub stale_hits: u64,
    pub misses: u64,
    pub errors: u64,
}

impl CacheMetricsSnapshot {
    /// Hit rate over all lookups, counting stale hits as hits — they did serve
    /// the reader without a database round trip, which is what the rate is
    /// measuring.
    pub fn hit_rate(&self) -> f64 {
        let total = self.hits + self.stale_hits + self.misses;
        if total == 0 {
            return 0.0;
        }
        (self.hits + self.stale_hits) as f64 / total as f64
    }
}

impl CacheMetrics {
    pub fn snapshot(&self) -> CacheMetricsSnapshot {
        CacheMetricsSnapshot {
            hits: self.hits.load(Ordering::Relaxed),
            stale_hits: self.stale_hits.load(Ordering::Relaxed),
            misses: self.misses.load(Ordering::Relaxed),
            errors: self.errors.load(Ordering::Relaxed),
        }
    }
}

/// What a lookup found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheStatus {
    /// Within `fresh_for` — serve it.
    Fresh,
    /// Past `fresh_for` but within `stale_for` — serve it and refresh behind.
    Stale,
}

/// A cached value plus how fresh it is.
#[derive(Debug, Clone)]
pub struct CacheHit<T> {
    pub value: T,
    pub status: CacheStatus,
}

/// The stored envelope. `stored_at` is a unix timestamp in seconds rather than
/// an `Instant` because it has to survive a round trip through Redis and be
/// comparable across processes.
#[derive(Debug, Serialize, Deserialize)]
struct CacheEnvelope {
    stored_at: i64,
    payload: String,
}

/// Redis-backed response cache.
#[derive(Clone)]
pub struct ResponseCache {
    redis: ConnectionManager,
    metrics: Arc<CacheMetrics>,
    /// Prefixed so cache keys never collide with pub/sub channels, session
    /// state, or rate-limit counters in the same Redis instance.
    namespace: String,
}

impl ResponseCache {
    pub fn new(redis: ConnectionManager) -> Self {
        Self {
            redis,
            metrics: Arc::new(CacheMetrics::default()),
            namespace: "cache:v1".to_string(),
        }
    }

    pub fn metrics(&self) -> CacheMetricsSnapshot {
        self.metrics.snapshot()
    }

    fn qualified(&self, key: &str) -> String {
        format!("{}:{}", self.namespace, key)
    }

    fn tag_key(&self, tag: &str) -> String {
        format!("{}:tag:{}", self.namespace, tag)
    }

    /// Reads a cached value.
    ///
    /// Returns `None` on a miss *and* on any Redis error: a cache that is down
    /// must degrade into "no cache", never into a failed request. Errors are
    /// counted and logged so an outage is visible rather than silent.
    pub async fn get<T: DeserializeOwned>(
        &self,
        key: &str,
        policy: CachePolicy,
    ) -> Option<CacheHit<T>> {
        let mut conn = self.redis.clone();
        let raw: Option<String> = match conn.get(self.qualified(key)).await {
            Ok(v) => v,
            Err(e) => {
                self.metrics.errors.fetch_add(1, Ordering::Relaxed);
                warn!(key = %key, error = %e, "Cache read failed; falling through to origin");
                return None;
            }
        };

        let raw = match raw {
            Some(r) => r,
            None => {
                self.metrics.misses.fetch_add(1, Ordering::Relaxed);
                return None;
            }
        };

        let envelope: CacheEnvelope = match serde_json::from_str(&raw) {
            Ok(e) => e,
            Err(e) => {
                // A shape change between deploys lands here. Treat it as a miss
                // rather than an error the caller has to handle.
                self.metrics.misses.fetch_add(1, Ordering::Relaxed);
                debug!(key = %key, error = %e, "Discarding unreadable cache entry");
                return None;
            }
        };

        let value: T = match serde_json::from_str(&envelope.payload) {
            Ok(v) => v,
            Err(e) => {
                self.metrics.misses.fetch_add(1, Ordering::Relaxed);
                debug!(key = %key, error = %e, "Discarding cache entry of the wrong type");
                return None;
            }
        };

        let age = Duration::from_secs(
            (chrono::Utc::now().timestamp() - envelope.stored_at).max(0) as u64,
        );

        if age < policy.fresh_for {
            self.metrics.hits.fetch_add(1, Ordering::Relaxed);
            Some(CacheHit {
                value,
                status: CacheStatus::Fresh,
            })
        } else {
            self.metrics.stale_hits.fetch_add(1, Ordering::Relaxed);
            Some(CacheHit {
                value,
                status: CacheStatus::Stale,
            })
        }
    }

    /// Stores a value and associates it with `tags` for later invalidation.
    pub async fn set<T: Serialize>(
        &self,
        key: &str,
        value: &T,
        policy: CachePolicy,
        tags: &[String],
    ) {
        let payload = match serde_json::to_string(value) {
            Ok(p) => p,
            Err(e) => {
                warn!(key = %key, error = %e, "Refusing to cache unserialisable value");
                return;
            }
        };

        let envelope = CacheEnvelope {
            stored_at: chrono::Utc::now().timestamp(),
            payload,
        };

        let encoded = match serde_json::to_string(&envelope) {
            Ok(e) => e,
            Err(_) => return,
        };

        let qualified = self.qualified(key);
        let mut conn = self.redis.clone();

        // The Redis TTL covers fresh + stale, so an entry nobody reads expires
        // on its own and the tag sets do not accumulate dead keys forever.
        let ttl_secs = policy.total_ttl().as_secs().max(1);
        if let Err(e) = conn
            .set_ex::<_, _, ()>(&qualified, encoded, ttl_secs)
            .await
        {
            self.metrics.errors.fetch_add(1, Ordering::Relaxed);
            warn!(key = %key, error = %e, "Cache write failed");
            return;
        }

        for tag in tags {
            let tag_key = self.tag_key(tag);
            if let Err(e) = conn.sadd::<_, _, ()>(&tag_key, &qualified).await {
                warn!(tag = %tag, error = %e, "Failed to tag cache entry");
                continue;
            }
            // Keep the tag set from outliving its members indefinitely. Bounded
            // generously: the set is cheap and a premature expiry would strand
            // entries that can then only age out on their own TTL.
            let _ = conn
                .expire::<_, ()>(&tag_key, (ttl_secs * 4) as i64)
                .await;
        }
    }

    /// Drops every entry carrying `tag`. Call this from write paths.
    pub async fn invalidate_tag(&self, tag: &str) {
        let mut conn = self.redis.clone();
        let tag_key = self.tag_key(tag);

        let members: Vec<String> = match conn.smembers(&tag_key).await {
            Ok(m) => m,
            Err(e) => {
                self.metrics.errors.fetch_add(1, Ordering::Relaxed);
                warn!(tag = %tag, error = %e, "Cache invalidation failed to read tag set");
                return;
            }
        };

        if !members.is_empty() {
            if let Err(e) = conn.del::<_, ()>(members.clone()).await {
                self.metrics.errors.fetch_add(1, Ordering::Relaxed);
                warn!(tag = %tag, error = %e, "Cache invalidation failed to delete entries");
                return;
            }
        }

        let _ = conn.del::<_, ()>(&tag_key).await;
        debug!(tag = %tag, entries = members.len(), "Invalidated cache tag");
    }

    /// Invalidates several tags in one call.
    pub async fn invalidate_tags(&self, tags: &[String]) {
        for tag in tags {
            self.invalidate_tag(tag).await;
        }
    }

    /// Read-through helper: serve from cache, otherwise compute and store.
    ///
    /// On a stale hit the caller gets the stale value immediately and `compute`
    /// runs in a spawned task to refresh the entry — the stale-while-revalidate
    /// behaviour the issue asks for. Exactly one refresh runs per stale entry
    /// because the refresh takes a short Redis lock; the rest of the concurrent
    /// readers see the lock held and just serve stale.
    pub async fn get_or_compute<T, F, Fut, E>(
        &self,
        key: &str,
        policy: CachePolicy,
        tags: &[String],
        compute: F,
    ) -> Result<T, E>
    where
        T: Serialize + DeserializeOwned + Send + Clone + 'static,
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<T, E>> + Send,
    {
        if let Some(hit) = self.get::<T>(key, policy).await {
            if hit.status == CacheStatus::Stale {
                self.spawn_refresh(key.to_string(), policy, tags.to_vec(), compute);
            }
            return Ok(hit.value);
        }

        let value = compute().await?;
        self.set(key, &value, policy, tags).await;
        Ok(value)
    }

    /// Refreshes a stale entry in the background, at most one refresh per key.
    fn spawn_refresh<T, F, Fut, E>(
        &self,
        key: String,
        policy: CachePolicy,
        tags: Vec<String>,
        compute: F,
    ) where
        T: Serialize + DeserializeOwned + Send + Clone + 'static,
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<T, E>> + Send,
    {
        let cache = self.clone();
        tokio::spawn(async move {
            if !cache.try_lock_refresh(&key, policy).await {
                return; // Another worker is already refreshing this key.
            }

            match compute().await {
                Ok(value) => cache.set(&key, &value, policy, &tags).await,
                Err(_) => {
                    // The stale entry stays in place and will be retried on the
                    // next read. Losing a refresh is strictly better than
                    // evicting a usable value because the origin hiccuped.
                    debug!(key = %key, "Background cache refresh failed; keeping stale entry");
                }
            }
        });
    }

    /// Takes a short-lived refresh lock. Returns false if someone else holds it.
    async fn try_lock_refresh(&self, key: &str, policy: CachePolicy) -> bool {
        let mut conn = self.redis.clone();
        let lock_key = format!("{}:refresh:{}", self.namespace, key);

        // The lock expires on its own so a worker that dies mid-refresh does
        // not wedge the key until its TTL runs out.
        let acquired: Result<bool, _> = redis::cmd("SET")
            .arg(&lock_key)
            .arg("1")
            .arg("NX")
            .arg("EX")
            .arg(policy.stale_for.as_secs().max(1))
            .query_async(&mut conn)
            .await;

        acquired.unwrap_or(false)
    }
}

/// Cache key and tag construction.
///
/// Centralised so a write path and a read path cannot drift into disagreeing
/// about what a key looks like — a bug that shows up as a cache that never
/// invalidates, which is close to invisible in testing.
pub mod keys {
    use uuid::Uuid;

    pub fn leaderboard(category: &str, limit: i64, offset: i64) -> String {
        format!("leaderboard:{}:{}:{}", category, limit, offset)
    }

    pub fn player_stats(user_id: &Uuid) -> String {
        format!("player_stats:{}", user_id)
    }

    pub fn tournament_list(status: &str, page: i64) -> String {
        format!("tournaments:{}:{}", status, page)
    }

    /// Tag covering everything derived from one player.
    pub fn player_tag(user_id: &Uuid) -> String {
        format!("player:{}", user_id)
    }

    /// Tag covering every cached page of one game's leaderboard.
    pub fn leaderboard_tag(category: &str) -> String {
        format!("leaderboard:{}", category)
    }

    pub fn tournament_tag(tournament_id: &Uuid) -> String {
        format!("tournament:{}", tournament_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hit_rate_counts_stale_hits_as_hits() {
        let snapshot = CacheMetricsSnapshot {
            hits: 6,
            stale_hits: 2,
            misses: 2,
            errors: 0,
        };
        // A stale hit still spared the database a query.
        assert!((snapshot.hit_rate() - 0.8).abs() < f64::EPSILON);
    }

    #[test]
    fn hit_rate_of_an_unused_cache_is_zero_not_nan() {
        assert_eq!(CacheMetricsSnapshot::default().hit_rate(), 0.0);
    }

    #[test]
    fn total_ttl_covers_both_windows() {
        let policy = CachePolicy::new(Duration::from_secs(15), Duration::from_secs(45));
        assert_eq!(policy.total_ttl(), Duration::from_secs(60));
    }

    #[test]
    fn policies_allow_more_staleness_the_less_the_data_moves() {
        assert!(policies::LEADERBOARD.fresh_for < policies::TOURNAMENT_LIST.fresh_for);
        assert!(policies::TOURNAMENT_LIST.fresh_for < policies::ACHIEVEMENT_CATALOG.fresh_for);
    }

    #[test]
    fn leaderboard_pages_are_distinct_keys_under_one_tag() {
        let page_one = keys::leaderboard("fifa", 50, 0);
        let page_two = keys::leaderboard("fifa", 50, 50);

        assert_ne!(page_one, page_two, "pages must cache separately");
        // …but one tag drops them both, which is what makes invalidating a
        // whole board on a rank change a single call.
        assert_eq!(keys::leaderboard_tag("fifa"), "leaderboard:fifa");
    }

    #[test]
    fn player_tag_is_stable_for_a_user() {
        let user = Uuid::new_v4();
        assert_eq!(keys::player_tag(&user), keys::player_tag(&user));
    }
}
