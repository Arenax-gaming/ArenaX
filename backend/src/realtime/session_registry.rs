use std::collections::{HashMap, HashSet};
use std::sync::RwLock;
use uuid::Uuid;

/// Thread-safe registry mapping user IDs to their active WebSocket session IDs,
/// and tracking channel subscriptions for event routing.
pub struct SessionRegistry {
    user_to_sessions: RwLock<HashMap<Uuid, HashSet<Uuid>>>,
    channel_to_sessions: RwLock<HashMap<String, HashSet<Uuid>>>,
    session_to_channels: RwLock<HashMap<Uuid, HashSet<String>>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            user_to_sessions: RwLock::new(HashMap::new()),
            channel_to_sessions: RwLock::new(HashMap::new()),
            session_to_channels: RwLock::new(HashMap::new()),
        }
    }

    /// Register a new session for a user.
    pub fn register(&self, user_id: Uuid, session_id: Uuid) -> bool {
        let mut map = self.user_to_sessions.write().unwrap();
        map.entry(user_id).or_default().insert(session_id)
    }

    /// Remove a session for a user and clean up all its subscriptions.
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

        // Clean up subscriptions
        let mut session_map = self.session_to_channels.write().unwrap();
        if let Some(channels) = session_map.remove(&session_id) {
            let mut channel_map = self.channel_to_sessions.write().unwrap();
            for channel in channels {
                if let Some(sessions) = channel_map.get_mut(&channel) {
                    sessions.remove(&session_id);
                    if sessions.is_empty() {
                        channel_map.remove(&channel);
                    }
                }
            }
        }
    }

    /// Subscribe a session to a channel.
    pub fn subscribe(&self, session_id: Uuid, channel: String) {
        let mut channel_map = self.channel_to_sessions.write().unwrap();
        channel_map.entry(channel.clone()).or_default().insert(session_id);

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

    /// Get all session IDs for a user.
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
}
