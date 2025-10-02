//! Communication module for inter-service communication
//! Provides service discovery, message queuing, circuit breakers,
//! load balancing, and health checking for microservices architecture

pub mod service_discovery;
pub mod message_queue;
pub mod circuit_breaker;
pub mod load_balancer;
pub mod grpc_client;
pub mod health_checker;

pub use service_discovery::ServiceDiscovery;
pub use message_queue::MessageQueue;
pub use circuit_breaker::CircuitBreaker;
pub use load_balancer::LoadBalancer;
pub use grpc_client::GrpcClient;
pub use health_checker::HealthChecker;

use std::time::Duration;

/// Configuration for communication services
#[derive(Clone, Debug)]
pub struct CommunicationConfig {
    pub redis_url: String,
    pub service_timeout: Duration,
    pub health_check_interval: Duration,
    pub circuit_breaker_threshold: u32,
    pub circuit_breaker_timeout: Duration,
}

impl Default for CommunicationConfig {
    fn default() -> Self {
        Self {
            redis_url: "redis://localhost:6379".to_string(),
            service_timeout: Duration::from_secs(30),
            health_check_interval: Duration::from_secs(10),
            circuit_breaker_threshold: 5,
            circuit_breaker_timeout: Duration::from_secs(60),
        }
    }
}