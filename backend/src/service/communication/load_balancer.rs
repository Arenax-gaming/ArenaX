//! Load balancer for selecting service endpoints
//! Supports round-robin and random strategies

use crate::service::communication::service_discovery::{ServiceDiscovery, ServiceInfo};
use rand::seq::SliceRandom;
use rand::thread_rng;
use std::ops::Deref;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub enum LoadBalancerStrategy {
    RoundRobin,
    Random,
}

pub struct LoadBalancer {
    discovery: ServiceDiscovery,
    strategy: LoadBalancerStrategy,
    services: Arc<RwLock<Vec<ServiceInfo>>>,
    rr_index: Arc<RwLock<usize>>,
}

impl LoadBalancer {
    pub fn new(discovery: ServiceDiscovery, strategy: LoadBalancerStrategy) -> Self {
        Self {
            discovery,
            strategy,
            services: Arc::new(RwLock::new(Vec::new())),
            rr_index: Arc::new(RwLock::new(0)),
        }
    }

    /// Refresh the internal service list from discovery
    pub async fn refresh(&self, service_name: &str) -> redis::RedisResult<()> {
        let services = self.discovery.discover_services(service_name).await?;
        let mut guard = self.services.write().await;
        *guard = services;
        Ok(())
    }

    /// Select next endpoint URL based on strategy
    pub async fn select_endpoint(&self) -> Option<String> {
        let services = self.services.read().await;
        if services.is_empty() {
            return None;
        }
        match self.strategy {
            LoadBalancerStrategy::RoundRobin => {
                let mut index = self.rr_index.write().await;
                let selected = services.get(*index).cloned();
                *index = (*index + 1) % services.len();
                selected.map(|s| format!("http://{}:{}", s.host, s.port))
            }
            LoadBalancerStrategy::Random => {
                let mut rng = thread_rng();
                let services_slice: &Vec<ServiceInfo> = services.deref();
                services_slice
                    .as_slice()
                    .choose(&mut rng)
                    .cloned()
                    .map(|s| format!("http://{}:{}", s.host, s.port))
            }
        }
    }
}