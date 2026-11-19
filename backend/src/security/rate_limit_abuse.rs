//! Rate-limit bypass detection via rotating-IP patterns (Issue #1573).
//!
//! Some clients rotate IPs or use proxies to bypass the per-identity sliding
//! window in `middleware::rate_limit`. Because authenticated requests are
//! keyed on user ID there, a user who racks up 429s from many *different*
//! IPs within a short window is a strong rotating-IP signal even though no
//! single IP ever crosses its own limit. This module tracks that pattern in
//! Redis and temporarily blocks the account when it's detected.

use redis::aio::ConnectionManager;
use tracing::warn;

use crate::service::stellar_sdk_service::{
    SecurityAlertChannel, SecurityAlertPayload, SecurityAlertSeverity,
};

/// Number of *distinct* IPs a user must rate-limit-hit from, within the
/// detection window, to be considered a rotating-IP bypass attempt.
/// A single user legitimately switching IPs once stays well under this.
pub const DISTINCT_IP_THRESHOLD: usize = 5;
/// Detection window, in seconds.
pub const DETECTION_WINDOW_SECS: u64 = 10 * 60;
/// How long a detected account is blocked for, in seconds.
pub const BLOCK_DURATION_SECS: u64 = 30 * 60;

fn hits_key(user_id: &str) -> String {
    format!("sec:rl_bypass_hits:{}", user_id)
}

fn block_key(user_id: &str) -> String {
    format!("sec:user_block:{}", user_id)
}

/// Record a rate-limit hit for `user_id` coming from `ip`. If the number of
/// distinct IPs that have hit the limiter for this user within
/// `DETECTION_WINDOW_SECS` now exceeds `DISTINCT_IP_THRESHOLD`, temporarily
/// block the account, log the detection, and emit a security alert.
///
/// Call this only when the caller actually exceeded its rate limit (a 429),
/// not on every request — otherwise ordinary multi-device usage would be
/// flagged.
///
/// Fails open on Redis errors: a monitoring outage must never itself become
/// an availability incident.
pub async fn record_hit_and_maybe_block(conn: &mut ConnectionManager, user_id: &str, ip: &str) {
    let key = hits_key(user_id);
    let now_ms = crate::middleware::now_ms();
    let window_start_ms = now_ms.saturating_sub(DETECTION_WINDOW_SECS * 1_000);

    // ZADD member=ip score=now_ms — re-hitting from the same IP just bumps
    // its score, so ZCARD below naturally counts *distinct* IPs, not raw
    // hit count.
    let pipeline_result: Result<(i64, i64, i64, i64), redis::RedisError> = redis::pipe()
        .atomic()
        .cmd("ZADD")
        .arg(&key)
        .arg(now_ms)
        .arg(ip)
        .cmd("ZREMRANGEBYSCORE")
        .arg(&key)
        .arg(0u64)
        .arg(window_start_ms)
        .cmd("ZCARD")
        .arg(&key)
        .cmd("EXPIRE")
        .arg(&key)
        .arg(DETECTION_WINDOW_SECS)
        .query_async(conn)
        .await;

    let distinct_ip_count = match pipeline_result {
        Ok((_, _, count, _)) => count,
        Err(e) => {
            warn!(
                error = %e,
                user_id = %user_id,
                "Rate-limit bypass detector Redis error — failing open"
            );
            return;
        }
    };

    if distinct_ip_count as usize <= DISTINCT_IP_THRESHOLD {
        return;
    }

    // Already blocked? Don't re-block / re-alert on every subsequent hit
    // while the existing block is still active.
    let block_k = block_key(user_id);
    let already_blocked: bool = redis::cmd("EXISTS")
        .arg(&block_k)
        .query_async(conn)
        .await
        .unwrap_or(false);
    if already_blocked {
        return;
    }

    let ips: Vec<String> = redis::cmd("ZRANGE")
        .arg(&key)
        .arg(0)
        .arg(-1)
        .query_async(conn)
        .await
        .unwrap_or_default();

    if let Err(e) = redis::cmd("SETEX")
        .arg(&block_k)
        .arg(BLOCK_DURATION_SECS)
        .arg("rate_limit_bypass")
        .query_async::<()>(conn)
        .await
    {
        warn!(error = %e, user_id = %user_id, "Failed to set account block key");
        return;
    }

    warn!(
        user_id = %user_id,
        ips = ?ips,
        block_duration_secs = BLOCK_DURATION_SECS,
        "Rotating-IP rate-limit bypass detected — account temporarily blocked"
    );

    let alert = SecurityAlertPayload {
        alert_type: "rate_limit_bypass".to_string(),
        severity: SecurityAlertSeverity::Critical,
        message: format!(
            "User {} triggered rate limits from {} distinct IPs within {} minutes; blocked for {} minutes",
            user_id,
            ips.len(),
            DETECTION_WINDOW_SECS / 60,
            BLOCK_DURATION_SECS / 60,
        ),
        metadata: serde_json::json!({
            "user_id": user_id,
            "ips": ips,
            "block_duration_secs": BLOCK_DURATION_SECS,
        }),
    };
    SecurityAlertChannel::from_env().send(&alert).await;
}

/// True if `user_id` is currently blocked due to rate-limit-bypass detection.
///
/// Fails open on Redis errors.
pub async fn is_user_blocked(conn: &mut ConnectionManager, user_id: &str) -> bool {
    redis::cmd("EXISTS")
        .arg(&block_key(user_id))
        .query_async(conn)
        .await
        .unwrap_or(false)
}

/// Remove an account block before its TTL elapses (e.g. an admin override).
pub async fn clear_block(
    conn: &mut ConnectionManager,
    user_id: &str,
) -> Result<(), redis::RedisError> {
    redis::cmd("DEL")
        .arg(&block_key(user_id))
        .query_async(conn)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_formatting() {
        assert_eq!(hits_key("abc"), "sec:rl_bypass_hits:abc");
        assert_eq!(block_key("abc"), "sec:user_block:abc");
    }

    #[test]
    fn thresholds_match_issue_spec() {
        assert_eq!(DISTINCT_IP_THRESHOLD, 5);
        assert_eq!(DETECTION_WINDOW_SECS, 600);
        assert_eq!(BLOCK_DURATION_SECS, 1800);
    }
}
