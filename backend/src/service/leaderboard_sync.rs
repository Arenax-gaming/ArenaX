//! Leaderboard synchronization across backend instances (Issue #1255).
//!
//! Each rank change is published to the `leaderboard:updates` stream. Every
//! instance consumes that stream with its own consumer group, so each one
//! applies the full history to a local cache. A higher version replaces a
//! lower one. Equal versions are ordered by event time, then by origin, so
//! two instances that observed the same concurrent writes converge.

use crate::realtime::event_stream::{Delivery, EventStream};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;

pub const LEADERBOARD_STREAM: &str = "leaderboard:updates";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LeaderboardUpdate {
    pub schema_version: u32,
    pub category: String,
    pub user_id: Uuid,
    pub ranking: i32,
    pub elo_rating: i32,
    pub version: u64,
    pub origin: String,
    pub occurred_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CachedRank {
    ranking: i32,
    elo_rating: i32,
    version: u64,
    occurred_at_ms: i64,
    origin: String,
}

/// Returns true when `incoming` should replace `current`.
pub fn should_apply(current: &LeaderboardUpdate, incoming: &LeaderboardUpdate) -> bool {
    if incoming.version != current.version {
        return incoming.version > current.version;
    }
    if incoming.occurred_at_ms != current.occurred_at_ms {
        return incoming.occurred_at_ms > current.occurred_at_ms;
    }
    incoming.origin < current.origin
}

pub struct LeaderboardSync {
    instance_id: String,
    stream: EventStream,
    cache: Mutex<HashMap<(String, Uuid), CachedRank>>,
    versions: Mutex<HashMap<(String, Uuid), u64>>,
}

impl LeaderboardSync {
    pub fn new(instance_id: impl Into<String>, stream: EventStream) -> Self {
        Self {
            instance_id: instance_id.into(),
            stream,
            cache: Mutex::new(HashMap::new()),
            versions: Mutex::new(HashMap::new()),
        }
    }

    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }

    /// Publishes a rank change. The version is one greater than the last
    /// version this instance published for the player.
    pub async fn publish_rank(
        &self,
        category: &str,
        user_id: Uuid,
        ranking: i32,
        elo_rating: i32,
    ) -> Result<LeaderboardUpdate, String> {
        let key = (category.to_string(), user_id);
        let version = {
            let mut versions = self.versions.lock().expect("leaderboard versions");
            let next = versions.get(&key).copied().unwrap_or(0) + 1;
            versions.insert(key, next);
            next
        };
        let update = LeaderboardUpdate {
            schema_version: 1,
            category: category.to_string(),
            user_id,
            ranking,
            elo_rating,
            version,
            origin: self.instance_id.clone(),
            occurred_at_ms: Utc::now().timestamp_millis(),
        };
        let payload = serde_json::to_string(&update).map_err(|e| e.to_string())?;
        self.stream.publish(&payload).await?;
        Ok(update)
    }

    /// Publishes an update whose version and time are chosen by the caller.
    /// Used to reproduce concurrent writes in tests.
    pub async fn publish_exact(&self, update: &LeaderboardUpdate) -> Result<(), String> {
        let payload = serde_json::to_string(update).map_err(|e| e.to_string())?;
        self.stream.publish(&payload).await?;
        Ok(())
    }

    /// Reads this instance's group and applies every new update to the cache.
    pub async fn consume_pending(&self) -> Result<usize, String> {
        let group = format!("leaderboard-sync:{}", self.instance_id);
        let deliveries = self
            .stream
            .read_group(&group, &self.instance_id, 100)
            .await?;
        let applied = self.apply_deliveries(&deliveries);
        for delivery in &deliveries {
            self.stream.ack(&group, &delivery.id).await?;
        }
        Ok(applied)
    }

    fn apply_deliveries(&self, deliveries: &[Delivery]) -> usize {
        let mut cache = self.cache.lock().expect("leaderboard cache");
        let mut applied = 0;
        for delivery in deliveries {
            let Ok(update) = serde_json::from_str::<LeaderboardUpdate>(&delivery.payload) else {
                continue;
            };
            let key = (update.category.clone(), update.user_id);
            let replace = match cache.get(&key) {
                Some(current) => should_apply(
                    &LeaderboardUpdate {
                        schema_version: 1,
                        category: update.category.clone(),
                        user_id: update.user_id,
                        ranking: current.ranking,
                        elo_rating: current.elo_rating,
                        version: current.version,
                        origin: current.origin.clone(),
                        occurred_at_ms: current.occurred_at_ms,
                    },
                    &update,
                ),
                None => true,
            };
            if replace {
                cache.insert(
                    key,
                    CachedRank {
                        ranking: update.ranking,
                        elo_rating: update.elo_rating,
                        version: update.version,
                        occurred_at_ms: update.occurred_at_ms,
                        origin: update.origin,
                    },
                );
                applied += 1;
            }
        }
        applied
    }

    pub fn cached_rank(&self, category: &str, user_id: Uuid) -> Option<(i32, i32, u64)> {
        self.cache
            .lock()
            .expect("leaderboard cache")
            .get(&(category.to_string(), user_id))
            .map(|rank| (rank.ranking, rank.elo_rating, rank.version))
    }

    /// True when both caches hold the same rank for every player either has seen.
    pub fn consistent_with(&self, other: &LeaderboardSync) -> bool {
        let left = self.cache.lock().expect("leaderboard cache");
        let right = other.cache.lock().expect("leaderboard cache");
        if left.len() != right.len() {
            return false;
        }
        left.iter().all(|(key, rank)| {
            right.get(key).is_some_and(|other_rank| {
                rank.ranking == other_rank.ranking
                    && rank.elo_rating == other_rank.elo_rating
                    && rank.version == other_rank.version
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update(user: Uuid, version: u64, ranking: i32, at: i64, origin: &str) -> LeaderboardUpdate {
        LeaderboardUpdate {
            schema_version: 1,
            category: "fifa".into(),
            user_id: user,
            ranking,
            elo_rating: 1200 + ranking,
            version,
            origin: origin.into(),
            occurred_at_ms: at,
        }
    }

    #[tokio::test]
    async fn every_instance_applies_the_stream_and_converges() {
        let stream = EventStream::memory(3);
        let a = LeaderboardSync::new("instance-a", stream.clone());
        let b = LeaderboardSync::new("instance-b", stream.clone());
        let user = Uuid::new_v4();

        a.publish_exact(&update(user, 1, 10, 1_000, "instance-a"))
            .await
            .unwrap();
        b.publish_exact(&update(user, 2, 4, 1_100, "instance-b"))
            .await
            .unwrap();
        // A stale replay of version 1 must not undo version 2.
        a.publish_exact(&update(user, 1, 9, 1_200, "instance-a"))
            .await
            .unwrap();

        assert_eq!(a.consume_pending().await.unwrap(), 2);
        assert_eq!(b.consume_pending().await.unwrap(), 2);
        assert!(a.consistent_with(&b));
        assert_eq!(a.cached_rank("fifa", user), Some((4, 1204, 2)));
        assert_eq!(b.cached_rank("fifa", user), Some((4, 1204, 2)));
    }

    #[tokio::test]
    async fn equal_versions_resolve_to_the_same_winner_on_every_instance() {
        let stream = EventStream::memory(3);
        let a = LeaderboardSync::new("instance-a", stream.clone());
        let b = LeaderboardSync::new("instance-b", stream);
        let user = Uuid::new_v4();

        // Same version, later timestamp wins.
        a.publish_exact(&update(user, 5, 8, 2_000, "instance-b"))
            .await
            .unwrap();
        a.publish_exact(&update(user, 5, 3, 1_500, "instance-a"))
            .await
            .unwrap();

        a.consume_pending().await.unwrap();
        b.consume_pending().await.unwrap();
        assert!(a.consistent_with(&b));
        assert_eq!(a.cached_rank("fifa", user).unwrap().0, 8);
    }

    #[test]
    fn tie_on_version_and_time_picks_the_lower_origin() {
        let user = Uuid::new_v4();
        let left = update(user, 1, 2, 50, "b-origin");
        let right = update(user, 1, 7, 50, "a-origin");
        assert!(should_apply(&left, &right));
        assert!(!should_apply(&right, &left));
    }
}
