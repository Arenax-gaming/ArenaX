import test from 'node:test'
import assert from 'node:assert'

test('Analytics returns aggregated metrics', async () => {
  const { createAnalyticsService } = await import('../dist/services/analytics.service.js')
  let testTime = 1000000000000
  const service = createAnalyticsService({ now: () => testTime, maxEventRetention: 1000 })
  await service.trackEvent('user-1', 'match_completed', { wager: 100, reward: 120 })
  await service.trackEvent('user-2', 'match_completed', { wager: 200, reward: 180 })
  await service.trackEvent('user-1', 'session_ended', { duration: 300 })
  const metrics = await service.getAggregatedMetrics('24h')
  assert.strictEqual(metrics.totalMatches, 2)
  assert.strictEqual(metrics.uniquePlayers, 2)
  assert.strictEqual(metrics.totalVolume, 300)
  assert.strictEqual(metrics.totalRewards, 300)
})

test('Analytics returns privacy-preserving metrics', async () => {
  const { createAnalyticsService } = await import('../dist/services/analytics.service.js')
  const service = createAnalyticsService()
  await service.trackEvent('user-1', 'match_completed', { wager: 100 })
  await service.trackEvent('user-2', 'match_completed', { wager: 200 })
  const metrics = await service.getPrivacyPreservingMetrics(['total_matches', 'unique_players'], 1.0)
  assert.strictEqual(metrics.length, 2)
  assert.ok(metrics[0].epsilon === 1.0)
  assert.ok(typeof metrics[0].value === 'number')
  assert.ok(Array.isArray(metrics[0].confidenceInterval))
})

test('Analytics returns health status', async () => {
  const { createAnalyticsService } = await import('../dist/services/analytics.service.js')
  const service = createAnalyticsService()
  await service.trackEvent('user-1', 'match_started', {})
  await service.trackEvent('user-1', 'match_completed', {})
  const health = await service.getAnalyticsHealth()
  assert.strictEqual(health.totalEventsProcessed, 2)
  assert.ok(health.timestamp > 0)
})

test('Analytics tracks player engagement across sessions', async () => {
  const { createAnalyticsService } = await import('../dist/services/analytics.service.js')
  const service = createAnalyticsService()
  await service.trackEvent('user-1', 'session_started', {})
  await service.trackEvent('user-1', 'match_started', {})
  await service.trackEvent('user-1', 'match_completed', {})
  await service.trackEvent('user-1', 'session_ended', { duration: 600 })
  const metrics = await service.calculatePlayerMetrics('user-1', '24h')
  assert.strictEqual(metrics.totalEvents, 4)
})

test('Analytics calculates cohort retention', async () => {
  const { createAnalyticsService } = await import('../dist/services/analytics.service.js')
  let testTime = 1000000000000
  const service = createAnalyticsService({ now: () => testTime, maxEventRetention: 1000 })
  await service.trackEvent('user-1', 'session_started', {})
  await service.trackEvent('user-2', 'session_started', {})
  testTime += 86400000
  await service.trackEvent('user-1', 'session_started', {})
  testTime += 6 * 86400000
  await service.trackEvent('user-1', 'session_started', {})
  const cohorts = await service.getCohortRetention(7)
  assert.ok(cohorts.length > 0)
  assert.ok(cohorts[0].cohortSize >= 1)
})
