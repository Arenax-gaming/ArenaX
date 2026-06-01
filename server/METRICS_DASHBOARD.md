# Server Metrics Dashboard

This document describes the metrics dashboard implementation for the ArenaX server.

## Overview

The metrics dashboard provides real-time monitoring of server performance, including HTTP requests, database queries, errors, and active connections. It uses Prometheus-compatible metrics collection and includes a web-based dashboard for visualization.

## Features

- **Prometheus Metrics**: Exposes metrics in Prometheus format for scraping
- **Web Dashboard**: Visual dashboard at `/dashboard` for quick monitoring
- **HTTP Request Tracking**: Tracks request duration, status codes, and response sizes
- **Database Query Monitoring**: Monitors query performance and success rates
- **Error Tracking**: Categorizes errors by severity (low, medium, high, critical)
- **Connection Monitoring**: Tracks active connections in real-time
- **Configurable**: Can be enabled/disabled via environment variables

## Configuration

Add the following to your `.env` file:

```env
# Metrics Configuration
# Enable/disable Prometheus metrics collection
METRICS_ENABLED="true"
# Port for metrics endpoint (if separate from main server)
METRICS_PORT="9090"
```

## Endpoints

### `/api/metrics` (Prometheus Endpoint)

Exposes metrics in Prometheus format for scraping by Prometheus or other monitoring tools.

**Example:**
```bash
curl http://localhost:3001/api/metrics
```

### `/api/metrics/summary` (Summary Endpoint)

Returns a JSON summary of current metrics for programmatic access.

**Response Example:**
```json
{
  "httpRequests": {
    "total": 1234,
    "avgDuration": 0.05,
    "byStatus": {
      "200": 1200,
      "404": 30,
      "500": 4
    }
  },
  "dbQueries": {
    "total": 5678,
    "avgDuration": 0.01,
    "byTable": {
      "users": 2000,
      "matches": 1500,
      "tournaments": 2178
    }
  },
  "errors": {
    "total": 15,
    "bySeverity": {
      "low": 5,
      "medium": 7,
      "high": 2,
      "critical": 1
    }
  },
  "activeConnections": 42
}
```

### `/dashboard` (Web Dashboard)

A web-based dashboard for visual monitoring. Access at:
```
http://localhost:3001/dashboard
```

The dashboard auto-refreshes every 30 seconds and displays:
- HTTP request statistics (total, by status code)
- Database query metrics (total, success rate)
- Error counts (total, by severity)
- Active connections

## Metrics Collected

### HTTP Metrics
- `http_request_duration_seconds`: Histogram of HTTP request durations
- `http_requests_total`: Counter of total HTTP requests
- `response_size_bytes`: Histogram of response sizes

### Database Metrics
- `db_query_duration_seconds`: Histogram of database query durations
- `db_queries_total`: Counter of total database queries

### Error Metrics
- `errors_total`: Counter of total errors by type and severity

### Connection Metrics
- `active_connections`: Gauge of current active connections

### System Metrics (Default)
- CPU usage
- Memory usage
- Event loop lag
- And more (provided by prom-client default metrics)

## Integration with Prometheus

To integrate with Prometheus, add the following to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'arenax-server'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3001']
    metrics_path: '/api/metrics'
```

## Usage in Code

### Recording HTTP Metrics

The metrics middleware automatically records HTTP request metrics. No additional code is needed.

### Recording Database Metrics

```typescript
import { metricsService } from '../services/metrics.service';

// Record a successful query
const startTime = Date.now();
try {
  await prisma.user.findMany();
  const duration = (Date.now() - startTime) / 1000;
  metricsService.recordDbQuery('select', 'users', duration, 'success');
} catch (error) {
  const duration = (Date.now() - startTime) / 1000;
  metricsService.recordDbQuery('select', 'users', duration, 'error');
  metricsService.recordError('database', 'high');
}
```

### Recording Errors

```typescript
import { metricsService } from '../services/metrics.service';

metricsService.recordError('authentication', 'critical');
```

### Tracking Connections

```typescript
import { metricsService } from '../services/metrics.service';

// When a connection is established
metricsService.incrementActiveConnections();

// When a connection is closed
metricsService.decrementActiveConnections();
```

## Environment-Specific Configuration

### Production
```env
METRICS_ENABLED="true"
METRICS_PORT="9090"
```

### Staging
```env
METRICS_ENABLED="true"
METRICS_PORT="9090"
```

### Development
```env
METRICS_ENABLED="true"
METRICS_PORT="9090"
```

### Testing
```env
METRICS_ENABLED="false"
```

## Security Considerations

- The `/api/metrics` endpoint is protected by the rate limiter
- Consider adding authentication for production deployments
- The dashboard should be accessible only to authorized personnel
- Use firewall rules to restrict access to metrics endpoints

## Troubleshooting

### Metrics not appearing
1. Check that `METRICS_ENABLED=true` in your environment
2. Verify the metrics middleware is loaded in `app.ts`
3. Check server logs for errors

### Dashboard not loading
1. Ensure the server is running
2. Check that the `/dashboard` route is registered
3. Verify CORS settings if accessing from a different domain

### High memory usage
- Consider increasing the scrape interval in Prometheus
- Review metric retention policies
- Disable metrics in test environments

## Future Enhancements

- Add Grafana dashboard templates
- Implement alerting rules
- Add custom metric labels
- Support for histogram quantiles
- Real-time WebSocket updates for dashboard
- Historical data persistence
