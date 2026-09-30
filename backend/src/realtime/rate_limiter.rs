//! Per-connection WebSocket message rate limiting (#1083).
//!
//! HTTP requests get `RateLimitMiddleware`, but that middleware only runs on
//! the upgrade handshake — every message sent over an already-open WebSocket
//! bypasses it entirely. A client sending thousands of messages/second can
//! burn CPU and memory in the actor thread pool with nothing to stop it.
//!
//! Design:
//! - A token bucket sized to the full per-minute quota (default 60, so the
//!   bucket *is* the burst allowance — a connection can spend its whole
//!   minute's budget immediately, which is what makes this a token bucket
//!   rather than a strict per-second cap) refilling continuously at
//!   `messages_per_minute / 60` tokens/sec.
//! - Exceeding it throttles (drops the message, replies with a `rate_limit`
//!   notice) rather than disconnecting immediately.
//! - Only after 3 separate throttling events inside a trailing 5-minute
//!   window does the connection get dropped, with close code 4429.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Default sustained rate: `WS_RATE_LIMIT_MESSAGES_PER_MINUTE` env var.
pub const DEFAULT_MESSAGES_PER_MINUTE: u32 = 60;
/// Seconds a throttled client is told to wait before retrying.
pub const RETRY_AFTER_SECS: u64 = 30;
/// Repeated-violation window and threshold before the connection is closed.
const VIOLATION_WINDOW: Duration = Duration::from_secs(5 * 60);
const VIOLATIONS_BEFORE_DISCONNECT: usize = 3;
/// Close code sent when a connection is dropped for repeated flooding.
pub const RATE_LIMIT_CLOSE_CODE: u16 = 4429;

fn env_u32(key: &str, default: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}

/// A simple token bucket. Time is passed in explicitly (rather than always
/// reading `Instant::now()`) so tests can drive it with a synthetic clock.
#[derive(Debug)]
struct TokenBucket {
    capacity: f64,
    refill_per_sec: f64,
    tokens: f64,
    last_refill: Instant,
}

impl TokenBucket {
    fn new(capacity: f64, refill_per_sec: f64, now: Instant) -> Self {
        Self {
            capacity,
            refill_per_sec,
            tokens: capacity,
            last_refill: now,
        }
    }

    /// Refills based on elapsed time, then consumes one token if available.
    fn try_consume_at(&mut self, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.last_refill).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        self.last_refill = now;

        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// What to do with the message that was just checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateLimitOutcome {
    /// Under the limit — process the message normally.
    Allowed,
    /// Over the limit — drop the message and tell the client to slow down.
    Throttled { retry_after_secs: u64 },
    /// Over the limit for the 3rd time in 5 minutes — close the connection.
    DisconnectRequired,
}

/// Per-connection rate limiter: one of these lives on each `UserWebSocket` actor.
#[derive(Debug)]
pub struct ConnectionRateLimiter {
    bucket: TokenBucket,
    /// Timestamps of recent throttle events, pruned to `VIOLATION_WINDOW`.
    recent_violations: VecDeque<Instant>,
}

impl ConnectionRateLimiter {
    pub fn new(messages_per_minute: u32) -> Self {
        Self::new_at(messages_per_minute, Instant::now())
    }

    fn new_at(messages_per_minute: u32, now: Instant) -> Self {
        let capacity = messages_per_minute.max(1) as f64;
        let refill_per_sec = capacity / 60.0;
        Self {
            bucket: TokenBucket::new(capacity, refill_per_sec, now),
            recent_violations: VecDeque::new(),
        }
    }

    /// Reads `WS_RATE_LIMIT_MESSAGES_PER_MINUTE`, defaulting to 60 (#1083).
    pub fn from_env() -> Self {
        Self::new(env_u32(
            "WS_RATE_LIMIT_MESSAGES_PER_MINUTE",
            DEFAULT_MESSAGES_PER_MINUTE,
        ))
    }

    pub fn check(&mut self) -> RateLimitOutcome {
        self.check_at(Instant::now())
    }

    fn check_at(&mut self, now: Instant) -> RateLimitOutcome {
        if self.bucket.try_consume_at(now) {
            return RateLimitOutcome::Allowed;
        }

        // Drop violations older than the trailing window, then record this one.
        while matches!(self.recent_violations.front(), Some(t) if now.saturating_duration_since(*t) > VIOLATION_WINDOW)
        {
            self.recent_violations.pop_front();
        }
        self.recent_violations.push_back(now);

        if self.recent_violations.len() >= VIOLATIONS_BEFORE_DISCONNECT {
            RateLimitOutcome::DisconnectRequired
        } else {
            RateLimitOutcome::Throttled {
                retry_after_secs: RETRY_AFTER_SECS,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_up_to_the_per_minute_budget_in_a_burst() {
        // 70 messages sent effectively at once (no time elapses between
        // them, same as a client flooding as fast as it can): the first 60
        // (the full per-minute budget) are allowed, the next 10 are
        // throttled — and throttling never disconnects on the first
        // violation (#1083).
        let now = Instant::now();
        let mut limiter = ConnectionRateLimiter::new_at(60, now);

        let mut allowed = 0;
        let mut throttled = 0;
        for _ in 0..70 {
            match limiter.check_at(now) {
                RateLimitOutcome::Allowed => allowed += 1,
                RateLimitOutcome::Throttled { retry_after_secs } => {
                    assert_eq!(retry_after_secs, RETRY_AFTER_SECS);
                    throttled += 1;
                }
                RateLimitOutcome::DisconnectRequired => {
                    panic!("must not disconnect on the first burst of violations")
                }
            }
        }

        assert_eq!(allowed, 60);
        assert_eq!(throttled, 10);
    }

    #[test]
    fn refills_over_time_at_the_configured_rate() {
        let now = Instant::now();
        let mut limiter = ConnectionRateLimiter::new_at(60, now); // 1 token/sec

        for _ in 0..60 {
            assert_eq!(limiter.check_at(now), RateLimitOutcome::Allowed);
        }
        assert!(matches!(limiter.check_at(now), RateLimitOutcome::Throttled { .. }));

        // One second later, exactly one more token has refilled.
        let later = now + Duration::from_secs(1);
        assert_eq!(limiter.check_at(later), RateLimitOutcome::Allowed);
        assert!(matches!(limiter.check_at(later), RateLimitOutcome::Throttled { .. }));
    }

    #[test]
    fn disconnects_after_three_violations_within_five_minutes() {
        let now = Instant::now();
        let mut limiter = ConnectionRateLimiter::new_at(1, now); // easy to exhaust

        assert_eq!(limiter.check_at(now), RateLimitOutcome::Allowed);
        assert!(matches!(limiter.check_at(now), RateLimitOutcome::Throttled { .. })); // violation 1
        assert!(matches!(limiter.check_at(now), RateLimitOutcome::Throttled { .. })); // violation 2
        assert_eq!(limiter.check_at(now), RateLimitOutcome::DisconnectRequired); // violation 3
    }

    #[test]
    fn violations_older_than_five_minutes_do_not_count_toward_disconnect() {
        let now = Instant::now();
        let mut limiter = ConnectionRateLimiter::new_at(1, now);

        let _ = limiter.check_at(now); // consumes the only token
        assert!(matches!(limiter.check_at(now), RateLimitOutcome::Throttled { .. })); // violation 1
        assert!(matches!(limiter.check_at(now), RateLimitOutcome::Throttled { .. })); // violation 2

        // Violation 1 and 2 age out; the bucket also refills fully by then.
        let much_later = now + Duration::from_secs(6 * 60);
        assert_eq!(limiter.check_at(much_later), RateLimitOutcome::Allowed);
        assert!(matches!(
            limiter.check_at(much_later),
            RateLimitOutcome::Throttled { .. }
        )); // violation 1 of a fresh window, not violation 3
    }
}
