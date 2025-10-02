//! Redis-based message queue for inter-service communication
//! Implements pub/sub and work queue patterns

use redis::{AsyncCommands, RedisResult};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use uuid::Uuid;

/// Message envelope for queue operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueMessage {
    pub id: String,
    pub topic: String,
    pub payload: String,
    pub timestamp: u64,
    pub retry_count: u32,
    pub max_retries: u32,
}

impl QueueMessage {
    pub fn new(topic: String, payload: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            topic,
            payload,
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            retry_count: 0,
            max_retries: 3,
        }
    }

    pub fn with_max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }

    pub fn can_retry(&self) -> bool {
        self.retry_count < self.max_retries
    }

    pub fn increment_retry(&mut self) {
        self.retry_count += 1;
    }
}

/// Redis-based message queue implementation
pub struct MessageQueue {
    redis_client: redis::Client,
}

impl MessageQueue {
    pub fn new(redis_url: &str) -> RedisResult<Self> {
        let redis_client = redis::Client::open(redis_url)?;
        Ok(Self { redis_client })
    }

    /// Publish a message to a topic (pub/sub pattern)
    pub async fn publish(&self, topic: &str, payload: &str) -> RedisResult<()> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let message = QueueMessage::new(topic.to_string(), payload.to_string());
        let serialized = serde_json::to_string(&message).unwrap();
        conn.publish(topic, serialized).await?;
        Ok(())
    }

    /// Subscribe to a topic (pub/sub pattern)
    pub async fn subscribe(
        &self,
        topics: Vec<String>,
        sender: mpsc::UnboundedSender<QueueMessage>,
    ) -> RedisResult<()> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let mut pubsub = conn.into_pubsub();
        
        for topic in &topics {
            pubsub.subscribe(topic).await?;
        }

        loop {
            let msg = pubsub.on_message().next().await;
            if let Some(msg) = msg {
                if let Ok(payload) = msg.get_payload::<String>() {
                    if let Ok(queue_message) = serde_json::from_str::<QueueMessage>(&payload) {
                        if sender.send(queue_message).is_err() {
                            break; // Receiver dropped
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Enqueue a message to a work queue (work queue pattern)
    pub async fn enqueue(&self, queue_name: &str, message: &QueueMessage) -> RedisResult<()> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let serialized = serde_json::to_string(message).unwrap();
        conn.lpush(queue_name, serialized).await?;
        Ok(())
    }

    /// Dequeue a message from a work queue (blocking)
    pub async fn dequeue(&self, queue_name: &str, timeout: u64) -> RedisResult<Option<QueueMessage>> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let result: Option<(String, String)> = conn.brpop(queue_name, timeout).await?;
        
        if let Some((_, payload)) = result {
            if let Ok(message) = serde_json::from_str::<QueueMessage>(&payload) {
                return Ok(Some(message));
            }
        }
        Ok(None)
    }

    /// Move failed message to dead letter queue
    pub async fn move_to_dlq(&self, message: &QueueMessage) -> RedisResult<()> {
        let dlq_name = format!("{}_dlq", message.topic);
        self.enqueue(&dlq_name, message).await
    }

    /// Process messages from a queue with retry logic
    pub async fn process_queue<F, Fut>(
        &self,
        queue_name: &str,
        processor: F,
    ) -> RedisResult<()>
    where
        F: Fn(QueueMessage) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<(), String>> + Send,
    {
        loop {
            if let Some(mut message) = self.dequeue(queue_name, 5).await? {
                match processor(message.clone()).await {
                    Ok(()) => {
                        tracing::info!("Successfully processed message: {}", message.id);
                    }
                    Err(e) => {
                        tracing::error!("Failed to process message {}: {}", message.id, e);
                        message.increment_retry();
                        
                        if message.can_retry() {
                            // Re-queue for retry
                            self.enqueue(queue_name, &message).await?;
                        } else {
                            // Move to dead letter queue
                            self.move_to_dlq(&message).await?;
                        }
                    }
                }
            }
        }
    }

    /// Get queue length
    pub async fn queue_length(&self, queue_name: &str) -> RedisResult<u64> {
        let mut conn = self.redis_client.get_async_connection().await?;
        conn.llen(queue_name).await
    }

    /// Clear a queue
    pub async fn clear_queue(&self, queue_name: &str) -> RedisResult<()> {
        let mut conn = self.redis_client.get_async_connection().await?;
        conn.del(queue_name).await?;
        Ok(())
    }
}