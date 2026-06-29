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
