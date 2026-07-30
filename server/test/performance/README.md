# k6 Performance Testing for ArenaX API

This directory contains performance testing scripts for load testing, stress testing, and performance benchmarking using k6.

## Overview

k6 is a modern load testing tool that uses JavaScript to write test scenarios. This implementation provides comprehensive performance testing for the ArenaX API.

## Setup

### Prerequisites

1. **Install k6**:
   ```bash
   # macOS
   brew install k6
   
   # Linux
   sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
   echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt-get update
   sudo apt-get install k6
   
   # Or download from https://k6.io/docs/getting-started/installation/
   ```

2. **Verify installation**:
   ```bash
   k6 version
   ```

## Test Types

### 1. Load Test (`load-test.js`)

Simulates normal traffic patterns to measure API performance under expected load.

**Configuration:**
- Ramp up to 50 users over 2 minutes
- Sustain at 50 users for 5 minutes
- Ramp up to 100 users over 2 minutes
- Sustain at 100 users for 5 minutes
- Ramp up to 200 users over 2 minutes
- Sustain at 200 users for 5 minutes
- Ramp down to 0 users

**Thresholds:**
- 95% of requests under 500ms
- 99% of requests under 1s
- Error rate less than 1%

### 2. Stress Test (`stress-test.js`)

Pushes the API to its limits to find breaking points and bottlenecks.

**Configuration:**
- Ramp up to 100 users over 2 minutes
- Ramp up to 200 users over 3 minutes
- Ramp up to 500 users over 3 minutes
- Ramp up to 1000 users over 5 minutes (stress level)
- Ramp up to 2000 users over 5 minutes (extreme stress)
- Ramp up to 3000 users over 3 minutes (breaking point)
- Sustain at 3000 users for 5 minutes
- Ramp down to 0 users

**Thresholds:**
- 95% of requests under 2s
- 99% of requests under 5s
- Error rate less than 5% (more lenient for stress test)

### 3. Benchmark Test (`benchmark-test.js`)

Establishes baseline performance metrics for API endpoints.

**Configuration:**
- Warm up with 10 users for 1 minute
- Benchmark at 50 users for 5 minutes
- Sustained load at 50 users for 5 minutes
- Cool down to 0 users

**Thresholds:**
- 50% of requests under 200ms
- 95% of requests under 500ms
- 99% of requests under 1s
- Error rate less than 1%

**Custom Metrics:**
- Health check duration (p95 < 100ms)
- Profile duration (p95 < 300ms)
- Matches duration (p95 < 500ms)
- Tournaments duration (p95 < 500ms)
- Leaderboard duration (p95 < 300ms)

## Usage

### Quick Start

```bash
# Set environment variables
export API_BASE_URL="http://localhost:3001/api"
export API_TOKEN="your-jwt-token"

# Run load test
./test/performance/run-k6-tests.sh load

# Run stress test
./test/performance/run-k6-tests.sh stress

# Run benchmark test
./test/performance/run-k6-tests.sh benchmark

# Run all tests (load + benchmark)
./test/performance/run-k6-tests.sh all
```

### Manual Execution

```bash
# Run load test
k6 run --out json=reports/load-test.json test/performance/load-test.js

# Run stress test
k6 run --out json=reports/stress-test.json test/performance/stress-test.js

# Run benchmark test
k6 run --out json=reports/benchmark-test.json test/performance/benchmark-test.js

# With environment variables
API_BASE_URL="http://localhost:3001/api" API_TOKEN="token" k6 run test/performance/load-test.js
```

### Output Formats

k6 supports multiple output formats:

```bash
# JSON output
k6 run --out json=report.json test/performance/load-test.js

# InfluxDB for visualization
k6 run --out influxdb=http://localhost:8086/k6 test/performance/load-test.js

# Prometheus for monitoring
k6 run --out prometheus=127.0.0.1:9090 test/performance/load-test.js

# Cloud (k6 Cloud)
k6 cloud test/performance/load-test.js
```

## Reports

Reports are saved to `./test/performance/reports/` with timestamps:
- `load-test-<timestamp>.json`
- `stress-test-<timestamp>.json`
- `benchmark-test-<timestamp>.json`

### Viewing Reports

```bash
# View JSON report
cat reports/load-test-<timestamp>.json | jq

# Generate HTML report (requires k6-reporter)
k6 run --out json=report.json test/performance/load-test.js
k6-reporter report.json
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Performance Tests

on: [push, pull_request]

jobs:
  performance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6
      - name: Start API server
        run: npm run dev &
      - name: Wait for server
        run: sleep 10
      - name: Run load test
        run: ./test/performance/run-k6-tests.sh load
      - name: Run benchmark test
        run: ./test/performance/run-k6-tests.sh benchmark
```

### GitLab CI

```yaml
performance:
  script:
    - apt-get update && apt-get install -y k6
    - npm run dev &
    - sleep 10
    - ./test/performance/run-k6-tests.sh load
    - ./test/performance/run-k6-tests.sh benchmark
  artifacts:
    paths:
      - test/performance/reports/
```

## Performance Metrics

### Key Metrics to Monitor

- **Response Time**: How long requests take to complete
- **Throughput**: Requests per second
- **Error Rate**: Percentage of failed requests
- **Latency**: Time to first byte
- **Connection Time**: Time to establish connection

### Performance Targets

- **Health Check**: < 100ms (p95)
- **User Profile**: < 300ms (p95)
- **Matches List**: < 500ms (p95)
- **Tournaments**: < 500ms (p95)
- **Leaderboard**: < 300ms (p95)

## Troubleshooting

### k6 command not found
- Install k6 using the instructions above
- Verify installation with `k6 version`

### Tests fail immediately
- Check if API server is running
- Verify API_BASE_URL is correct
- Check network connectivity

### High error rates
- Verify API_TOKEN is valid
- Check API server logs
- Ensure endpoints are accessible

### Slow performance
- Check server resources (CPU, memory)
- Review database queries
- Check network latency
- Review rate limiting configuration

## Best Practices

1. **Run tests regularly**: Integrate into CI/CD pipeline
2. **Monitor trends**: Track performance over time
3. **Set realistic targets**: Base thresholds on business requirements
4. **Test in staging**: Run tests in staging environment before production
5. **Analyze results**: Review metrics and identify bottlenecks
6. **Optimize iteratively**: Make changes and re-test

## Advanced Features

### Custom Metrics

Add custom metrics in test scripts:

```javascript
import { Trend, Counter, Rate } from 'k6/metrics';

const customTrend = new Trend('custom_metric');
const customCounter = new Counter('custom_counter');
const customRate = new Rate('custom_rate');

export default function () {
  customTrend.add(responseTime);
  customCounter.add(1);
  customRate.add(success ? 1 : 0);
}
```

### Parameterized Tests

Use environment variables for flexibility:

```javascript
const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3001/api';
const API_TOKEN = __ENV.API_TOKEN || '';
```

### Data-Driven Testing

Load test data from files:

```javascript
import { SharedArray } from 'k6/data';

const data = new SharedArray('test data', function () {
  return JSON.parse(open('./test-data.json')).users;
});
```

## Resources

- [k6 Documentation](https://k6.io/docs/)
- [k6 Examples](https://k6.io/docs/examples/)
- [ArenaX API Documentation](http://localhost:3001/redoc)
- [Performance Testing Best Practices](https://k6.io/docs/test-guides/)
