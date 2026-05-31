use redis::aio::ConnectionManager;
use redis::{Client, RedisError};
use std::sync::Arc;

/// Redis client wrapper that uses async connection pooling
pub struct RedisClient {
    connection_manager: ConnectionManager,
}

impl RedisClient {
    /// Create a new Redis client from a connection URL
    pub async fn new(redis_url: &str) -> Result<Self, RedisError> {
        let client = Client::open(redis_url)?;
        let connection_manager = ConnectionManager::new(client).await?;
        
        Ok(Self {
            connection_manager,
        })
    }

    /// Get a connection from the pool (non-blocking, async)
    pub fn get_connection(&self) -> ConnectionManager {
        self.connection_manager.clone()
    }

    /// Set a key-value pair with optional expiration (in seconds)
    pub async fn set_ex(
        &self,
        key: &str,
        value: &str,
        expiration_secs: usize,
    ) -> Result<(), RedisError> {
        redis::cmd("SET")
            .arg(key)
            .arg(value)
            .arg("EX")
            .arg(expiration_secs)
            .query_async(&mut self.get_connection().clone())
            .await
    }

    /// Get a value by key
    pub async fn get(&self, key: &str) -> Result<Option<String>, RedisError> {
        redis::cmd("GET")
            .arg(key)
            .query_async(&mut self.get_connection().clone())
            .await
    }

    /// Delete a key
    pub async fn del(&self, key: &str) -> Result<bool, RedisError> {
        redis::cmd("DEL")
            .arg(key)
            .query_async(&mut self.get_connection().clone())
            .await
    }

    /// Publish a message to a channel
    pub async fn publish(&self, channel: &str, message: &str) -> Result<i32, RedisError> {
        redis::cmd("PUBLISH")
            .arg(channel)
            .arg(message)
            .query_async(&mut self.get_connection().clone())
            .await
    }

    /// Increment a counter
    pub async fn incr(&self, key: &str) -> Result<i64, RedisError> {
        redis::cmd("INCR")
            .arg(key)
            .query_async(&mut self.get_connection().clone())
            .await
    }

    /// Get the TTL of a key (in seconds)
    pub async fn ttl(&self, key: &str) -> Result<i64, RedisError> {
        redis::cmd("TTL")
            .arg(key)
            .query_async(&mut self.get_connection().clone())
            .await
    }

    /// Check if a key exists
    pub async fn exists(&self, key: &str) -> Result<bool, RedisError> {
        let result: i32 = redis::cmd("EXISTS")
            .arg(key)
            .query_async(&mut self.get_connection().clone())
            .await?;
        Ok(result > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires Redis running
    async fn test_redis_client_creation() {
        let client = RedisClient::new("redis://127.0.0.1:6379").await;
        assert!(client.is_ok());
    }
}
