//! Records per-request Prometheus metrics (`http_requests_total`,
//! `http_request_duration_seconds`) so request rate, error rate, and
//! latency are all queryable the same way for this service as for
//! `arenax-server`.
use std::{
    future::{ready, Future, Ready},
    pin::Pin,
    time::Instant,
};

use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    Error,
};

use crate::metrics::{HTTP_REQUESTS_TOTAL, HTTP_REQUEST_DURATION_SECONDS};

pub struct RequestMetrics;

impl RequestMetrics {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RequestMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl<S, B> Transform<S, ServiceRequest> for RequestMetrics
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type InitError = ();
    type Transform = RequestMetricsMiddleware<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(RequestMetricsMiddleware { service }))
    }
}

pub struct RequestMetricsMiddleware<S> {
    service: S,
}

impl<S, B> Service<ServiceRequest> for RequestMetricsMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>>>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let start = Instant::now();
        let method = req.method().to_string();
        let route = req
            .match_pattern()
            .unwrap_or_else(|| req.path().to_string());

        let fut = self.service.call(req);

        Box::pin(async move {
            let outcome = fut.await;
            let elapsed = start.elapsed().as_secs_f64();
            HTTP_REQUEST_DURATION_SECONDS
                .with_label_values(&[&method, &route])
                .observe(elapsed);

            if let Ok(res) = &outcome {
                let status = res.status().as_u16().to_string();
                HTTP_REQUESTS_TOTAL
                    .with_label_values(&[&method, &route, &status])
                    .inc();
            }

            outcome
        })
    }
}
