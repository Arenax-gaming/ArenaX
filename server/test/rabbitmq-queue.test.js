import test from 'node:test'
import assert from 'node:assert'

test('backoffForAttempt grows exponentially with jitter', async () => {
  const { backoffForAttempt } = await import('../dist/services/queue.service.js')
  const samples = Array.from({ length: 50 }, () => backoffForAttempt(3, 1_000))
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  assert.ok(min >= 3_000, `min ${min} too low`)
  assert.ok(max <= 5_000, `max ${max} too high`)
})

test('backoffForAttempt floors at 0 for attempt 0', async () => {
  const { backoffForAttempt } = await import('../dist/services/queue.service.js')
  const value = backoffForAttempt(0, 1_000)
  assert.ok(value >= 0)
})

test('QueueMonitoringService returns disconnected when no RabbitMQ', async () => {
  const { defaultQueueMonitoringService } = await import('../dist/services/queue-monitoring.service.js')
  const stats = await defaultQueueMonitoringService.getStats()
  assert.strictEqual(stats.connected, false)
  assert.deepStrictEqual(stats.queues, [])
})

test('QueueMonitoringService reports unhealthy when disconnected', async () => {
  const { defaultQueueMonitoringService } = await import('../dist/services/queue-monitoring.service.js')
  const health = await defaultQueueMonitoringService.getQueueHealth()
  assert.strictEqual(health.healthy, false)
  assert.ok(health.details.includes('not connected'))
})

test('RabbitMQQueueAdapter defaults to 5 max retries', async () => {
  const { RabbitMQQueueAdapter } = await import('../dist/services/rabbitmq-queue.service.js')
  const adapter = new RabbitMQQueueAdapter()
  assert.strictEqual(adapter.dlqMaxRetries, 5)
})

test('RabbitMQQueueAdapter accepts custom options', async () => {
  const { RabbitMQQueueAdapter } = await import('../dist/services/rabbitmq-queue.service.js')
  const adapter = new RabbitMQQueueAdapter({ dlqMaxRetries: 10, defaultTtlMs: 3600000 })
  assert.strictEqual(adapter.dlqMaxRetries, 10)
  assert.strictEqual(adapter.defaultTtlMs, 3600000)
})

test('RabbitMQQueueAdapter starts with empty dead letters', async () => {
  const { RabbitMQQueueAdapter } = await import('../dist/services/rabbitmq-queue.service.js')
  const adapter = new RabbitMQQueueAdapter()
  const letters = await adapter.listDeadLetters()
  assert.deepStrictEqual(letters, [])
})

test('RabbitMQQueueAdapter discards dead letters by id', async () => {
  const { RabbitMQQueueAdapter } = await import('../dist/services/rabbitmq-queue.service.js')
  const adapter = new RabbitMQQueueAdapter()
  adapter.deadLetters = [
    { id: 'test-1', name: 'email.send', data: {}, enqueuedAt: Date.now(), attempt: 1, options: { attempts: 5, backoffMs: 1000, priority: 'normal' } },
    { id: 'test-2', name: 'email.send', data: {}, enqueuedAt: Date.now(), attempt: 1, options: { attempts: 5, backoffMs: 1000, priority: 'normal' } },
  ]
  await adapter.discardDeadLetter('test-1')
  const letters = await adapter.listDeadLetters()
  assert.strictEqual(letters.length, 1)
  assert.strictEqual(letters[0].id, 'test-2')
})
