import test from 'node:test'
import assert from 'node:assert'

test('backoffForAttempt grows exponentially with jitter', async () => {
  const { backoffForAttempt } = await import('../dist/services/queue.service.js')
  const samples = Array.from({ length: 50 }, () => backoffForAttempt(3, 1_000))
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  // Base for attempt 3 is 1000 * 2^2 = 4000, jitter +/- 25% so [3000, 5000].
  assert.ok(min >= 3_000, `min ${min} too low`)
  assert.ok(max <= 5_000, `max ${max} too high`)
})

test('backoffForAttempt floors at 0 for attempt 0', async () => {
  const { backoffForAttempt } = await import('../dist/services/queue.service.js')
  const value = backoffForAttempt(0, 1_000)
  assert.ok(value >= 0)
})
