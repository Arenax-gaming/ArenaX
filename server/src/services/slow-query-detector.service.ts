import { logger } from './logger.service';
import { metricsService } from './metrics.service';
import { correlationStore } from './correlation.service';

export interface SlowQueryRecord {
  query: string;
  params: unknown[];
  durationMs: number;
  model: string;
  operation: string;
  correlationId?: string;
  timestamp: Date;
}

const WARN_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '100', 10);
const ERROR_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_ERROR_THRESHOLD_MS || '500', 10);
const MAX_RECORDS = parseInt(process.env.SLOW_QUERY_MAX_RECORDS || '1000', 10);
const WINDOW_MS = 60 * 60 * 1000;

const slowQueries: SlowQueryRecord[] = [];

/**
 * Records a query execution. Queries over WARN_THRESHOLD_MS are logged at warn;
 * queries over ERROR_THRESHOLD_MS are logged at error. Each slow query is also
 * retained (bounded) for the /metrics/slow-queries endpoint.
 */
export function recordQueryExecution(
  model: string,
  operation: string,
  query: string,
  params: unknown[],
  durationMs: number
): void {
  if (durationMs < WARN_THRESHOLD_MS) return;

  const correlationId = correlationStore.getStore()?.correlationId;
  const record: SlowQueryRecord = {
    model,
    operation,
    query,
    params,
    durationMs,
    correlationId,
    timestamp: new Date(),
  };

  slowQueries.unshift(record);
  if (slowQueries.length > MAX_RECORDS) {
    slowQueries.pop();
  }

  const logPayload = {
    model,
    operation,
    durationMs,
    correlation_id: correlationId,
    query: truncateQuery(query),
  };

  if (durationMs >= ERROR_THRESHOLD_MS) {
    logger.error('Very slow query detected', logPayload);
  } else {
    logger.warn('Slow query detected', logPayload);
  }

  try {
    metricsService.recordSlowQuery(model, operation);
  } catch {
    // Never let a metrics error block the query path.
  }
}

/**
 * Returns the top N slowest queries recorded within the last hour.
 */
export function getTopSlowQueriesLastHour(limit = 10): SlowQueryRecord[] {
  const cutoff = Date.now() - WINDOW_MS;
  return slowQueries
    .filter((r) => r.timestamp.getTime() >= cutoff)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, limit);
}

export function getSlowQueries(limit = 50, offset = 0): SlowQueryRecord[] {
  return slowQueries.slice(offset, offset + limit);
}

export function getSlowQueryStats(): {
  total: number;
  averageMs: number;
  maxMs: number;
  thresholdMs: number;
  byModel: Record<string, number>;
} {
  if (slowQueries.length === 0) {
    return { total: 0, averageMs: 0, maxMs: 0, thresholdMs: WARN_THRESHOLD_MS, byModel: {} };
  }

  const byModel: Record<string, number> = {};
  let totalMs = 0;
  let maxMs = 0;

  for (const r of slowQueries) {
    byModel[r.model] = (byModel[r.model] || 0) + 1;
    totalMs += r.durationMs;
    if (r.durationMs > maxMs) maxMs = r.durationMs;
  }

  return {
    total: slowQueries.length,
    averageMs: Math.round(totalMs / slowQueries.length),
    maxMs,
    thresholdMs: WARN_THRESHOLD_MS,
    byModel,
  };
}

export function clearSlowQueries(): void {
  slowQueries.length = 0;
}

export function getSlowQueryThreshold(): number {
  return WARN_THRESHOLD_MS;
}

function truncateQuery(q: string, maxLen = 200): string {
  return q.length > maxLen ? `${q.slice(0, maxLen)}...` : q;
}
