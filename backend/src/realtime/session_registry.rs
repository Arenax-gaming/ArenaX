use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// Interval at which heartbeats are expected from connected clients (30s).
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

/// Number of consecutive missed heartbeats before closing a connection (3 missed beats).
pub const MISSED_HEARTBEAT_THRESHOLD: u32 = 3;

/// Total timeout duration before a connection is closed due to missed heartbeats (90s = 3 * 30s).
pub const CLIENT_TIMEOUT: Duration = Duration::from_secs(90);

/// Duration for which session subscriptions and state are preserved after disconnect for reconnect (60s).
pub const STATE_PRESERVATION_TTL: Duration = Duration::from_secs(60);

/// Maximum concurrent WebSocket connections allowed per individual user (5).
pub const MAX_CONNECTIONS_PER_USER: usize = 5;

/// Errors returned by SessionRegistry operations.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SessionError {
    #[error("Maximum connections ({0}) exceeded for user")]
    MaxConnectionsExceeded(usize),
    #[error("Session already exists")]
    AlreadyExists,
    #[error("Session not found")]
    NotFound,
    #[error("Reconnect window expired (state preserved for 60s)")]
    ReconnectExpired,
    #[error("User ID mismatch during reconnect")]
    UserMismatch,
}

/// Preserved session state available during the 60s reconnect window.
#[derive(Debug, Clone)]
pub struct PreservedSession {
    pub session_id: Uuid,
    pub user_id: Uuid,
    pub disconnected_at: Instant,
    pub channels: HashSet<String>,
}

/// Metrics tracking connection and reconnection events.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReconnectMetrics {
    pub reconnect_count: u64,
    pub reconnect_failures: u64,
    pub reconnect_expired: u64,
}

/// Thread-safe registry mapping user IDs to their active WebSocket session IDs,
/// tracking channel subscriptions for event routing, managing heartbeat timeouts,
/// enforcing per-user connection limits, and preserving session state during reconnects.
pub struct SessionRegistry {
    user_to_sessions: RwLock<HashMap<Uuid, HashSet<Uuid>>>,
    channel_to_sessions: RwLock<HashMap<String, HashSet<Uuid>>>,
    session_to_channels: RwLock<HashMap<Uuid, HashSet<String>>>,
    session_heartbeats: RwLock<HashMap<Uuid, Instant>>,
    preserved_sessions: RwLock<HashMap<Uuid, PreservedSession>>,
    reconnect_count: AtomicU64,
    reconnect_failures: AtomicU64,
    reconnect_expired: AtomicU64,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            user_to_sessions: RwLock::new(HashMap::new()),
            channel_to_sessions: RwLock::new(HashMap::new()),
            session_to_channels: RwLock::new(HashMap::new()),
            session_heartbeats: RwLock::new(HashMap::new()),
            preserved_sessions: RwLock::new(HashMap::new()),
            reconnect_count: AtomicU64::new(0),
            reconnect_failures: AtomicU64::new(0),
            reconnect_expired: AtomicU64::new(0),
        }
    }

    /// Register a new session for a user, enforcing the MAX_CONNECTIONS_PER_USER limit.
    /// Returns true if registered, or false if the session is duplicate or connection limit is reached.
    pub fn register(&self, user_id: Uuid, session_id: Uuid) -> bool {
        let mut user_map = self.user_to_sessions.write().unwrap();
        let sessions = user_map.entry(user_id).or_default();

        if sessions.contains(&session_id) {
            return false;
        }

        if sessions.len() >= MAX_CONNECTIONS_PER_USER {
            return false;
        }

        sessions.insert(session_id);

        let mut hb_map = self.session_heartbeats.write().unwrap();
        hb_map.insert(session_id, Instant::now());
        true
    }

    /// Register a new session returning a structured Result.
    pub fn register_with_limit(&self, user_id: Uuid, session_id: Uuid) -> Result<bool, SessionError> {
        let mut user_map = self.user_to_sessions.write().unwrap();
        let sessions = user_map.entry(user_id).or_default();

        if sessions.contains(&session_id) {
            return Ok(false);
        }

        if sessions.len() >= MAX_CONNECTIONS_PER_USER {
            return Err(SessionError::MaxConnectionsExceeded(MAX_CONNECTIONS_PER_USER));
        }

        sessions.insert(session_id);

        let mut hb_map = self.session_heartbeats.write().unwrap();
        hb_map.insert(session_id, Instant::now());
        Ok(true)
    }

    /// Record a heartbeat timestamp for an active session.
    pub fn record_heartbeat(&self, session_id: &Uuid) {
        let mut hb_map = self.session_heartbeats.write().unwrap();
        hb_map.insert(*session_id, Instant::now());
    }

    /// Check if a session has exceeded the 3 missed heartbeats timeout (90s).
    pub fn is_stale(&self, session_id: &Uuid) -> bool {
        let hb_map = self.session_heartbeats.read().unwrap();
        match hb_map.get(session_id) {
            Some(last_hb) => last_hb.elapsed() > CLIENT_TIMEOUT,
            None => true,
        }
    }

    /// Retrieve all active session IDs that are currently stale.
    pub fn get_stale_sessions(&self) -> Vec<Uuid> {
        let hb_map = self.session_heartbeats.read().unwrap();
        let now = Instant::now();
        hb_map
            .iter()
            .filter_map(|(&session_id, &last_hb)| {
                if now.duration_since(last_hb) > CLIENT_TIMEOUT {
                    Some(session_id)
                } else {
                    None
                }
            })
            .collect()
    }

    /// Remove a session for a user, clean up its subscriptions, and preserve its state for 60s.
    pub fn unregister(&self, user_id: Uuid, session_id: Uuid) {
        // Remove from user_to_sessions
        {
            let mut map = self.user_to_sessions.write().unwrap();
            if let Some(sessions) = map.get_mut(&user_id) {
                sessions.remove(&session_id);
                if sessions.is_empty() {
                    map.remove(&user_id);
                }
            }
        }

        // Remove from heartbeats
        {
            let mut hb_map = self.session_heartbeats.write().unwrap();
            hb_map.remove(&session_id);
        }

        // Clean up subscriptions and collect them for preservation
        let preserved_channels = {
            let mut session_map = self.session_to_channels.write().unwrap();
            if let Some(channels) = session_map.remove(&session_id) {
                let mut channel_map = self.channel_to_sessions.write().unwrap();
                for channel in &channels {
                    if let Some(sessions) = channel_map.get_mut(channel) {
                        sessions.remove(&session_id);
                        if sessions.is_empty() {
                            channel_map.remove(channel);
                        }
                    }
                }
                channels
            } else {
                HashSet::new()
            }
        };

        // Preserve session state for reconnect window (60s)
        {
            let mut preserved_map = self.preserved_sessions.write().unwrap();
            preserved_map.insert(
                session_id,
                PreservedSession {
                    session_id,
                    user_id,
                    disconnected_at: Instant::now(),
                    channels: preserved_channels,
                },
            );
        }
    }

    /// Attempt to reconnect using an old session ID. If valid within 60s and user matches,
    /// restores subscriptions to the new session ID and increments reconnect_count.
    /// If invalid or expired, updates failure metrics and returns None.
    pub fn reconnect(
        &self,
        user_id: Uuid,
        old_session_id: Uuid,
        new_session_id: Uuid,
    ) -> Option<HashSet<String>> {
        self.cleanup_expired_preserved_sessions();

        let preserved = {
            let mut map = self.preserved_sessions.write().unwrap();
            map.remove(&old_session_id)
        };

        match preserved {
            Some(p) => {
                if p.user_id != user_id {
                    self.reconnect_failures.fetch_add(1, Ordering::SeqCst);
                    return None;
                }

                if p.disconnected_at.elapsed() > STATE_PRESERVATION_TTL {
                    self.reconnect_expired.fetch_add(1, Ordering::SeqCst);
                    self.reconnect_failures.fetch_add(1, Ordering::SeqCst);
                    return None;
                }

                if !self.register(user_id, new_session_id) {
                    self.reconnect_failures.fetch_add(1, Ordering::SeqCst);
                    return None;
                }

                // Restore channel subscriptions
                for channel in &p.channels {
                    self.subscribe(new_session_id, channel.clone());
                }

                self.reconnect_count.fetch_add(1, Ordering::SeqCst);
                Some(p.channels)
            }
            None => {
                self.reconnect_failures.fetch_add(1, Ordering::SeqCst);
                None
            }
        }
    }

    /// Prune preserved sessions that have exceeded the 60s TTL.
    pub fn cleanup_expired_preserved_sessions(&self) {
        let mut map = self.preserved_sessions.write().unwrap();
        let now = Instant::now();
        map.retain(|_, p| now.duration_since(p.disconnected_at) <= STATE_PRESERVATION_TTL);
    }

    /// Subscribe a session to a channel.
    pub fn subscribe(&self, session_id: Uuid, channel: String) {
        let mut channel_map = self.channel_to_sessions.write().unwrap();
        channel_map
            .entry(channel.clone())
            .or_default()
            .insert(session_id);

        let mut session_map = self.session_to_channels.write().unwrap();
        session_map.entry(session_id).or_default().insert(channel);
    }

    /// Unsubscribe a session from a channel.
    pub fn unsubscribe(&self, session_id: Uuid, channel: &str) {
        let mut channel_map = self.channel_to_sessions.write().unwrap();
        if let Some(sessions) = channel_map.get_mut(channel) {
            sessions.remove(&session_id);
            if sessions.is_empty() {
                channel_map.remove(channel);
            }
        }

        let mut session_map = self.session_to_channels.write().unwrap();
        if let Some(channels) = session_map.get_mut(&session_id) {
            channels.remove(channel);
        }
    }

    /// Get all active session IDs for a user.
    pub fn get_sessions(&self, user_id: &Uuid) -> Vec<Uuid> {
        let map = self.user_to_sessions.read().unwrap();
        map.get(user_id)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Get all session IDs subscribed to a channel.
    pub fn get_subscribers(&self, channel: &str) -> Vec<Uuid> {
        let map = self.channel_to_sessions.read().unwrap();
        map.get(channel)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Check if a user has any active sessions.
    pub fn has_user(&self, user_id: &Uuid) -> bool {
        let map = self.user_to_sessions.read().unwrap();
        map.contains_key(user_id)
    }

    /// Number of distinct connected users.
    pub fn connected_user_count(&self) -> usize {
        let map = self.user_to_sessions.read().unwrap();
        map.len()
    }

    /// Total number of active sessions across all users.
    pub fn active_session_count(&self) -> usize {
        let map = self.session_heartbeats.read().unwrap();
        map.len()
    }

    /// Number of preserved sessions currently waiting in reconnect window.
    pub fn preserved_session_count(&self) -> usize {
        let map = self.preserved_sessions.read().unwrap();
        map.len()
    }

    /// Retrieve current reconnection metrics.
    pub fn get_metrics(&self) -> ReconnectMetrics {
        ReconnectMetrics {
            reconnect_count: self.reconnect_count.load(Ordering::Relaxed),
            reconnect_failures: self.reconnect_failures.load(Ordering::Relaxed),
            reconnect_expired: self.reconnect_expired.load(Ordering::Relaxed),
        }
    }

    /// Reset reconnection metrics to zero.
    pub fn reset_metrics(&self) {
        self.reconnect_count.store(0, Ordering::Relaxed);
        self.reconnect_failures.store(0, Ordering::Relaxed);
        self.reconnect_expired.store(0, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_get_sessions() {
        let registry = SessionRegistry::new();
        let user_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();

        assert!(registry.get_sessions(&user_id).is_empty());
        assert!(registry.register(user_id, session_id));
        assert!(!registry.register(user_id, session_id));

        let sessions = registry.get_sessions(&user_id);
        assert_eq!(sessions.len(), 1);
        assert!(sessions.contains(&session_id));
        assert_eq!(registry.active_session_count(), 1);
    }

    #[test]
    fn test_unregister_session() {
        let registry = SessionRegistry::new();
        let user_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();

        registry.register(user_id, session_id);
        registry.unregister(user_id, session_id);

        assert!(registry.get_sessions(&user_id).is_empty());
        assert!(!registry.has_user(&user_id));
        assert_eq!(registry.active_session_count(), 0);
        assert_eq!(registry.preserved_session_count(), 1);
    }

    #[test]
    fn test_multiple_sessions_per_user() {
        let registry = SessionRegistry::new();
        let user_id = Uuid::new_v4();
        let session_a = Uuid::new_v4();
        let session_b = Uuid::new_v4();

        registry.register(user_id, session_a);
        registry.register(user_id, session_b);
        assert_eq!(registry.get_sessions(&user_id).len(), 2);

        registry.unregister(user_id, session_a);
        let sessions = registry.get_sessions(&user_id);
        assert_eq!(sessions.len(), 1);
        assert!(sessions.contains(&session_b));
    }

    #[test]
    fn test_max_five_connections_per_user() {
        let registry = SessionRegistry::new();
        let user_id = Uuid::new_v4();

        let mut session_ids = Vec::new();
        for _ in 0..MAX_CONNECTIONS_PER_USER {
            let sid = Uuid::new_v4();
            assert!(registry.register(user_id, sid));
            session_ids.push(sid);
        }

        assert_eq!(registry.get_sessions(&user_id).len(), 5);

        // 6th session must be rejected
        let extra_session = Uuid::new_v4();
        assert!(!registry.register(user_id, extra_session));
        assert_eq!(
            registry.register_with_limit(user_id, extra_session),
            Err(SessionError::MaxConnectionsExceeded(5))
        );
        assert_eq!(registry.get_sessions(&user_id).len(), 5);

        // Disconnecting one allows a new connection
        registry.unregister(user_id, session_ids[0]);
        assert_eq!(registry.get_sessions(&user_id).len(), 4);
        assert!(registry.register(user_id, extra_session));
        assert_eq!(registry.get_sessions(&user_id).len(), 5);
    }

    #[test]
    fn test_user_count_and_has_user() {
        let registry = SessionRegistry::new();
        let user_a = Uuid::new_v4();
        let user_b = Uuid::new_v4();

        assert!(!registry.has_user(&user_a));
        registry.register(user_a, Uuid::new_v4());
        registry.register(user_b, Uuid::new_v4());

        assert!(registry.has_user(&user_a));
        assert!(registry.has_user(&user_b));
        assert_eq!(registry.connected_user_count(), 2);
    }

    #[test]
    fn test_heartbeat_and_stale_detection() {
        let registry = SessionRegistry::new();
        let user_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();

        registry.register(user_id, session_id);
        assert!(!registry.is_stale(&session_id));
        assert!(registry.get_stale_sessions().is_empty());

        registry.record_heartbeat(&session_id);
        assert!(!registry.is_stale(&session_id));

        let unknown = Uuid::new_v4();
        assert!(registry.is_stale(&unknown));
    }

    #[test]
    fn test_state_preservation_and_reconnect_success() {
        let registry = SessionRegistry::new();
        let user_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        let channel1 = "match:123".to_string();
        let channel2 = "user:456".to_string();

        registry.register(user_id, session_id);
        registry.subscribe(session_id, channel1.clone());
        registry.subscribe(session_id, channel2.clone());

        assert_eq!(registry.get_subscribers(&channel1).len(), 1);
        assert_eq!(registry.get_subscribers(&channel2).len(), 1);

        // Disconnect preserves subscriptions
        registry.unregister(user_id, session_id);
        assert!(registry.get_sessions(&user_id).is_empty());
        assert!(registry.get_subscribers(&channel1).is_empty());
        assert!(registry.get_subscribers(&channel2).is_empty());
        assert_eq!(registry.preserved_session_count(), 1);

        // Reconnect within 60s
        let new_session_id = Uuid::new_v4();
        let restored = registry.reconnect(user_id, session_id, new_session_id);
        assert!(restored.is_some());

        let channels = restored.unwrap();
        assert!(channels.contains(&channel1));
        assert!(channels.contains(&channel2));

        let user_sessions = registry.get_sessions(&user_id);
        assert_eq!(user_sessions.len(), 1);
        assert!(user_sessions.contains(&new_session_id));
        assert_eq!(registry.get_subscribers(&channel1), vec![new_session_id]);
        assert_eq!(registry.get_subscribers(&channel2), vec![new_session_id]);

        let metrics = registry.get_metrics();
        assert_eq!(metrics.reconnect_count, 1);
        assert_eq!(metrics.reconnect_failures, 0);
        assert_eq!(metrics.reconnect_expired, 0);
    }

    #[test]
    fn test_reconnect_failures_and_metrics() {
        let registry = SessionRegistry::new();
        let user_a = Uuid::new_v4();
        let user_b = Uuid::new_v4();
        let session_id = Uuid::new_v4();

        registry.register(user_a, session_id);
        registry.subscribe(session_id, "room:1".to_string());
        registry.unregister(user_a, session_id);

        // User mismatch failure
        let attempt_b = registry.reconnect(user_b, session_id, Uuid::new_v4());
        assert!(attempt_b.is_none());

        let metrics = registry.get_metrics();
        assert_eq!(metrics.reconnect_failures, 1);
        assert_eq!(metrics.reconnect_count, 0);

        // Non-existent session failure
        let attempt_nonexistent = registry.reconnect(user_a, Uuid::new_v4(), Uuid::new_v4());
        assert!(attempt_nonexistent.is_none());

        let metrics = registry.get_metrics();
        assert_eq!(metrics.reconnect_failures, 2);

        // Reset metrics
        registry.reset_metrics();
        assert_eq!(registry.get_metrics(), ReconnectMetrics::default());
    }

    #[test]
    fn test_channel_subscriptions_lifecycle() {
        let registry = SessionRegistry::new();
        let user_id = Uuid::new_v4();
        let session_a = Uuid::new_v4();
        let session_b = Uuid::new_v4();
        let channel = "global_chat".to_string();

        registry.register(user_id, session_a);
        registry.register(user_id, session_b);

        registry.subscribe(session_a, channel.clone());
        registry.subscribe(session_b, channel.clone());

        let subscribers = registry.get_subscribers(&channel);
        assert_eq!(subscribers.len(), 2);
        assert!(subscribers.contains(&session_a));
        assert!(subscribers.contains(&session_b));

        registry.unsubscribe(session_a, &channel);
        let subscribers = registry.get_subscribers(&channel);
        assert_eq!(subscribers.len(), 1);
        assert_eq!(subscribers[0], session_b);
    }

    #[test]
    fn test_cleanup_expired_preserved_sessions() {
        let registry = SessionRegistry::new();
        let user_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();

        registry.register(user_id, session_id);
        registry.unregister(user_id, session_id);
        assert_eq!(registry.preserved_session_count(), 1);

        // Artificially age the preserved session past TTL
        {
            let mut preserved_map = registry.preserved_sessions.write().unwrap();
            if let Some(preserved) = preserved_map.get_mut(&session_id) {
                preserved.disconnected_at = Instant::now() - Duration::from_secs(65);
            }
        }

        // Cleanup should remove it
        registry.cleanup_expired_preserved_sessions();
        assert_eq!(registry.preserved_session_count(), 0);
    }

    #[test]
    fn test_reconnect_expired_increments_expired_metric() {
        let registry = SessionRegistry::new();
        let user_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();

        registry.register(user_id, session_id);
        registry.unregister(user_id, session_id);

        // Artificially age the preserved session past TTL
        {
            let mut preserved_map = registry.preserved_sessions.write().unwrap();
            if let Some(preserved) = preserved_map.get_mut(&session_id) {
                preserved.disconnected_at = Instant::now() - Duration::from_secs(65);
            }
        }

        // Reconnect should fail with expired metric incremented
        let new_session_id = Uuid::new_v4();
        let result = registry.reconnect(user_id, session_id, new_session_id);
        assert!(result.is_none());

        let metrics = registry.get_metrics();
        assert_eq!(metrics.reconnect_expired, 1);
        assert_eq!(metrics.reconnect_failures, 1);
        assert_eq!(metrics.reconnect_count, 0);
    }
}
