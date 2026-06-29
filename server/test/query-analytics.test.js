import test from 'node:test'
import assert from 'node:assert'

test('getAnalyticsSnapshot returns default state when empty', async () => {
  const svc = await import('../dist/services/query-analytics.service.js')
  svc.resetAnalytics()

  const snap = svc.getAnalyticsSnapshot()
  assert.strictEqual(snap.totalQueries, 0)
  assert.strictEqual(snap.averageQueryTimeMs, 0)
  assert.strictEqual(snap.cacheHitRate, 0)
})

test('recordMetric tracks query performance', async () => {
  const svc = await import('../dist/services/query-analytics.service.js')
  svc.resetAnalytics()

  svc.recordMetric({ model: 'User', durationMs: 50, isSlow: false, isCached: true, isError: false, timestamp: new Date() })
  svc.recordMetric({ model: 'User', durationMs: 600, isSlow: true, isCached: false, isError: false, timestamp: new Date() })
  svc.recordMetric({ model: 'Match', durationMs: 200, isSlow: false, isCached: false, isError: false, timestamp: new Date() })

  const snap = svc.getAnalyticsSnapshot()
  assert.strictEqual(snap.totalQueries, 3)
  assert.strictEqual(snap.slowQueries, 1)
  assert.strictEqual(snap.cacheHitRate, 33)
  assert.strictEqual(snap.queriesByModel['User'], 2)
  assert.strictEqual(snap.queriesByModel['Match'], 1)
})

test('resetAnalytics clears all metrics', async () => {
  const svc = await import('../dist/services/query-analytics.service.js')
  svc.recordMetric({ model: 'Test', durationMs: 100, isSlow: false, isCached: false, isError: false, timestamp: new Date() })
  svc.resetAnalytics()

  assert.strictEqual(svc.getAnalyticsSnapshot().totalQueries, 0)
})
