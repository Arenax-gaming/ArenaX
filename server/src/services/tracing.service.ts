/**
 * tracing.service.ts
 *
 * OpenTelemetry distributed tracing bootstrap for the ArenaX HTTP API
 * (#478).
 *
 * Design:
 * - Tracing is *opt-in* via `OTEL_EXPORTER_OTLP_ENDPOINT`. With the env
 *   var unset, `initTracing()` is a no-op so non-prod / CI runs aren't
 *   penalised by trace overhead.
 * - The exporter uses OTLP-over-HTTP (the standard wire protocol). The
 *   destination can be Jaeger (local), Tempo (staging), Grafana Cloud,
 *   or any other OTLP collector — no code change required.
 * - Auto-instrumentations cover Express, http, ioredis, and Prisma
 *   query latency out of the box. Manual spans for blockchain calls and
 *   queue workers can be added with `withSpan(name, attrs, fn)`.
 * - W3C `traceparent` propagation is set up via the SDK's default
 *   propagator stack; `traceparentResponseMiddleware()` echoes the
 *   active context back on every response so the frontend can link a
 *   Sentry event to its server-side trace.
 *
 * Imports use `require()` inside `initTracing()` so the OTel SDK is
 * only loaded when tracing is enabled — this keeps the cold-start
 * surface small for test runs and disabled deployments.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from './logger.service';

let started = false;

export const isTracingEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT);

export interface TracingHandle {
  shutdown(): Promise<void>;
}

let activeHandle: TracingHandle | null = null;

/**
 * Initialise the OTel NodeSDK with HTTP + Express + ioredis
 * auto-instrumentation. Returns a handle for `shutdown()` (called
 * during graceful shutdown). Safe to call multiple times — subsequent
 * calls return the existing handle.
 */
export const initTracing = (env: NodeJS.ProcessEnv = process.env): TracingHandle | null => {
  if (started) return activeHandle;
  if (!isTracingEnabled(env)) {
    logger.info('Tracing disabled: OTEL_EXPORTER_OTLP_ENDPOINT is not configured');
    return null;
  }

  try {
    // Lazy-require so consumers without OTel installed can still boot.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resource } = require('@opentelemetry/resources');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace-base');

    const serviceName = env.OTEL_SERVICE_NAME ?? 'arenax-server';
    const sampleRatio = clampFloat(env.OTEL_TRACES_SAMPLER_ARG, 0, 1, 1);

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]:
          env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
          env.NODE_ENV ?? 'development',
      }),
      traceExporter: new OTLPTraceExporter({
        url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
      }),
      sampler: new TraceIdRatioBasedSampler(sampleRatio),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    sdk.start();
    started = true;
    logger.info('Tracing initialized', {
      provider: 'opentelemetry',
      endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      serviceName,
      sampleRatio,
    });

    activeHandle = {
      async shutdown() {
        try {
          await sdk.shutdown();
        } catch (err) {
          logger.error('Tracing shutdown failed', { error: err });
        }
      },
    };
    return activeHandle;
  } catch (err) {
    logger.error('Failed to initialise tracing', { error: err });
    return null;
  }
};

const clampFloat = (raw: string | undefined, min: number, max: number, fallback: number): number => {
  if (!raw) return fallback;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/**
 * Run `fn` inside a named span with `attrs` set as span attributes.
 * If tracing is disabled, executes `fn` directly with no overhead.
 */
export const withSpan = async <T>(
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: () => Promise<T> | T,
): Promise<T> => {
  if (!started) return await fn();
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { trace } = require('@opentelemetry/api');
    const tracer = trace.getTracer('arenax-server');
    return await tracer.startActiveSpan(name, async (span: any) => {
      try {
        for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
        const result = await fn();
        span.setStatus({ code: 1 }); // OK
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2, message: (err as Error).message }); // ERROR
        throw err;
      } finally {
        span.end();
      }
    });
  } catch {
    return await fn();
  }
};

/**
 * Express middleware that, when tracing is on, propagates the current
 * `traceparent` (W3C TraceContext) back on the HTTP response so the
 * frontend can link a Sentry event to its server-side trace.
 */
export const traceparentResponseMiddleware = (): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!started) return next();
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { propagation, context } = require('@opentelemetry/api');
      const carrier: Record<string, string> = {};
      propagation.inject(context.active(), carrier);
      if (carrier.traceparent) {
        res.setHeader('traceparent', carrier.traceparent);
        // CORS exposed-headers — the frontend needs to read this one.
        const existing = res.getHeader('Access-Control-Expose-Headers');
        const value = existing ? `${existing}, traceparent` : 'traceparent';
        res.setHeader('Access-Control-Expose-Headers', value);
      }
    } catch {
      /* propagation is best-effort */
    }
    next();
  };
};

/**
 * Used in graceful shutdown to flush in-flight spans before the
 * process exits. Safe to call when tracing is disabled.
 */
export const shutdownTracing = async (): Promise<void> => {
  if (activeHandle) {
    await activeHandle.shutdown();
    activeHandle = null;
    started = false;
  }
};
