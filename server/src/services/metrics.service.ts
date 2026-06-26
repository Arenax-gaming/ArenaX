import client from 'prom-client';
import { logger } from './logger.service';

// Enable default metrics (CPU, memory, etc.)
// Guard against duplicate registration when the module is reloaded (e.g. Jest
// resetModules or worker threads sharing the same prom-client registry).
if (!client.register.getSingleMetric('process_cpu_user_seconds_total')) {
  client.collectDefaultMetrics({ register: client.register });
}

/** Register a metric only if it has not already been registered. */
function getOrCreateHistogram(config: client.HistogramConfiguration<string>): client.Histogram<string> {
  const existing = client.register.getSingleMetric(config.name);
  if (existing) return existing as client.Histogram<string>;
  return new client.Histogram(config);
}

function getOrCreateCounter(config: client.CounterConfiguration<string>): client.Counter<string> {
  const existing = client.register.getSingleMetric(config.name);
  if (existing) return existing as client.Counter<string>;
  return new client.Counter(config);
}

function getOrCreateGauge(config: client.GaugeConfiguration<string>): client.Gauge<string> {
  const existing = client.register.getSingleMetric(config.name);
  if (existing) return existing as client.Gauge<string>;
  return new client.Gauge(config);
}

// HTTP request metrics
const httpRequestDuration = getOrCreateHistogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const httpRequestTotal = getOrCreateCounter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

// Database metrics
const dbQueryDuration = getOrCreateHistogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

const dbQueryTotal = getOrCreateCounter({
  name: 'db_queries_total',
  help: 'Total number of database queries',
  labelNames: ['operation', 'table', 'status'],
});

// Error metrics
const errorsTotal = getOrCreateCounter({
  name: 'errors_total',
  help: 'Total number of errors',
  labelNames: ['type', 'severity'],
});

// Active connections
const activeConnections = getOrCreateGauge({
  name: 'active_connections',
  help: 'Number of active connections',
});

// Response size
const responseSizeBytes = getOrCreateHistogram({
  name: 'response_size_bytes',
  help: 'Size of HTTP responses in bytes',
  labelNames: ['route'],
  buckets: [100, 1000, 10000, 100000, 1000000],
});

// Cache metrics
const cacheHitsTotal = getOrCreateCounter({
  name: 'cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['namespace'],
});

const cacheMissesTotal = getOrCreateCounter({
  name: 'cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['namespace'],
});

// Compression metrics (issue #477)
const compressionUncompressedBytes = getOrCreateCounter({
  name: 'http_response_uncompressed_bytes_total',
  help: 'Total number of uncompressed response bytes (what the app would have sent)',
  labelNames: ['encoding'],
});

const compressionCompressedBytes = getOrCreateCounter({
  name: 'http_response_compressed_bytes_total',
  help: 'Total number of compressed (wire) response bytes',
  labelNames: ['encoding'],
});

const compressionRatio = getOrCreateHistogram({
  name: 'http_response_compression_ratio',
  help: 'Distribution of per-response compression ratios (compressed/uncompressed)',
  labelNames: ['encoding'],
  buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
});

export class MetricsService {
  private static instance: MetricsService;

  private constructor() {
    logger.info('Metrics service initialized');
  }

  static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  // HTTP metrics
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number) {
    httpRequestDuration.observe({ method, route, status_code: statusCode }, duration);
    httpRequestTotal.inc({ method, route, status_code: statusCode });
  }

  recordResponseSize(route: string, size: number) {
    responseSizeBytes.observe({ route }, size);
  }

  // Database metrics
  recordDbQuery(operation: string, table: string, duration: number, status: 'success' | 'error') {
    dbQueryDuration.observe({ operation, table }, duration);
    dbQueryTotal.inc({ operation, table, status });
  }

  // Error metrics
  recordError(type: string, severity: 'low' | 'medium' | 'high' | 'critical') {
    errorsTotal.inc({ type, severity });
  }

  // Cache metrics
  recordCacheHit(namespace: string) {
    cacheHitsTotal.inc({ namespace });
  }

  recordCacheMiss(namespace: string) {
    cacheMissesTotal.inc({ namespace });
  }

  // Compression metrics (issue #477)
  recordCompression(
    encoding: string,
    payload: { uncompressedBytes: number; compressedBytes: number; ratio: number },
  ) {
    compressionUncompressedBytes.inc({ encoding }, payload.uncompressedBytes);
    compressionCompressedBytes.inc({ encoding }, payload.compressedBytes);
    compressionRatio.observe({ encoding }, payload.ratio);
  }

  // Connection metrics
  setActiveConnections(count: number) {
    activeConnections.set(count);
  }

  incrementActiveConnections() {
    activeConnections.inc();
  }

  decrementActiveConnections() {
    activeConnections.dec();
  }

  // Get metrics for Prometheus
  async getMetrics(): Promise<string> {
    return await client.register.metrics();
  }

  // Reset all metrics (useful for testing)
  resetMetrics(): void {
    // Reset individual metrics since Registry.reset() is not available
    httpRequestTotal.reset();
    httpRequestDuration.reset();
    dbQueryTotal.reset();
    dbQueryDuration.reset();
    errorsTotal.reset();
    activeConnections.reset();
    responseSizeBytes.reset();
    cacheHitsTotal.reset();
    cacheMissesTotal.reset();
    logger.info('Metrics reset');
  }

  // Get metric summary for dashboard
  async getMetricSummary(): Promise<{
    httpRequests: {
      total: number;
      avgDuration: number;
      byStatus: Record<string, number>;
    };
    dbQueries: {
      total: number;
      avgDuration: number;
      byTable: Record<string, number>;
    };
    errors: {
      total: number;
      bySeverity: Record<string, number>;
    };
    activeConnections: number;
  }> {
    const httpRequests = await httpRequestTotal.get();
    const dbQueries = await dbQueryTotal.get();
    const errors = await errorsTotal.get();
    const connections = await activeConnections.get();

    // Calculate totals by status
    const byStatus: Record<string, number> = {};
    httpRequests.values.forEach((value: any) => {
      const status = value.labels.status_code;
      byStatus[status] = (byStatus[status] || 0) + value.value;
    });

    // Calculate totals by table
    const byTable: Record<string, number> = {};
    dbQueries.values.forEach((value: any) => {
      const table = value.labels.table;
      byTable[table] = (byTable[table] || 0) + value.value;
    });

    // Calculate errors by severity
    const bySeverity: Record<string, number> = {};
    errors.values.forEach((value: any) => {
      const severity = value.labels.severity;
      bySeverity[severity] = (bySeverity[severity] || 0) + value.value;
    });

    return {
      httpRequests: {
        total: httpRequests.values.reduce((sum: number, v: any) => sum + v.value, 0),
        avgDuration: 0, // Would need to calculate from histogram
        byStatus,
      },
      dbQueries: {
        total: dbQueries.values.reduce((sum: number, v: any) => sum + v.value, 0),
        avgDuration: 0,
        byTable,
      },
      errors: {
        total: errors.values.reduce((sum: number, v: any) => sum + v.value, 0),
        bySeverity,
      },
      activeConnections: connections.values[0]?.value || 0,
    };
  }
}

export const metricsService = MetricsService.getInstance();
