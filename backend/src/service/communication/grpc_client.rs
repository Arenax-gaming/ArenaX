//! gRPC client builder with load balancing and circuit breaker integration

use crate::service::communication::circuit_breaker::{CircuitBreaker, CircuitConfig};
use crate::service::communication::load_balancer::LoadBalancer;
use tonic::transport::{Channel, Endpoint};
use std::time::Duration;

pub struct GrpcClient {
    load_balancer: LoadBalancer,
    circuit_breaker: CircuitBreaker,
    connect_timeout: Duration,
}

impl GrpcClient {
    pub fn new(load_balancer: LoadBalancer, circuit_config: CircuitConfig, connect_timeout: Duration) -> Self {
        Self {
            load_balancer,
            circuit_breaker: CircuitBreaker::new(circuit_config),
            connect_timeout,
        }
    }

    /// Get a gRPC channel to the next selected endpoint
    pub async fn get_channel(&self) -> anyhow::Result<Channel> {
        let endpoint_url = self
            .load_balancer
            .select_endpoint()
            .await
            .ok_or_else(|| anyhow::anyhow!("no available endpoints from load balancer"))?;

        let endpoint = Endpoint::from_shared(endpoint_url)?
            .connect_timeout(self.connect_timeout)
            .tcp_nodelay(true);

        let channel = endpoint.connect().await?;
        Ok(channel)
    }

    /// Call a function using a channel protected by circuit breaker
    pub async fn call_with<T, E, F, Fut>(&self, f: F) -> Result<T, crate::service::communication::circuit_breaker::CircuitBreakerError<E>>
    where
        F: FnOnce(Channel) -> Fut,
        Fut: std::future::Future<Output = Result<T, E>>,
        E: From<anyhow::Error>,
    {
        self.circuit_breaker
            .call(|| async {
                // Convert connection errors from anyhow::Error into user's error type E
                let chan = match self.get_channel().await {
                    Ok(c) => c,
                    Err(e) => return Err(E::from(e)),
                };
                f(chan).await
            })
            .await
    }
}