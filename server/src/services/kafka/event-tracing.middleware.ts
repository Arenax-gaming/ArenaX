/**
 * Event tracing middleware for Kafka observability.
 *
 * Provides:
 * 1. `withEventTrace` — wraps any async producer call, injecting/propagating
 *    trace IDs and emitting structured logs.
 * 2. `extractTraceContext` — reads trace headers from incoming Kafka messages.
 * 3. `eventTracingMiddleware` — Express-compatible middleware that stamps each
 *    HTTP request with a traceId that callers forward into Kafka events.
 */
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { IHeaders } from 'kafkajs';
import { logger } from '../logger.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TraceContext {
  traceId: string;
  spanId: string;
  /** Optional parent span id from upstream. */
  parentSpanId?: string;
}

// ─── Express middleware ───────────────────────────────────────────────────────

/**
 * Attaches a `traceId` to every HTTP request.
 * Subsequent event publishes should call `req.traceId` to propagate context.
 */
export function eventTracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId =
    (req.headers['x-trace-id'] as string) ??
    (req.headers['x-request-id'] as string) ??
    uuidv4();

  (req as Request & { traceId: string }).traceId = traceId;
  res.setHeader('x-trace-id', traceId);
  next();
}

// ─── Producer-side trace injection ───────────────────────────────────────────

/**
 * Wrap a producer call with automatic trace emission and timing.
 *
 * @example
 *   await withEventTrace('match.ended', traceId, () =>
 *     matchProducer.publishMatchEnded(payload, traceId)
 *   );
 */
export async function withEventTrace<T>(
  eventType: string,
  traceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const spanId = uuidv4().slice(0, 8);
  const start = Date.now();

  logger.info('Event trace: start', { eventType, traceId, spanId });

  try {
    const result = await fn();
    const durationMs = Date.now() - start;

    logger.info('Event trace: success', { eventType, traceId, spanId, durationMs });

    if (durationMs > 100) {
      logger.warn('Event publish exceeded 100ms SLA', { eventType, traceId, durationMs });
    }

    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    logger.error('Event trace: error', {
      eventType,
      traceId,
      spanId,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ─── Consumer-side trace extraction ──────────────────────────────────────────

/**
 * Extract trace context from incoming Kafka message headers.
 * Falls back to new IDs when headers are absent.
 */
export function extractTraceContext(headers: IHeaders = {}): TraceContext {
  const get = (key: string): string | undefined => {
    const v = headers[key];
    if (!v) return undefined;
    return Buffer.isBuffer(v) ? v.toString() : (v as string);
  };

  return {
    traceId: get('traceId') ?? uuidv4(),
    spanId: uuidv4().slice(0, 8),
    parentSpanId: get('spanId'),
  };
}

// ─── Consumer-side observability hook ────────────────────────────────────────

/**
 * Log a structured consumed-event record.
 * Call at the start of each EventConsumer.handle() implementation.
 */
export function logConsumedEvent(
  eventType: string,
  eventId: string,
  traceId: string,
  groupId: string,
): void {
  logger.info('Event consumed', { eventType, eventId, traceId, groupId });
}
