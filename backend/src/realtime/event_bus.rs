use crate::realtime::events::{channels, RealtimeEvent};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use tracing::{debug, error};
use uuid::Uuid;

/// Publishes domain events to Redis Pub/Sub channels.
/// Services inject this to emit real-time events.
#[derive(Clone)]
pub struct EventBus {
    redis: ConnectionManager,
}

impl EventBus {
    pub fn new(redis: ConnectionManager) -> Self {
        Self { redis }
    }

    /// Publish an event to a specific user's channel.
    pub async fn publish_to_user(&self, user_id: Uuid, event: &RealtimeEvent) {
        let channel = channels::user_channel(user_id);
        self.publish(&channel, event).await;
    }

    /// Publish an event to a specific match's channel.
    pub async fn publish_to_match(&self, match_id: Uuid, event: &RealtimeEvent) {
        let channel = channels::match_channel(match_id);
        self.publish(&channel, event).await;
    }

    /// Publish a serialized event to a Redis Pub/Sub channel.
    async fn publish(&self, channel: &str, event: &RealtimeEvent) {
        let payload = match serde_json::to_string(event) {
            Ok(json) => json,
            Err(e) => {
                error!(error = %e, "Failed to serialize event for Redis publish");
                return;
            }
        };

        let mut conn = self.redis.clone();
        if let Err(e) = conn.publish::<_, _, ()>(channel, &payload).await {
            error!(channel = %channel, error = %e, "Failed to publish event to Redis");
        } else {
            debug!(channel = %channel, "Event published to Redis");
        }
    }
}
