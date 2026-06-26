import test from 'node:test'
import assert from 'node:assert'

test('EnvSecretProvider reads process.env, caches, then re-reads after invalidate', async () => {
  const { EnvSecretProvider } = await import('../dist/services/secrets.service.js')
  process.env.__TEST_SECRET = 'before'
  let now = 1_000
  const provider = new EnvSecretProvider({ cacheTtlMs: 60_000, now: () => now })

  assert.strictEqual(await provider.get('__TEST_SECRET'), 'before')

  // Rotate the underlying value; cache should still serve "before".
  process.env.__TEST_SECRET = 'after'
  now += 1_000
  assert.strictEqual(await provider.get('__TEST_SECRET'), 'before')

  // Invalidate clears the cache.
  provider.invalidate('__TEST_SECRET')
  assert.strictEqual(await provider.get('__TEST_SECRET'), 'after')

  delete process.env.__TEST_SECRET
})

test('requireKey throws on a missing secret', async () => {
  const { EnvSecretProvider } = await import('../dist/services/secrets.service.js')
  const provider = new EnvSecretProvider()
  await assert.rejects(() => provider.requireKey('__DEFINITELY_NOT_SET_XYZ'), /required secret/)
})

test('onAccess is called for every read with hit metadata', async () => {
  const { EnvSecretProvider } = await import('../dist/services/secrets.service.js')
  process.env.__TEST_SECRET_2 = 'value'
  let now = 1_000
  const seen = []
  const provider = new EnvSecretProvider({
    cacheTtlMs: 60_000,
    now: () => now,
    onAccess: (event) => seen.push(event),
  })

  await provider.get('__TEST_SECRET_2', 'auth.service')
  now += 1_000
  await provider.get('__TEST_SECRET_2', 'auth.service')

  assert.strictEqual(seen.length, 2)
  assert.strictEqual(seen[0].hit, 'fresh')
  assert.strictEqual(seen[1].hit, 'cache')
  assert.strictEqual(seen[0].requester, 'auth.service')

  delete process.env.__TEST_SECRET_2
})
