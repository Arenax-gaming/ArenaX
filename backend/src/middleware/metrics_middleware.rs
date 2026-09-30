//! Records per-request Prometheus metrics (`http_requests_total`,
//! `http_request_duration_seconds`) so request rate, error rate, and
//! latency are all queryable the same way for this service as for
//! `arenax-server`.
//!
//! Route labels use the **route template** (`req.match_info().pattern()`,
//! e.g. `/api/tournaments/{id}`) rather than the resolved URI path. This
//! ensures `/api/tournaments/abc-123` and `/api/tournaments/def-456` land in
//! the same histogram bucket so per-route P50/P95/P99 latency can be
//! aggregated across many requests (Issue #1077).
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

/// Extract the route template for the current request.
///
/// Prefers the matched resource pattern (`req.match_info().pattern()`), e.g.
/// `/api/tournaments/{id}`. Falls back to the highest-scoped registered
/// pattern, and finally to the raw path for unmatched (404) requests so the
/// metric always has a `route` label.
fn route_template(req: &ServiceRequest) -> String {
    let matched = req.match_info().pattern().trim();
    if matched.is_empty() || matched == "/" {
        req.match_pattern()
            .unwrap_or_else(|| req.path().to_string())
    } else {
        matched.to_string()
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
        let route = route_template(&req);

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

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{
        test::{self, TestRequest},
        web, App, HttpResponse,
    };
    use prometheus::{Encoder, TextEncoder};

    /// Count observations of `http_request_duration_seconds` for a given
    /// method and a route label that contains `route_fragment`.
    fn duration_observations(method: &str, route_fragment: &str) -> f64 {
        let encoder = TextEncoder::new();
        let metric_families = crate::metrics::REGISTRY.gather();
        let mut buffer = Vec::new();
        encoder.encode(&metric_families, &mut buffer).unwrap();
        let text = String::from_utf8(buffer).unwrap();

        let mut total = 0.0;
        for line in text.lines() {
            // Format: http_request_duration_seconds_count{method="GET",route="..."} N
            if line.starts_with("http_request_duration_seconds_count")
                && line.contains(&format!("method=\"{}\"", method))
                && line.contains("route=")
                && line.contains(route_fragment)
            {
                let value = line.rsplit(' ').next().unwrap_or("0");
                total += value.parse::<f64>().unwrap_or(0.0);
            }
        }
        total
    }

    #[actix_web::test]
    async fn route_label_uses_template_not_resolved_path() {
        let before = duration_observations("GET", "/tournaments/{id}");

        let app = test::init_service(
            App::new()
                .wrap(RequestMetrics::new())
                .route("/api/tournaments/{id}", web::get().to(HttpResponse::Ok)),
        )
        .await;

        let req1 = TestRequest::get()
            .uri("/api/tournaments/id-1")
            .to_request();
        assert!(test::call_service(&app, req1).await.status().is_success());

        let req2 = TestRequest::get()
            .uri("/api/tournaments/id-2")
            .to_request();
        assert!(test::call_service(&app, req2).await.status().is_success());

        // Both requests must land in the same `/api/tournaments/{id}` bucket,
        // keyed on the template, so the delta is exactly 2. If the middleware
        // used the resolved URI, the two paths would never match a single label.
        let after = duration_observations("GET", "/tournaments/{id}");
        assert_eq!(
            after - before,
            2.0,
            "expected both requests to share the /tournaments/{{id}} template bucket"
        );
    }

    #[test]
    fn route_template_uses_matched_pattern() {
        // A pattern-less request falls back gracefully (no panic, non-empty).
        let req = test::TestRequest::get().uri("/some/raw/path").to_srv_request();
        let route = route_template(&req);
        assert!(!route.is_empty());
    }
}