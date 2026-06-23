import test from 'node:test'
import assert from 'node:assert'

test('runAll returns pass when every probe passes', async () => {
  const { DependencyHealthRegistry } = await import('../dist/services/dependency-health.service.js')
  let now = 1_000
  const registry = new DependencyHealthRegistry(() => now)
  registry.register({
    name: 'db',
    required: true,
    timeoutMs: 1_000,
    check: async () => ({ status: 'pass' }),
  })

  const snapshot = await registry.runAll()
  assert.strictEqual(snapshot.status, 'pass')
  assert.strictEqual(snapshot.probes.length, 1)
})

test('runAll returns fail when a required probe fails', async () => {
  const { DependencyHealthRegistry } = await import('../dist/services/dependency-health.service.js')
  const registry = new DependencyHealthRegistry(() => 1_000)
  registry.register({
    name: 'db',
    required: true,
    timeoutMs: 1_000,
    check: async () => ({ status: 'fail', message: 'connection refused' }),
  })

  const snapshot = await registry.runAll()
  assert.strictEqual(snapshot.status, 'fail')
  assert.strictEqual(snapshot.probes[0].message, 'connection refused')
})

test('runAll returns warn when only an optional probe fails', async () => {
  const { DependencyHealthRegistry } = await import('../dist/services/dependency-health.service.js')
  const registry = new DependencyHealthRegistry(() => 1_000)
  registry.register({
    name: 'redis',
    required: false,
    timeoutMs: 500,
    check: async () => ({ status: 'fail' }),
  })
  registry.register({
    name: 'db',
    required: true,
    timeoutMs: 1_000,
    check: async () => ({ status: 'pass' }),
  })

  const snapshot = await registry.runAll()
  assert.strictEqual(snapshot.status, 'warn')
})

test('a probe that hangs is reported as a timeout failure', async () => {
  const { DependencyHealthRegistry } = await import('../dist/services/dependency-health.service.js')
  const registry = new DependencyHealthRegistry()
  registry.register({
    name: 'slow',
    required: true,
    timeoutMs: 25,
    check: () => new Promise(() => {}),
  })

  const snapshot = await registry.runAll()
  assert.strictEqual(snapshot.status, 'fail')
  assert.strictEqual(snapshot.probes[0].message, 'probe timed out')
})
