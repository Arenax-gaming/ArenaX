use crate::config::Config;
use redis::{aio::MultiplexedConnection, Client, RedisResult};
use serde::Serialize;

#[derive(Clone)]
pub struct RedisClient {
    client: Client,
}

impl RedisClient {
    pub fn new(config: &Config) -> RedisResult<Self> {
        let client = Client::open(config.redis.url.clone())?;
        Ok(Self { client })
    }

    pub async fn get_connection(&self) -> RedisResult<MultiplexedConnection> {
        self.client.get_multiplexed_async_connection().await
    }

    pub async fn publish_tournament_event<T: Serialize>(
        &self,
        tournament_id: uuid::Uuid,
        event: &T,
    ) -> RedisResult<()> {
        self.publish(&format!("tournament:{tournament_id}"), event)
            .await
    }

    pub async fn publish_match_event<T: Serialize>(
        &self,
        match_id: uuid::Uuid,
        event: &T,
    ) -> RedisResult<()> {
        self.publish(&format!("match:{match_id}"), event).await
    }

    pub async fn publish_global_event<T: Serialize>(&self, event: &T) -> RedisResult<()> {
        self.publish("global", event).await
    }

    async fn publish<T: Serialize>(&self, channel: &str, event: &T) -> RedisResult<()> {
        let mut conn = self.get_connection().await?;
        let message = serde_json::to_string(event).map_err(|error| {
            redis::RedisError::from((
                redis::ErrorKind::TypeError,
                "Unable to serialize real-time event",
                error.to_string(),
            ))
        })?;
        let _: usize = redis::cmd("PUBLISH")
            .arg(channel)
            .arg(message)
            .query_async(&mut conn)
            .await?;
        Ok(())
    }

    pub async fn subscribe_tournament(
        &self,
        tournament_id: uuid::Uuid,
    ) -> RedisResult<redis::aio::PubSub> {
        self.subscribe(&format!("tournament:{tournament_id}")).await
    }

    pub async fn subscribe_match(&self, match_id: uuid::Uuid) -> RedisResult<redis::aio::PubSub> {
        self.subscribe(&format!("match:{match_id}")).await
    }

    pub async fn subscribe_global(&self) -> RedisResult<redis::aio::PubSub> {
        self.subscribe("global").await
    }

    async fn subscribe(&self, channel: &str) -> RedisResult<redis::aio::PubSub> {
        let mut pubsub = self.client.get_async_pubsub().await?;
        pubsub.subscribe(channel).await?;
        Ok(pubsub)
    }
}
