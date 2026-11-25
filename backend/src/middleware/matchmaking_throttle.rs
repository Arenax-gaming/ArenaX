//! Per-user throttle for matchmaking join requests (#1522).
//!
//! A user may submit one join request every [`JOIN_THROTTLE_WINDOW_SECS`]
//! seconds. The budget is a one-token bucket: `SET key 1 NX EX 30` consumes
//! the token and the key's TTL is the refill time, so the state lives in Redis
//! and survives a process restart. Because it is a single key per user, one
//! throttled player never affects another.
//!
//! The bucket is refilled by deleting the key when the player cancels their
//! queued join or when the matchmaker finds them a match.
//!
//! Redis errors **fail open**, matching `middleware::rate_limit`: a broken
//! cache must not stop players from joining at all.

use async_trait::async_trait;
use chrono::Utc;
use redis::aio::ConnectionManager;
use tracing::warn;
use uuid::Uuid;

use crate::api_error::ApiError;

/// Window in seconds: one join per user per window.
pub const JOIN_THROTTLE_WINDOW_SECS: u64 = 30;

const THROTTLE_KEY_PREFIX: &str = "matchmaking:join_throttle";
const THROTTLE_LIMIT: u64 = 1;

/// Redis key holding one user's single join token.
pub fn throttle_key(user_id: Uuid) -> String {
    format!("{THROTTLE_KEY_PREFIX}:{user_id}")
}

/// Storage seam so the throttle rules can be tested without a live Redis.
#[async_trait]
pub trait JoinThrottleStore: Send + Sync {
    /// Consume this user's token. `Ok(None)` means allowed; `Ok(Some(secs))`
    /// means throttled with the seconds until the token is refilled.
    async fn try_acquire(&self, user_id: Uuid) -> Result<Option<u64>, String>;

    /// Refill the token (cancel or match found).
    async fn reset(&self, user_id: Uuid) -> Result<(), String>;
}

/// Production store backed by the shared Redis connection manager.
pub struct RedisJoinThrottle {
    redis: ConnectionManager,
}

impl RedisJoinThrottle {
    pub fn new(redis: ConnectionManager) -> Self {
        Self { redis }
    }
}

#[async_trait]
impl JoinThrottleStore for RedisJoinThrottle {
    async fn try_acquire(&self, user_id: Uuid) -> Result<Option<u64>, String> {
        let mut conn = self.redis.clone();
        try_acquire_redis(&mut conn, user_id).await
    }

    async fn reset(&self, user_id: Uuid) -> Result<(), String> {
        let mut conn = self.redis.clone();
        reset_redis(&mut conn, user_id).await
    }
}

async fn try_acquire_redis(
    conn: &mut ConnectionManager,
    user_id: Uuid,
) -> Result<Option<u64>, String> {
    let key = throttle_key(user_id);

    // SET NX is the atomic check-and-consume: exactly one caller wins.
    let acquired: Option<String> = redis::cmd("SET")
        .arg(&key)
        .arg(1u8)
        .arg("NX")
        .arg("EX")
        .arg(JOIN_THROTTLE_WINDOW_SECS)
        .query_async(conn)
        .await
        .map_err(|e| format!("SET {key}: {e}"))?;

    if acquired.is_some() {
        return Ok(None);
    }

    let ttl: i64 = redis::cmd("TTL")
        .arg(&key)
        .query_async(conn)
        .await
        .map_err(|e| format!("TTL {key}: {e}"))?;

    // A missing expiry (or a key that vanished between calls) is treated as a
    // full window rather than an immediate retry.
    Ok(Some(if ttl > 0 {
        ttl as u64
    } else {
        JOIN_THROTTLE_WINDOW_SECS
    }))
}

async fn reset_redis(conn: &mut ConnectionManager, user_id: Uuid) -> Result<(), String> {
    let key = throttle_key(user_id);
    redis::cmd("DEL")
        .arg(&key)
        .query_async::<i64>(conn)
        .await
        .map_err(|e| format!("DEL {key}: {e}"))?;
    Ok(())
}

/// Consume a join token or return the structured 429.
///
/// On a Redis failure the request is allowed (fail open) and a warning is
/// logged; see the module docs.
pub async fn check_join<S: JoinThrottleStore + ?Sized>(
    store: &S,
    user_id: Uuid,
) -> Result<(), ApiError> {
    match store.try_acquire(user_id).await {
        Ok(None) => Ok(()),
        Ok(Some(retry_after_seconds)) => {
            let retry_after_seconds = retry_after_seconds.max(1);
            let now = Utc::now();
            warn!(
                user_id = %user_id,
                timestamp = %now.to_rfc3339(),
                retry_after_seconds,
                "Matchmaking join throttled"
            );

            Err(ApiError::TooManyRequests {
                message: format!(
                    "only {THROTTLE_LIMIT} matchmaking join allowed per {JOIN_THROTTLE_WINDOW_SECS} seconds"
                ),
                limit: THROTTLE_LIMIT,
                remaining: 0,
                reset: now.timestamp().max(0) as u64 + retry_after_seconds,
                retry_after: retry_after_seconds,
            })
        }
        Err(error) => {
            warn!(
                user_id = %user_id,
                error = %error,
                "Matchmaking throttle Redis error — failing open"
            );
            Ok(())
        }
    }
}

/// Refill a user's token on a path that must not fail because of Redis (cancel
/// or match found). Errors are logged and swallowed.
pub async fn refill(conn: &mut ConnectionManager, user_id: Uuid) {
    if let Err(error) = reset_redis(conn, user_id).await {
        warn!(
            user_id = %user_id,
            error = %error,
            "Matchmaking throttle refill failed — continuing"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::ResponseError;
    use std::collections::HashMap;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    /// In-memory one-token bucket mirroring the Redis semantics.
    #[derive(Default)]
    struct FakeThrottle {
        tokens: Mutex<HashMap<Uuid, Instant>>,
    }

    #[async_trait]
    impl JoinThrottleStore for FakeThrottle {
        async fn try_acquire(&self, user_id: Uuid) -> Result<Option<u64>, String> {
            let mut tokens = self.tokens.lock().unwrap();
            let window = Duration::from_secs(JOIN_THROTTLE_WINDOW_SECS);
            match tokens.get(&user_id) {
                Some(at) if at.elapsed() < window => {
                    Ok(Some((window - at.elapsed()).as_secs().max(1)))
                }
                _ => {
                    tokens.insert(user_id, Instant::now());
                    Ok(None)
                }
            }
        }

        async fn reset(&self, user_id: Uuid) -> Result<(), String> {
            self.tokens.lock().unwrap().remove(&user_id);
            Ok(())
        }
    }

    struct FailingThrottle;

    #[async_trait]
    impl JoinThrottleStore for FailingThrottle {
        async fn try_acquire(&self, _user_id: Uuid) -> Result<Option<u64>, String> {
            Err("redis unreachable".to_string())
        }

        async fn reset(&self, _user_id: Uuid) -> Result<(), String> {
            Err("redis unreachable".to_string())
        }
    }

    fn retry_after(err: &ApiError) -> u64 {
        match err {
            ApiError::TooManyRequests { retry_after, .. } => *retry_after,
            other => panic!("expected TooManyRequests, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_second_join_within_thirty_seconds_is_rejected() {
        let store = FakeThrottle::default();
        let user = Uuid::new_v4();

        check_join(&store, user).await.expect("first join allowed");
        let err = check_join(&store, user)
            .await
            .expect_err("second join throttled");

        assert!((1..=JOIN_THROTTLE_WINDOW_SECS).contains(&retry_after(&err)));
    }

    #[tokio::test]
    async fn the_rejection_body_carries_retry_after_seconds() {
        let store = FakeThrottle::default();
        let user = Uuid::new_v4();
        check_join(&store, user).await.unwrap();

        let err = check_join(&store, user).await.unwrap_err();
        let response = err.error_response();
        assert_eq!(response.status().as_u16(), 429);

        let retry_header = response
            .headers()
            .get("Retry-After")
            .expect("Retry-After header")
            .to_str()
            .unwrap()
            .parse::<u64>()
            .unwrap();

        let body = actix_web::body::to_bytes(response.into_body())
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        let retry = json["retryAfterSeconds"]
            .as_u64()
            .expect("retryAfterSeconds in body");
        assert_eq!(retry, retry_header);
        assert!((1..=JOIN_THROTTLE_WINDOW_SECS).contains(&retry));
        assert_eq!(json["code"], 429);
    }

    #[tokio::test]
    async fn other_users_are_unaffected() {
        let store = FakeThrottle::default();
        let throttled = Uuid::new_v4();
        let other = Uuid::new_v4();

        check_join(&store, throttled).await.unwrap();
        assert!(check_join(&store, throttled).await.is_err());

        check_join(&store, other)
            .await
            .expect("a different user still has their own token");
    }

    #[tokio::test]
    async fn a_cancel_refills_the_token() {
        let store = FakeThrottle::default();
        let user = Uuid::new_v4();

        check_join(&store, user).await.unwrap();
        store.reset(user).await.expect("cancel refills");
        check_join(&store, user)
            .await
            .expect("join allowed again after cancel");
    }

    #[tokio::test]
    async fn a_match_found_refills_the_token() {
        let store = FakeThrottle::default();
        let user = Uuid::new_v4();

        check_join(&store, user).await.unwrap();
        // The matchmaker calls the same reset when it removes a matched player.
        store.reset(user).await.expect("match found refills");
        check_join(&store, user)
            .await
            .expect("join allowed again after a match");
    }

    #[tokio::test]
    async fn redis_errors_fail_open() {
        let user = Uuid::new_v4();
        check_join(&FailingThrottle, user)
            .await
            .expect("a Redis outage must not block joins");
    }

    #[test]
    fn the_key_is_namespaced_per_user() {
        let user = Uuid::new_v4();
        let key = throttle_key(user);
        assert!(key.starts_with("matchmaking:join_throttle:"));
        assert!(key.ends_with(&user.to_string()));
        assert_ne!(key, throttle_key(Uuid::new_v4()));
    }

    /// Exercises the real Redis commands when a test Redis is configured;
    /// skipped otherwise, like the repo's other Redis-backed tests.
    #[tokio::test]
    async fn redis_bucket_survives_a_new_connection_and_refills() {
        let Ok(url) = std::env::var("TEST_REDIS_URL") else {
            return;
        };
        let client = redis::Client::open(url).expect("test Redis URL");
        let conn = ConnectionManager::new(client.clone())
            .await
            .expect("test Redis connection");
        let user = Uuid::new_v4();
        let key = throttle_key(user);

        let mut cleanup = conn.clone();
        let _: i64 = redis::cmd("DEL")
            .arg(&key)
            .query_async(&mut cleanup)
            .await
            .unwrap();

        let first = RedisJoinThrottle::new(conn);
        assert_eq!(first.try_acquire(user).await.unwrap(), None);

        // A new connection manager stands in for a restarted process: only
        // Redis holds the token.
        let restarted = RedisJoinThrottle::new(
            ConnectionManager::new(client)
                .await
                .expect("second test Redis connection"),
        );
        let retry = restarted
            .try_acquire(user)
            .await
            .unwrap()
            .expect("token survived the restart");
        assert!((1..=JOIN_THROTTLE_WINDOW_SECS).contains(&retry));

        restarted.reset(user).await.unwrap();
        assert_eq!(restarted.try_acquire(user).await.unwrap(), None);

        let _: i64 = redis::cmd("DEL")
            .arg(&key)
            .query_async(&mut cleanup)
            .await
            .unwrap();
    }
}
