use std::collections::{HashMap, HashSet};
use std::sync::RwLock;
use uuid::Uuid;

/// Thread-safe registry mapping user IDs to their active WebSocket session IDs.
pub struct SessionRegistry {
    inner: RwLock<HashMap<Uuid, HashSet<Uuid>>>,
}

impl Default for SessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
        }
    }

    /// Register a new session for a user. Returns true if newly added.
    pub fn register(&self, user_id: Uuid, session_id: Uuid) -> bool {
        let mut map = self.inner.write().unwrap();
        map.entry(user_id).or_default().insert(session_id)
    }

    /// Remove a session for a user. Cleans up user entry if no sessions remain.
    pub fn unregister(&self, user_id: Uuid, session_id: Uuid) {
        let mut map = self.inner.write().unwrap();
        if let Some(sessions) = map.get_mut(&user_id) {
            sessions.remove(&session_id);
            if sessions.is_empty() {
                map.remove(&user_id);
            }
        }
    }

    /// Get all session IDs for a user.
    pub fn get_sessions(&self, user_id: &Uuid) -> Vec<Uuid> {
        let map = self.inner.read().unwrap();
        map.get(user_id)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Check if a user has any active sessions.
    pub fn has_user(&self, user_id: &Uuid) -> bool {
        let map = self.inner.read().unwrap();
        map.contains_key(user_id)
    }

    /// Number of distinct connected users.
    pub fn connected_user_count(&self) -> usize {
        let map = self.inner.read().unwrap();
        map.len()
    }
}
