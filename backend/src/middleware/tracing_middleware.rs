//! Distributed tracing middleware.
//!
//! - **Trace context propagation**: extracts W3C `traceparent`/`tracestate`
//!   headers from inbound requests (set by an upstream service or gateway)
//!   so the span opened here joins the caller's trace instead of starting a
//!   new one.
//! - **Span creation per operation**: opens one span per HTTP request
//!   ("http.request"); service-layer code can open further child spans
//!   (e.g. via `#[tracing::instrument]`) that nest under it, giving a full
//!   waterfall in the trace viewer.
//! - **Trace export**: spans flow through the `tracing-opentelemetry` layer
//!   installed in `telemetry.rs`, which exports them via OTLP to Jaeger or
//!   Datadog.
//! - **Correlation IDs**: honors an inbound `x-correlation-id`, otherwise
//!   derives one from the span's trace id, stashes it on the request so
//!   other middleware/handlers can read it, and echoes it back as
//!   `x-correlation-id` / `x-trace-id` response headers.
//! - **Latency breakdown by span**: each span's start/end timestamps are
//!   exported to the trace backend, and the total request latency is also
//!   logged and recorded on the span for local visibility.
use std::{
    future::{ready, Future, Ready},
    pin::Pin,
    time::Instant,
};

use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::header::{HeaderName, HeaderValue},
    Error, HttpMessage,
};
use opentelemetry::propagation::{Extractor, TextMapPropagator};
use opentelemetry::trace::{Span as _, TraceContextExt};
use tracing::{field, Instrument, Span};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use uuid::Uuid;

/// Inbound/outbound header carrying the correlation id.
const CORRELATION_ID_HEADER: &str = "x-correlation-id";
/// Outbound header carrying the raw OpenTelemetry trace id (hex).
const TRACE_ID_HEADER: &str = "x-trace-id";

/// Correlation id for the current request, stashed in request extensions so
/// downstream handlers/middleware (audit logs, error responses, ...) can
/// attach it to their own log lines without re-deriving it.
#[derive(Clone, Debug)]
pub struct CorrelationId(pub String);

impl std::fmt::Display for CorrelationId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Reads the correlation id stashed by [`RequestTracing`] for this request,
/// if the middleware is installed.
pub fn correlation_id(req: &ServiceRequest) -> Option<String> {
    req.extensions().get::<CorrelationId>().map(|c| c.0.clone())
}

pub struct RequestTracing;

impl RequestTracing {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RequestTracing {
    fn default() -> Self {
        Self::new()
    }
}

impl<S, B> Transform<S, ServiceRequest> for RequestTracing
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type InitError = ();
    type Transform = RequestTracingMiddleware<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(RequestTracingMiddleware { service }))
    }
}

pub struct RequestTracingMiddleware<S> {
    service: S,
}

/// Adapts actix's header map to OpenTelemetry's propagation `Extractor`.
struct HeaderExtractor<'a>(&'a actix_web::http::header::HeaderMap);

impl<'a> Extractor for HeaderExtractor<'a> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|v| v.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(|k| k.as_str()).collect()
    }
}

impl<S, B> Service<ServiceRequest> for RequestTracingMiddleware<S>
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

        // ── 1. Trace context propagation ────────────────────────────────
        // Pull any W3C traceparent/tracestate the caller sent so this span
        // becomes a child of their trace rather than starting a new one.
        let parent_cx = opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.extract(&HeaderExtractor(req.headers()))
        });

        let method = req.method().to_string();
        let route = req
            .match_pattern()
            .unwrap_or_else(|| req.path().to_string());

        // ── 2. Span creation per operation (this HTTP request) ──────────
        let span = tracing::info_span!(
            "http.request",
            otel.name = %format!("{method} {route}"),
            http.method = %method,
            http.route = %route,
            http.status_code = field::Empty,
            correlation_id = field::Empty,
            trace_id = field::Empty,
            latency_ms = field::Empty,
        );
        span.set_parent(parent_cx);

        // ── 3. Correlation ID ────────────────────────────────────────────
        // Honor a caller-supplied id so logs from an upstream gateway line
        // up with ours; otherwise derive one from this span's trace id.
        let incoming_correlation_id = req
            .headers()
            .get(CORRELATION_ID_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let otel_trace_id = span.context().span().span_context().trace_id().to_string();
        let has_valid_trace_id = span.context().span().span_context().is_valid();

        let correlation_id = incoming_correlation_id.unwrap_or_else(|| {
            if has_valid_trace_id {
                otel_trace_id.clone()
            } else {
                Uuid::new_v4().to_string()
            }
        });

        span.record("correlation_id", field::display(&correlation_id));
        span.record("trace_id", field::display(&otel_trace_id));

        req.extensions_mut()
            .insert(CorrelationId(correlation_id.clone()));

        let fut = self.service.call(req);

        Box::pin(
            async move {
                let outcome = fut.await;
                let latency_ms = start.elapsed().as_millis() as u64;
                Span::current().record("latency_ms", latency_ms);

                match outcome {
                    Ok(mut res) => {
                        let status = res.status().as_u16();
                        Span::current().record("http.status_code", status);
                        insert_header(&mut res, CORRELATION_ID_HEADER, &correlation_id);
                        insert_header(&mut res, TRACE_ID_HEADER, &otel_trace_id);
                        tracing::info!(latency_ms, status, "request completed");
                        Ok(res)
                    }
                    Err(e) => {
                        tracing::error!(latency_ms, error = %e, "request failed");
                        Err(e)
                    }
                }
            }
            .instrument(span),
        )
    }
}

fn insert_header<B>(res: &mut ServiceResponse<B>, name: &'static str, value: &str) {
    if let (Ok(name), Ok(value)) = (HeaderName::from_static(name), HeaderValue::from_str(value)) {
        res.headers_mut().insert(name, value);
    }
}
