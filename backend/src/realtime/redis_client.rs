use redis::{Client, Connection, RedisResult};
use crate::config::Config;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct RedisClient {
    client: Client,
    connection: Arc<Mutex<Option<Connection>>>,
}

impl RedisClient {
    pub fn new(config: &Config) -> RedisResult<Self> {
        let client = Client::open(config.redis.url.clone())?;
        Ok(Self {
            client,
            connection: Arc::new(Mutex::new(None)),
        })
    }

    pub async fn get_connection(&self) -> RedisResult<Connection> {
        let mut conn_guard = self.connection.lock().await;
        if conn_guard.is_none() {
            *conn_guard = Some(self.client.get_connection()?);
        }
        Ok(conn_guard.as_ref().unwrap().clone())
    }

    pub async fn publish_tournament_event(&self, tournament_id: uuid::Uuid, event: &TournamentEvent) -> RedisResult<()> {
        let mut conn = self.get_connection().await?;
        let channel = format!("tournament:{}", tournament_id);
        let message = serde_json::to_string(event)?;
        redis::cmd("PUBLISH").arg(channel).arg(message).execute(&mut conn);
        Ok(())
    }

    pub async fn publish_match_event(&self, match_id: uuid::Uuid, event: &MatchEvent) -> RedisResult<()> {
        let mut conn = self.get_connection().await?;
        let channel = format!("match:{}", match_id);
        let message = serde_json::to_string(event)?;
        redis::cmd("PUBLISH").arg(channel).arg(message).execute(&mut conn);
        Ok(())
    }

    pub async fn publish_global_event(&self, event: &GlobalEvent) -> RedisResult<()> {
        let mut conn = self.get_connection().await?;
        let message = serde_json::to_string(event)?;
        redis::cmd("PUBLISH").arg("global").arg(message).execute(&mut conn);
        Ok(())
    }

    pub async fn subscribe_tournament(&self, tournament_id: uuid::Uuid) -> RedisResult<redis::PubSub> {
        let mut conn = self.get_connection().await?;
        let mut pubsub = conn.as_pubsub();
        let channel = format!("tournament:{}", tournament_id);
        pubsub.subscribe(&channel)?;
        Ok(pubsub)
    }

    pub async fn subscribe_match(&self, match_id: uuid::Uuid) -> RedisResult<redis::PubSub> {
        let mut conn = self.get_connection().await?;
        let mut pubsub = conn.as_pubsub();
        let channel = format!("match:{}", match_id);
        pubsub.subscribe(&channel)?;
        Ok(pubsub)
    }

    pub async fn subscribe_global(&self) -> RedisResult<redis::PubSub> {
        let mut conn = self.get_connection().await?;
        let mut pubsub = conn.as_pubsub();
        pubsub.subscribe("global")?;
        Ok(pubsub)
    }
}
