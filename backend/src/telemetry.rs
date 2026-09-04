//! Distributed tracing setup.
//!
//! Wires `tracing` spans into an OpenTelemetry OTLP pipeline so requests can
//! be followed end-to-end across services in Jaeger or Datadog (both accept
//! OTLP/gRPC), and installs the W3C `traceparent`/`tracestate` propagator so
//! trace context survives calls to and from other services.
use std::env;
use std::time::Duration;

use opentelemetry::trace::TracerProvider as _;
use opentelemetry::{global, KeyValue};
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Handle kept alive for the lifetime of the process so spans can be flushed
/// and exported on shutdown.
pub struct TelemetryGuard {
    provider: Option<SdkTracerProvider>,
}

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        if let Some(provider) = self.provider.take() {
            if let Err(e) = provider.shutdown() {
                eprintln!("Failed to shut down tracer provider: {e}");
            }
        }
    }
}

/// Initialize structured logging plus (optionally) OpenTelemetry trace export.
///
/// Set `OTEL_EXPORTER_OTLP_ENDPOINT` to point at a Jaeger or Datadog Agent
/// OTLP/gRPC receiver (e.g. `http://localhost:4317`). When unset, tracing
/// still runs with the fmt layer only — no export, no panic — so local dev
/// without a collector keeps working.
pub fn init_telemetry() -> TelemetryGuard {
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| "backend=info,actix_web=info".into());

    global::set_text_map_propagator(TraceContextPropagator::new());

    let otlp_endpoint = env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok();

    let provider = otlp_endpoint.as_ref().and_then(|endpoint| {
        let service_name =
            env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "arenax-backend".to_string());

        let exporter = opentelemetry_otlp::SpanExporter::builder()
            .with_tonic()
            .with_endpoint(endpoint.clone())
            .with_timeout(Duration::from_secs(3))
            .build();

        match exporter {
            Ok(exporter) => {
                let resource = Resource::builder()
                    .with_attribute(KeyValue::new("service.name", service_name))
                    .with_attribute(KeyValue::new(
                        "deployment.environment",
                        env::var("APP_ENV").unwrap_or_else(|_| "development".to_string()),
                    ))
                    .build();

                let provider = SdkTracerProvider::builder()
                    .with_batch_exporter(exporter)
                    .with_resource(resource)
                    .build();

                global::set_tracer_provider(provider.clone());
                Some(provider)
            }
            Err(e) => {
                eprintln!("Failed to build OTLP span exporter for {endpoint}: {e}");
                None
            }
        }
    });

    let otel_layer = provider.as_ref().map(|provider| {
        let tracer = provider.tracer("arenax-backend");
        tracing_opentelemetry::layer().with_tracer(tracer)
    });

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .with(otel_layer)
        .init();

    if provider.is_some() {
        tracing::info!(
            endpoint = otlp_endpoint.as_deref().unwrap_or(""),
            "OpenTelemetry trace export enabled"
        );
    } else {
        tracing::info!(
            "OTEL_EXPORTER_OTLP_ENDPOINT not set (or exporter init failed) — tracing spans stay local only"
        );
    }

    TelemetryGuard { provider }
}
