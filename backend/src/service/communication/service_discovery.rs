//! Service discovery implementation using Redis
//! Manages service registration and discovery for microservices

use redis::{AsyncCommands, RedisResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time;
use uuid::Uuid;

/// Service information for discovery
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub service_id: String,
    pub service_name: String,
    pub host: String,
    pub port: u16,
    pub health_endpoint: String,
    pub tags: Vec<String>,
    pub last_heartbeat: u64,
}

impl ServiceInfo {
    pub fn new(service_name: String, host: String, port: u16) -> Self {
        Self {
            service_id: Uuid::new_v4().to_string(),
            service_name,
            host,
            port,
            health_endpoint: "/health".to_string(),
            tags: Vec::new(),
            last_heartbeat: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        }
    }

    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }

    pub fn with_health_endpoint(mut self, endpoint: String) -> Self {
        self.health_endpoint = endpoint;
        self
    }

    pub fn update_heartbeat(&mut self) {
        self.last_heartbeat = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
    }

    pub fn is_healthy(&self, timeout_secs: u64) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        now - self.last_heartbeat < timeout_secs
    }
}

/// Service discovery using Redis for registration and lookup
#[derive(Clone)]
pub struct ServiceDiscovery {
    redis_client: redis::Client,
    redis_url: String,
    service_ttl: Duration,
}

impl ServiceDiscovery {
    pub fn new(redis_url: &str) -> RedisResult<Self> {
        let redis_client = redis::Client::open(redis_url)?;
        Ok(Self {
            redis_client,
            redis_url: redis_url.to_string(),
            service_ttl: Duration::from_secs(30),
        })
    }

    /// Register a service with discovery
    pub async fn register_service(&self, service_info: &ServiceInfo) -> RedisResult<()> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let key = format!("services:{}:{}", service_info.service_name, service_info.service_id);
        let value = serde_json::to_string(service_info).unwrap();
        
        conn.set_ex(&key, value, self.service_ttl.as_secs() as u64).await?;
        Ok(())
    }

    /// Discover services by name
    pub async fn discover_services(&self, service_name: &str) -> RedisResult<Vec<ServiceInfo>> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let pattern = format!("services:{}:*", service_name);
        let keys: Vec<String> = conn.keys(pattern).await?;
        
        let mut services = Vec::new();
        for key in keys {
            if let Ok(value) = conn.get::<_, String>(&key).await {
                if let Ok(service_info) = serde_json::from_str::<ServiceInfo>(&value) {
                    if service_info.is_healthy(60) { // 60 second timeout
                        services.push(service_info);
                    }
                }
            }
        }
        
        Ok(services)
    }

    /// Update service heartbeat
    pub async fn heartbeat(&self, service_info: &mut ServiceInfo) -> RedisResult<()> {
        service_info.update_heartbeat();
        self.register_service(service_info).await
    }

    /// Remove a service from discovery
    pub async fn deregister_service(&self, service_name: &str, service_id: &str) -> RedisResult<()> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let key = format!("services:{}:{}", service_name, service_id);
        conn.del(&key).await?;
        Ok(())
    }

    /// Get all services grouped by name
    pub async fn get_all_services(&self) -> RedisResult<HashMap<String, Vec<ServiceInfo>>> {
        let mut conn = self.redis_client.get_async_connection().await?;
        let keys: Vec<String> = conn.keys("services:*").await?;
        
        let mut services_map: HashMap<String, Vec<ServiceInfo>> = HashMap::new();
        
        for key in keys {
            if let Ok(value) = conn.get::<_, String>(&key).await {
                if let Ok(service_info) = serde_json::from_str::<ServiceInfo>(&value) {
                    if service_info.is_healthy(60) {
                        services_map
                            .entry(service_info.service_name.clone())
                            .or_insert_with(Vec::new)
                            .push(service_info);
                    }
                }
            }
        }
        
        Ok(services_map)
    }

    /// Start background heartbeat task
    pub async fn start_heartbeat_task(
        &self,
        mut service_info: ServiceInfo,
        interval: Duration,
    ) -> tokio::task::JoinHandle<()> {
        let discovery = Self::new(&self.redis_url).unwrap();
        
        tokio::spawn(async move {
            let mut interval_timer = time::interval(interval);
            loop {
                interval_timer.tick().await;
                if let Err(e) = discovery.heartbeat(&mut service_info).await {
                    tracing::error!("Failed to send heartbeat: {}", e);
                }
            }
        })
    }
}