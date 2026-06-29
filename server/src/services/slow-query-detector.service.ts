import { logger } from './logger.service';

export interface SlowQueryRecord {
  query: string;
  params: unknown[];
  durationMs: number;
  model: string;
  timestamp: Date;
}

const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '500', 10);
const MAX_RECORDS = parseInt(process.env.SLOW_QUERY_MAX_RECORDS || '1000', 10);

const slowQueries: SlowQueryRecord[] = [];

export function recordQueryExecution(
  model: string,
  query: string,
  params: unknown[],
  durationMs: number
): void {
  if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
    const record: SlowQueryRecord = {
      model,
      query,
      params,
      durationMs,
      timestamp: new Date(),
    };

    slowQueries.unshift(record);
    if (slowQueries.length > MAX_RECORDS) {
      slowQueries.pop();
    }

    logger.warn('Slow query detected', {
      model,
      durationMs,
      threshold: SLOW_QUERY_THRESHOLD_MS,
      query: truncateQuery(query),
    });
  }
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
    return { total: 0, averageMs: 0, maxMs: 0, thresholdMs: SLOW_QUERY_THRESHOLD_MS, byModel: {} };
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
    thresholdMs: SLOW_QUERY_THRESHOLD_MS,
    byModel,
  };
}

export function clearSlowQueries(): void {
  slowQueries.length = 0;
}

export function getSlowQueryThreshold(): number {
  return SLOW_QUERY_THRESHOLD_MS;
}

function truncateQuery(q: string, maxLen = 200): string {
  return q.length > maxLen ? `${q.slice(0, maxLen)}...` : q;
}
