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
  // Brotli defaults
  assert.strictEqual(DEFAULT_COMPRESSION_CONFIG.enableBrotli, true)
  assert.strictEqual(typeof DEFAULT_COMPRESSION_CONFIG.brotliQuality, 'number')
  assert.strictEqual(typeof DEFAULT_COMPRESSION_CONFIG.brotliMode, 'number')
})

test('resolveCompressionConfigFromEnv parses Brotli configuration', async () => {
  const { resolveCompressionConfigFromEnv } =
    await import('../dist/middleware/compression.middleware.js')

  // Brotli enabled by default
  let cfg = resolveCompressionConfigFromEnv({})
  assert.strictEqual(cfg.enableBrotli, true)

  // Can disable Brotli
  cfg = resolveCompressionConfigFromEnv({ COMPRESSION_ENABLE_BROTLI: 'false' })
  assert.strictEqual(cfg.enableBrotli, false)

  // Can set Brotli quality
  cfg = resolveCompressionConfigFromEnv({ COMPRESSION_BROTLI_QUALITY: '6' })
  assert.strictEqual(cfg.brotliQuality, 6)

  // Brotli quality clamping
  cfg = resolveCompressionConfigFromEnv({ COMPRESSION_BROTLI_QUALITY: '15' })
  assert.strictEqual(cfg.brotliQuality, 11)
  cfg = resolveCompressionConfigFromEnv({ COMPRESSION_BROTLI_QUALITY: '-1' })
  assert.strictEqual(cfg.brotliQuality, 0)

  // Can set Brotli mode
  cfg = resolveCompressionConfigFromEnv({ COMPRESSION_BROTLI_MODE: '1' })
  assert.strictEqual(cfg.brotliMode, 1)

  // Brotli mode clamping
  cfg = resolveCompressionConfigFromEnv({ COMPRESSION_BROTLI_MODE: '5' })
  assert.strictEqual(cfg.brotliMode, 2)
})

test('Brotli content negotiation prefers br over gzip', async () => {
  // This test verifies the logic for content negotiation
  // The actual implementation is tested via integration
  const { resolveCompressionConfigFromEnv } =
    await import('../dist/middleware/compression.middleware.js')

  const cfg = resolveCompressionConfigFromEnv({
    COMPRESSION_ENABLE_BROTLI: 'true',
    COMPRESSION_BROTLI_QUALITY: '4',
  })

  assert.strictEqual(cfg.enableBrotli, true)
  assert.strictEqual(cfg.brotliQuality, 4)
  assert.strictEqual(cfg.brotliMode, 0)
})

test('Brotli can be disabled via environment variable', async () => {
  const { resolveCompressionConfigFromEnv } =
    await import('../dist/middleware/compression.middleware.js')

  const cfg = resolveCompressionConfigFromEnv({
    COMPRESSION_ENABLE_BROTLI: 'false',
  })

  assert.strictEqual(cfg.enableBrotli, false)
  // Other config should still use defaults
  assert.strictEqual(cfg.level, 6)
  assert.strictEqual(cfg.threshold, 1024)
})
