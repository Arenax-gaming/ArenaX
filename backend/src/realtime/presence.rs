//! WebSocket presence tracking for tournament lobbies — Issue #1362.
//!
//! # Problem
//! Tournament lobbies have no accurate view of which participants are
//! currently online, so ready-checks and match starts stall waiting for
//! players who have already left.
//!
//! # Solution
//! Maintain a Redis set per tournament containing the user IDs of connected
//! participants. On connect a user is `SADD`-ed; on clean disconnect or
//! heartbeat timeout the user is `SREM`-ed. The lobby view exposes the online
//! participant count (`SCARD`) and per-user presence flags (`SISMEMBER`).
//!
//! Stale connections (no heartbeat within the timeout window) are evicted by
//! `evict_stale`, which walks the set and removes any member whose heartbeat
//! key has expired. The timeout is configurable via
//! `PRESENCE_HEARTBEAT_TIMEOUT_SECS` (default 90s).
//!
//! # Redis layout
//! | Key | Type | TTL | Purpose |
//! |-----|------|-----|---------|
//! | `presence:tournament:{tid}` | SET | none | online user IDs |
//! | `presence:hb:{tid}:{uid}` | STRING | 2× timeout | last-heartbeat marker |

use crate::realtime::redis_client::RedisClient;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

// ── Configurable timeout ─────────────────────────────────────────────────────

/// Heartbeat timeout: a connection with no heartbeat in this window is
/// considered stale and evicted. Configurable via
/// `PRESENCE_HEARTBEAT_TIMEOUT_SECS` (default 90).
pub fn heartbeat_timeout() -> Duration {
    let secs = std::env::var("PRESENCE_HEARTBEAT_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(90u64);
    Duration::from_secs(secs)
}

/// Redis key for the presence set of a tournament.
pub fn presence_key(tournament_id: Uuid) -> String {
    format!("presence:tournament:{tournament_id}")
}

/// Redis key for the heartbeat marker of one user in one tournament.
pub fn heartbeat_key(tournament_id: Uuid, user_id: Uuid) -> String {
    format!("presence:hb:{tournament_id}:{user_id}")
}

// ── Wire types ───────────────────────────────────────────────────────────────

/// Presence snapshot for a lobby.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LobbyPresence {
    pub tournament_id: Uuid,
    pub online_count: usize,
    pub online_user_ids: Vec<Uuid>,
}

/// Per-user presence flag in a lobby.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserPresenceFlag {
    pub user_id: Uuid,
    pub is_online: bool,
}

/// Error type for presence operations.
#[derive(Debug, thiserror::Error)]
pub enum PresenceError {
    #[error("Redis error: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("Parse error: {0}")]
    Parse(String),
}

// ── Tracker ──────────────────────────────────────────────────────────────────

/// Tracks which users are currently online in each tournament lobby via Redis.
///
/// Construct one per process (or share via `Arc`) — all state lives in Redis so
/// multiple backend instances see the same presence view.
pub struct TournamentPresenceTracker {
    redis: Arc<RedisClient>,
}

impl TournamentPresenceTracker {
    pub fn new(redis: Arc<RedisClient>) -> Self {
        Self { redis }
    }

    // ── Connection lifecycle ─────────────────────────────────────────────────

    /// Called on WebSocket connect: add the user to the tournament presence
    /// set and set an initial heartbeat marker.
    pub async fn on_connect(
        &self,
        tournament_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), PresenceError> {
        // SADD presence:tournament:{tid} {uid}
        let key = presence_key(tournament_id);
        let _: i32 = redis::cmd("SADD")
            .arg(&key)
            .arg(user_id.to_string())
            .query_async(&mut self.redis.get_connection())
            .await?;

        // SET presence:hb:{tid}:{uid} "1" EX <2 × timeout>
        let hb_key = heartbeat_key(tournament_id, user_id);
        let ttl = heartbeat_timeout().as_secs() as usize * 2;
        self.redis.set_ex(&hb_key, "1", ttl).await?;

        Ok(())
    }

    /// Called on WebSocket disconnect (clean close or heartbeat timeout):
    /// remove the user from the presence set and clear the heartbeat marker.
    pub async fn on_disconnect(
        &self,
        tournament_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), PresenceError> {
        // SREM presence:tournament:{tid} {uid}
        let key = presence_key(tournament_id);
        let _: i32 = redis::cmd("SREM")
            .arg(&key)
            .arg(user_id.to_string())
            .query_async(&mut self.redis.get_connection())
            .await?;

        // DEL presence:hb:{tid}:{uid}
        let hb_key = heartbeat_key(tournament_id, user_id);
        self.redis.del(&hb_key).await?;

        Ok(())
    }

    /// Called on each heartbeat from the client: refresh the heartbeat TTL so
    /// the connection is not considered stale.
    pub async fn on_heartbeat(
        &self,
        tournament_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), PresenceError> {
        let hb_key = heartbeat_key(tournament_id, user_id);
        let ttl = heartbeat_timeout().as_secs() as usize * 2;
        self.redis.set_ex(&hb_key, "1", ttl).await?;
        Ok(())
    }

    // ── Stale eviction ───────────────────────────────────────────────────────

    /// Evict stale connections: users whose heartbeat key has expired but who
    /// are still in the presence set. Returns the count of evicted users.
    ///
    /// Call this on a schedule (e.g. every `heartbeat_timeout() / 2`) so a
    /// dirty disconnect (client crashed, network dropped) is eventually
    /// reflected in the lobby view.
    pub async fn evict_stale(
        &self,
        tournament_id: Uuid,
    ) -> Result<usize, PresenceError> {
        let members = self.get_online_user_ids(tournament_id).await?;
        let mut evicted = 0;
        for user_id in members {
            let hb_key = heartbeat_key(tournament_id, user_id);
            let alive = self.redis.exists(&hb_key).await?;
            if !alive {
                self.on_disconnect(tournament_id, user_id).await?;
                evicted += 1;
            }
        }
        Ok(evicted)
    }

    // ── Lobby view queries ───────────────────────────────────────────────────

    /// Get the online user IDs for a tournament lobby.
    pub async fn get_online_user_ids(
        &self,
        tournament_id: Uuid,
    ) -> Result<Vec<Uuid>, PresenceError> {
        let key = presence_key(tournament_id);
        let members: Vec<String> = redis::cmd("SMEMBERS")
            .arg(&key)
            .query_async(&mut self.redis.get_connection())
            .await?;
        members
            .into_iter()
            .map(|s| Uuid::parse_str(&s).map_err(|e| PresenceError::Parse(e.to_string())))
            .collect()
    }

    /// Get the online participant count for a tournament lobby (O(1) via
    /// `SCARD`).
    pub async fn get_online_count(
        &self,
        tournament_id: Uuid,
    ) -> Result<usize, PresenceError> {
        let key = presence_key(tournament_id);
        let count: i64 = redis::cmd("SCARD")
            .arg(&key)
            .query_async(&mut self.redis.get_connection())
            .await?;
        Ok(count as usize)
    }

    /// Get the full lobby presence snapshot — online count plus the list of
    /// online user IDs. Exposed to the lobby view.
    pub async fn get_lobby_presence(
        &self,
        tournament_id: Uuid,
    ) -> Result<LobbyPresence, PresenceError> {
        let online_user_ids = self.get_online_user_ids(tournament_id).await?;
        let online_count = online_user_ids.len();
        Ok(LobbyPresence {
            tournament_id,
            online_count,
            online_user_ids,
        })
    }

    /// Check whether a specific user is online in a tournament lobby.
    pub async fn is_online(
        &self,
        tournament_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, PresenceError> {
        let key = presence_key(tournament_id);
        let result: i32 = redis::cmd("SISMEMBER")
            .arg(&key)
            .arg(user_id.to_string())
            .query_async(&mut self.redis.get_connection())
            .await?;
        Ok(result == 1)
    }

    /// Get presence flags for a list of participant user IDs — used by the
    /// lobby view to mark each participant as online/offline.
    pub async fn get_presence_flags(
        &self,
        tournament_id: Uuid,
        participant_ids: &[Uuid],
    ) -> Result<Vec<UserPresenceFlag>, PresenceError> {
        let key = presence_key(tournament_id);
        let mut flags = Vec::with_capacity(participant_ids.len());
        for &user_id in participant_ids {
            let result: i32 = redis::cmd("SISMEMBER")
                .arg(&key)
                .arg(user_id.to_string())
                .query_async(&mut self.redis.get_connection())
                .await?;
            flags.push(UserPresenceFlag {
                user_id,
                is_online: result == 1,
            });
        }
        Ok(flags)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presence_key_format_is_stable() {
        let tid = Uuid::from_u128(0xdeadbeef);
        let key = presence_key(tid);
        assert!(key.starts_with("presence:tournament:"));
        assert!(key.contains(&tid.to_string()));
    }

    #[test]
    fn heartbeat_key_contains_both_ids() {
        let tid = Uuid::from_u128(1);
        let uid = Uuid::from_u128(2);
        let key = heartbeat_key(tid, uid);
        assert!(key.starts_with("presence:hb:"));
        assert!(key.contains(&tid.to_string()));
        assert!(key.contains(&uid.to_string()));
    }

    #[test]
    fn lobby_presence_serializes_roundtrip() {
        let presence = LobbyPresence {
            tournament_id: Uuid::from_u128(1),
            online_count: 3,
            online_user_ids: vec![
                Uuid::from_u128(10),
                Uuid::from_u128(20),
                Uuid::from_u128(30),
            ],
        };
        let json = serde_json::to_string(&presence).unwrap();
        let roundtrip: LobbyPresence = serde_json::from_str(&json).unwrap();
        assert_eq!(presence, roundtrip);
    }

    #[test]
    fn user_presence_flag_online_and_offline_distinct() {
        let uid = Uuid::new_v4();
        let online = UserPresenceFlag { user_id: uid, is_online: true };
        let offline = UserPresenceFlag { user_id: uid, is_online: false };
        assert!(online.is_online);
        assert!(!offline.is_online);
        assert_ne!(online, offline);
    }

    #[test]
    fn heartbeat_timeout_defaults_to_90s() {
        // Without env var set, default is 90s
        let timeout = heartbeat_timeout();
        assert_eq!(timeout, Duration::from_secs(90));
    }

    #[tokio::test]
    #[ignore] // requires Redis running
    async fn connect_disconnect_transitions_set_membership() {
        // This test verifies the full lifecycle:
        //   not online → connect → online → disconnect → not online.
        // Run with: cargo test -- --ignored connect_disconnect
        let redis = Arc::new(RedisClient::new("redis://127.0.0.1:6379").await.unwrap());
        let tracker = TournamentPresenceTracker::new(redis);
        let tournament_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();

        // Initially not online
        assert!(!tracker.is_online(tournament_id, user_id).await.unwrap());
        assert_eq!(tracker.get_online_count(tournament_id).await.unwrap(), 0);

        // Connect
        tracker.on_connect(tournament_id, user_id).await.unwrap();
        assert!(tracker.is_online(tournament_id, user_id).await.unwrap());
        assert_eq!(tracker.get_online_count(tournament_id).await.unwrap(), 1);

        // Lobby presence reflects the user
        let presence = tracker.get_lobby_presence(tournament_id).await.unwrap();
        assert_eq!(presence.online_count, 1);
        assert!(presence.online_user_ids.contains(&user_id));

        // Disconnect
        tracker.on_disconnect(tournament_id, user_id).await.unwrap();
        assert!(!tracker.is_online(tournament_id, user_id).await.unwrap());
        assert_eq!(tracker.get_online_count(tournament_id).await.unwrap(), 0);
    }

    #[tokio::test]
    #[ignore] // requires Redis running
    async fn heartbeat_refresh_keeps_user_online() {
        let redis = Arc::new(RedisClient::new("redis://127.0.0.1:6379").await.unwrap());
        let tracker = TournamentPresenceTracker::new(redis);
        let tournament_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();

        tracker.on_connect(tournament_id, user_id).await.unwrap();
        tracker.on_heartbeat(tournament_id, user_id).await.unwrap();
        assert!(tracker.is_online(tournament_id, user_id).await.unwrap());

        tracker.on_disconnect(tournament_id, user_id).await.unwrap();
    }

    #[tokio::test]
    #[ignore] // requires Redis running
    async fn evict_stale_removes_users_with_expired_heartbeats() {
        let redis = Arc::new(RedisClient::new("redis://127.0.0.1:6379").await.unwrap());
        let tracker = TournamentPresenceTracker::new(redis);
        let tournament_id = Uuid::new_v4();
        let stale_user = Uuid::new_v4();
        let live_user = Uuid::new_v4();

        // Both connect
        tracker.on_connect(tournament_id, stale_user).await.unwrap();
        tracker.on_connect(tournament_id, live_user).await.unwrap();

        // Simulate stale_user's heartbeat expiring by deleting the key directly
        let hb = heartbeat_key(tournament_id, stale_user);
        tracker.redis.del(&hb).await.unwrap();

        // live_user keeps heartbeating
        tracker.on_heartbeat(tournament_id, live_user).await.unwrap();

        // Evict stale
        let evicted = tracker.evict_stale(tournament_id).await.unwrap();
        assert_eq!(evicted, 1);

        assert!(!tracker.is_online(tournament_id, stale_user).await.unwrap());
        assert!(tracker.is_online(tournament_id, live_user).await.unwrap());
    }

    #[tokio::test]
    #[ignore] // requires Redis running
    async fn get_presence_flags_reports_online_and_offline_participants() {
        let redis = Arc::new(RedisClient::new("redis://127.0.0.1:6379").await.unwrap());
        let tracker = TournamentPresenceTracker::new(redis);
        let tournament_id = Uuid::new_v4();
        let online = Uuid::new_v4();
        let offline = Uuid::new_v4();

        tracker.on_connect(tournament_id, online).await.unwrap();

        let flags = tracker
            .get_presence_flags(tournament_id, &[online, offline])
            .await
            .unwrap();
        assert_eq!(flags.len(), 2);
        let online_flag = flags.iter().find(|f| f.user_id == online).unwrap();
        let offline_flag = flags.iter().find(|f| f.user_id == offline).unwrap();
        assert!(online_flag.is_online);
        assert!(!offline_flag.is_online);

        // Cleanup
        tracker.on_disconnect(tournament_id, online).await.unwrap();
    }
}
