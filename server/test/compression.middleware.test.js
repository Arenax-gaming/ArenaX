import test from 'node:test'
import assert from 'node:assert'

test('resolveCompressionConfigFromEnv falls back to defaults when no env vars are set', async () => {
  const { resolveCompressionConfigFromEnv, DEFAULT_COMPRESSION_CONFIG } =
    await import('../dist/middleware/compression.middleware.js')
  const cfg = resolveCompressionConfigFromEnv({})
  assert.strictEqual(cfg.level, DEFAULT_COMPRESSION_CONFIG.level)
  assert.strictEqual(cfg.threshold, DEFAULT_COMPRESSION_CONFIG.threshold)
  assert.deepStrictEqual(cfg.excludedContentTypes, DEFAULT_COMPRESSION_CONFIG.excludedContentTypes)
})

test('resolveCompressionConfigFromEnv parses and clamps env values', async () => {
  const { resolveCompressionConfigFromEnv } =
    await import('../dist/middleware/compression.middleware.js')

  // Valid in-range values
  let cfg = resolveCompressionConfigFromEnv({
    COMPRESSION_LEVEL: '3',
    COMPRESSION_THRESHOLD_BYTES: '500',
    COMPRESSION_EXCLUDED_TYPES: 'image/png, text/csv',
  })
  assert.strictEqual(cfg.level, 3)
  assert.strictEqual(cfg.threshold, 500)
  assert.deepStrictEqual(cfg.excludedContentTypes, ['image/png', 'text/csv'])

  // Out-of-range level clamps
  cfg = resolveCompressionConfigFromEnv({ COMPRESSION_LEVEL: '99' })
  assert.strictEqual(cfg.level, 9)
  cfg = resolveCompressionConfigFromEnv({ COMPRESSION_LEVEL: '0' })
  assert.strictEqual(cfg.level, 1)

  // Non-numeric falls back
  cfg = resolveCompressionConfigFromEnv({ COMPRESSION_LEVEL: 'gzip-please' })
  assert.strictEqual(cfg.level, 6)
})

test('shouldBypass matches by content-type prefix and is case-insensitive', async () => {
  const { shouldBypass } = await import('../dist/middleware/compression.middleware.js')
  const excluded = ['image/', 'video/', 'application/zip']
  assert.strictEqual(shouldBypass('image/png', excluded), true)
  assert.strictEqual(shouldBypass('IMAGE/PNG', excluded), true)
  assert.strictEqual(shouldBypass('application/zip', excluded), true)
  assert.strictEqual(shouldBypass('application/json', excluded), false)
  assert.strictEqual(shouldBypass(undefined, excluded), false)
})

test('createCompressionMiddleware returns a 3-arg express middleware', async () => {
  const { createCompressionMiddleware } =
    await import('../dist/middleware/compression.middleware.js')
  const mw = createCompressionMiddleware()
  assert.strictEqual(typeof mw, 'function')
  assert.strictEqual(mw.length, 3)
})

test('createCompressionMiddleware exposes a no-arg form with safe defaults', async () => {
  const { createCompressionMiddleware, DEFAULT_COMPRESSION_CONFIG } =
    await import('../dist/middleware/compression.middleware.js')
  // No throws, valid handler.
  const mw = createCompressionMiddleware()
  assert.strictEqual(typeof mw, 'function')
  assert.strictEqual(mw.length, 3)
  // The default config object the middleware was built around is still
  // shaped as expected (guards against accidental schema drift).
  assert.strictEqual(typeof DEFAULT_COMPRESSION_CONFIG.level, 'number')
  assert.strictEqual(typeof DEFAULT_COMPRESSION_CONFIG.threshold, 'number')
  assert.ok(Array.isArray(DEFAULT_COMPRESSION_CONFIG.excludedContentTypes))
  assert.ok(DEFAULT_COMPRESSION_CONFIG.excludedContentTypes.includes('image/'))
})
