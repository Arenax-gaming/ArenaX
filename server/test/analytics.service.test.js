import test from 'node:test'
import assert from 'node:assert'

// Tests run against the compiled JS, matching the existing repo
// convention (see `npm test` in package.json: tsc then node --test
// test/**/*.test.js).

test('trackEvent appends events and bounds memory at maxEventRetention', async () => {
  const { createAnalyticsService } = await import('../dist/services/analytics.service.js')
  const svc = createAnalyticsService({ now: () => 1_000_000, maxEventRetention: 3 })

  await svc.trackEvent('u1', 'match_started', { matchId: 'm1' })
  await svc.trackEvent('u1', 'match_completed', { matchId: 'm1' })
  await svc.trackEvent('u2', 'match_started', { matchId: 'm2' })
  await svc.trackEvent('u3', 'match_started', { matchId: 'm3' })

  // Retention cap is 3, so the oldest event (u1 match_started) was dropped.
  assert.strictEqual(svc._events.length, 3)
  const userIds = svc._events.map(e => e.userId)
  assert.deepStrictEqual(userIds, ['u1', 'u2', 'u3'])
})

test('calculatePlayerMetrics filters by user and window', async () => {
  const { createAnalyticsService } = await import('../dist/services/analytics.service.js')
  let now = 1_000_000_000_000
  const svc = createAnalyticsService({ now: () => now })

  await svc.trackEvent('u1', 'match_started', { matchId: 'm1' })
  await svc.trackEvent('u1', 'achievement_unlocked', { id: 'a1' })
  await svc.trackEvent('u2', 'match_started', { matchId: 'm2' })

  const all = await svc.calculatePlayerMetrics('u1', 'all')
  assert.strictEqual(all.totalEvents, 2)
  assert.strictEqual(all.eventCounts['match_started'], 1)
  assert.strictEqual(all.eventCounts['achievement_unlocked'], 1)

  // Advance the clock so the events fall outside the 1h window.
  now += 2 * 60 * 60 * 1000
  const hourly = await svc.calculatePlayerMetrics('u1', '1h')
  assert.strictEqual(hourly.totalEvents, 0)
})

test('getGamePerformanceMetrics computes durations and completion rate', async () => {
  const { createAnalyticsService } = await import('../dist/services/analytics.service.js')
  let now = 0
  const svc = createAnalyticsService({ now: () => now })

  now = 100
  await svc.trackEvent('u1', 'match_started', { matchId: 'm1' })
  now = 700
  await svc.trackEvent('u1', 'match_completed', { matchId: 'm1' })

  now = 1000
  await svc.trackEvent('u1', 'match_started', { matchId: 'm2' })
  // m2 never completes.

  const perf = await svc.getGamePerformanceMetrics('all')
  assert.strictEqual(perf.matchesStarted, 2)
  assert.strictEqual(perf.matchesCompleted, 1)
  assert.strictEqual(perf.completionRate, 0.5)
  assert.strictEqual(perf.averageMatchDurationMs, 600)
})

test('getRealTimeStats counts last 1 min and last 5 min separately', async () => {
  const { createAnalyticsService } = await import('../dist/services/analytics.service.js')
  let now = 10_000_000
  const svc = createAnalyticsService({ now: () => now })

  // 6 min ago — outside both windows.
  now = 10_000_000
  await svc.trackEvent('u1', 'match_started', {})
  now += 6 * 60 * 1000
  await svc.trackEvent('u2', 'match_started', {})
  // 30s ago — inside both windows.
  now += 4 * 60 * 1000 + 30 * 1000
  await svc.trackEvent('u3', 'match_started', {})
  now += 30 * 1000

  const stats = await svc.getRealTimeStats()
  assert.strictEqual(stats.eventsLastMinute, 1)
  assert.strictEqual(stats.eventsLast5Min, 2)
  assert.strictEqual(stats.activePlayersLast5Min, 2)
  assert.strictEqual(stats.backlogSize, 3)
})

test('generateReport: player-engagement ranks users by event count', async () => {
  const { createAnalyticsService } = await import('../dist/services/analytics.service.js')
  const svc = createAnalyticsService({ now: () => 1_700_000_000_000 })
  await svc.trackEvent('alpha', 'match_started', {})
  await svc.trackEvent('alpha', 'match_completed', {})
  await svc.trackEvent('alpha', 'achievement_unlocked', {})
  await svc.trackEvent('beta', 'match_started', {})

  const report = await svc.generateReport('player-engagement', { period: 'all' })
  assert.strictEqual(report.rows.length, 2)
  assert.strictEqual(report.rows[0].userId, 'alpha')
  assert.strictEqual(report.rows[0].eventCount, 3)
  assert.strictEqual(report.rows[1].userId, 'beta')
  assert.strictEqual(report.rows[1].eventCount, 1)
})

test('generateReport: tournament-funnel returns one summary row', async () => {
  const { createAnalyticsService } = await import('../dist/services/analytics.service.js')
  const svc = createAnalyticsService({ now: () => 1_700_000_000_000 })
  await svc.trackEvent('u1', 'tournament_registered', {})
  await svc.trackEvent('u1', 'tournament_registered', {})
  await svc.trackEvent('u1', 'match_started', {})
  await svc.trackEvent('u1', 'match_completed', {})

  const report = await svc.generateReport('tournament-funnel', { period: 'all' })
  assert.strictEqual(report.rows.length, 1)
  assert.deepStrictEqual(report.rows[0], {
    registered: 2,
    started: 1,
    completed: 1,
  })
})
