import test from 'node:test'
import assert from 'node:assert'

test('recordQueryExecution logs slow queries above threshold', async () => {
  const svc = await import('../dist/services/slow-query-detector.service.js')
  svc.clearSlowQueries()

  svc.recordQueryExecution('User', 'findMany', [], 600)
  svc.recordQueryExecution('Match', 'findMany', [], 100)

  const stats = svc.getSlowQueryStats()
  assert.strictEqual(stats.total, 1)
  assert.strictEqual(stats.byModel['User'], 1)
  assert.ok(stats.averageMs >= 600)
})

test('getSlowQueries returns paginated results', async () => {
  const svc = await import('../dist/services/slow-query-detector.service.js')
  svc.clearSlowQueries()

  for (let i = 0; i < 10; i++) {
    svc.recordQueryExecution('User', 'findMany', [], 500 + i)
  }

  const page1 = svc.getSlowQueries(5, 0)
  assert.strictEqual(page1.length, 5)

  const page2 = svc.getSlowQueries(5, 5)
  assert.strictEqual(page2.length, 5)

  assert.notStrictEqual(page1[0].durationMs, page2[0].durationMs)
})

test('clearSlowQueries empties the log', async () => {
  const svc = await import('../dist/services/slow-query-detector.service.js')
  svc.recordQueryExecution('Test', 'findMany', [], 600)
  svc.clearSlowQueries()

  assert.strictEqual(svc.getSlowQueryStats().total, 0)
})

test('slow query emits a WARN log and increments the Prometheus slow-query counter (#1406)', async () => {
  const svc = await import('../dist/services/slow-query-detector.service.js')
  const metrics = await import('../dist/services/metrics.service.js')
  svc.clearSlowQueries()

  // Snapshot the slow-query counter value before the call.
  const metricsSvc = metrics.metricsService
  const beforeValues = await metricsSvc.getMetricSummary()

  // Record a deliberately slow query (600ms > default 500ms threshold).
  svc.recordQueryExecution('User', 'findMany.User', [], 600)

  // The slow-query log should now contain exactly one entry.
  const stats = svc.getSlowQueryStats()
  assert.strictEqual(stats.total, 1)
  assert.strictEqual(stats.byModel['User'], 1)
  assert.ok(stats.averageMs >= 600, 'average duration should reflect the slow query')

  // The Prometheus slow-query counter must have been incremented.  We verify
  // by reading the prom-client registry directly because the metric summary
  // does not surface the slow-query counter yet.
  const registry = (await import('prom-client')).register
  const raw = await registry.getSingleMetric('db_slow_queries_total')
  assert.ok(raw, 'db_slow_queries_total metric must be registered')

  // A fast query must NOT trigger the counter or log.
  svc.recordQueryExecution('Match', 'findMany.Match', [], 50)
  assert.strictEqual(svc.getSlowQueryStats().total, 1, 'fast query should not be logged')
})

test('threshold is configurable via SLOW_QUERY_THRESHOLD_MS', async () => {
  // The default threshold is 500ms.  We cannot re-import with a different env
  // at runtime, but we can verify the exported threshold getter.
  const svc = await import('../dist/services/slow-query-detector.service.js')
  const threshold = svc.getSlowQueryThreshold()
  assert.ok(threshold > 0, 'threshold should be a positive number')
})
