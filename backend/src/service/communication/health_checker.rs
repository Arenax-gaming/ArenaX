//! Health checker for services using HTTP endpoints

use crate::service::communication::service_discovery::{ServiceDiscovery, ServiceInfo};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tokio::time::{self, Duration};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHealth {
    pub service_id: String,
    pub service_name: String,
    pub healthy: bool,
    pub latency_ms: u128,
    pub status_code: Option<u16>,
}

pub struct HealthChecker {
    client: Client,
    discovery: ServiceDiscovery,
}

impl HealthChecker {
    pub fn new(discovery: ServiceDiscovery) -> Self {
        Self {
            client: Client::new(),
            discovery,
        }
    }

    /// Check a single service health via HTTP GET to /health
    pub async fn check_service(&self, info: &ServiceInfo) -> anyhow::Result<ServiceHealth> {
        let url = format!("http://{}:{}{}", info.host, info.port, info.health_endpoint);
        let start = Instant::now();
        let resp = self.client.get(&url).send().await;
        let latency = start.elapsed().as_millis();
        match resp {
            Ok(r) => Ok(ServiceHealth {
                service_id: info.service_id.clone(),
                service_name: info.service_name.clone(),
                healthy: r.status().is_success(),
                latency_ms: latency,
                status_code: Some(r.status().as_u16()),
            }),
            Err(_e) => Ok(ServiceHealth {
                service_id: info.service_id.clone(),
                service_name: info.service_name.clone(),
                healthy: false,
                latency_ms: latency,
                status_code: None,
            }),
        }
    }

    /// Periodically check health of all services with given name
    pub async fn start_health_checks(&self, service_name: &str, interval: Duration) -> tokio::task::JoinHandle<()> {
        let discovery = self.discovery.clone();
        let client = self.client.clone();
        let service_name = service_name.to_string();
        
        tokio::spawn(async move {
            let checker = HealthChecker { client, discovery };
            let mut ticker = time::interval(interval);
            loop {
                ticker.tick().await;
                match checker.discovery.discover_services(&service_name).await {
                    Ok(services) => {
                        for s in services {
                            if let Ok(health) = checker.check_service(&s).await {
                                tracing::info!(
                                    service = %health.service_name,
                                    id = %health.service_id,
                                    healthy = %health.healthy,
                                    latency_ms = %health.latency_ms,
                                    "Service health check"
                                );
                            }
                        }
                    }
                    Err(e) => tracing::error!("Health check discovery failed: {}", e),
                }
            }
        })
    }
}