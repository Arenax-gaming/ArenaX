import { logger } from './logger.service';

export interface QueryAnalyticsSnapshot {
  timestamp: Date;
  totalQueries: number;
  slowQueries: number;
  averageQueryTimeMs: number;
  p95QueryTimeMs: number;
  p99QueryTimeMs: number;
  cacheHitRate: number;
  queriesByModel: Record<string, number>;
  errors: number;
}

interface QueryMetric {
  model: string;
  durationMs: number;
  isSlow: boolean;
  isCached: boolean;
  isError: boolean;
  timestamp: Date;
}

const MAX_METRICS = 10000;
const metrics: QueryMetric[] = [];

export function recordMetric(metric: QueryMetric): void {
  metrics.push(metric);
  if (metrics.length > MAX_METRICS) {
    metrics.splice(0, metrics.length - MAX_METRICS);
  }
}

export function getAnalyticsSnapshot(): QueryAnalyticsSnapshot {
  if (metrics.length === 0) {
    return {
      timestamp: new Date(),
      totalQueries: 0,
      slowQueries: 0,
      averageQueryTimeMs: 0,
      p95QueryTimeMs: 0,
      p99QueryTimeMs: 0,
      cacheHitRate: 0,
      queriesByModel: {},
      errors: 0,
    };
  }

  const sorted = [...metrics].sort((a, b) => a.durationMs - b.durationMs);
  const totalQueries = metrics.length;
  const slowQueries = metrics.filter((m) => m.isSlow).length;
  const errors = metrics.filter((m) => m.isError).length;
  const cached = metrics.filter((m) => m.isCached).length;
  const totalTime = metrics.reduce((s, m) => s + m.durationMs, 0);

  const byModel: Record<string, number> = {};
  for (const m of metrics) {
    byModel[m.model] = (byModel[m.model] || 0) + 1;
  }

  const p95Idx = Math.floor(sorted.length * 0.95);
  const p99Idx = Math.floor(sorted.length * 0.99);

  return {
    timestamp: new Date(),
    totalQueries,
    slowQueries,
    averageQueryTimeMs: Math.round(totalTime / totalQueries),
    p95QueryTimeMs: sorted[p95Idx]?.durationMs ?? 0,
    p99QueryTimeMs: sorted[p99Idx]?.durationMs ?? 0,
    cacheHitRate: totalQueries > 0 ? Math.round((cached / totalQueries) * 100) : 0,
    queriesByModel: byModel,
    errors,
  };
}

export function resetAnalytics(): void {
  metrics.length = 0;
  logger.info('Query analytics reset');
}
