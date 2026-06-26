import test from 'node:test'
import assert from 'node:assert'

function buildMockRequest(overrides = {}) {
  return {
    path: '/api/v1/health',
    headers: {},
    ...overrides,
  }
}

function buildMockResponse() {
  const res = {
    statusCode: 0,
    body: undefined,
    headers: {},
    locals: {},
    status(code) { res.statusCode = code; return res },
    json(payload) { res.body = payload; return res },
    setHeader(name, value) { res.headers[name] = value },
  }
  return res
}

test('apiVersionMiddleware resolves v1 from the URL and exposes it on res.locals', async () => {
  const { InMemoryApiVersionRegistry, apiVersionMiddleware } = await import(
    '../dist/middleware/api-version.middleware.js'
  )
  const registry = new InMemoryApiVersionRegistry()
  registry.register({ name: 'v1', status: 'live', introducedAt: '2026-01-01' }, { default: true })

  const handler = apiVersionMiddleware(registry)
  const req = buildMockRequest({ path: '/api/v1/health' })
  const res = buildMockResponse()
  let called = false
  await handler(req, res, () => { called = true })

  assert.ok(called)
  assert.strictEqual(res.locals.apiVersion.name, 'v1')
  assert.strictEqual(res.locals.apiVersionFromUrl, true)
})

test('apiVersionMiddleware falls back to the registered default when the URL has no version', async () => {
  const { InMemoryApiVersionRegistry, apiVersionMiddleware } = await import(
    '../dist/middleware/api-version.middleware.js'
  )
  const registry = new InMemoryApiVersionRegistry()
  registry.register({ name: 'v1', status: 'live', introducedAt: '2026-01-01' }, { default: true })

  const handler = apiVersionMiddleware(registry)
  const req = buildMockRequest({ path: '/api/health' })
  const res = buildMockResponse()
  await handler(req, res, () => {})
  assert.strictEqual(res.locals.apiVersion.name, 'v1')
  assert.strictEqual(res.locals.apiVersionFromUrl, false)
})

test('apiVersionMiddleware honours an Accept header override', async () => {
  const { InMemoryApiVersionRegistry, apiVersionMiddleware } = await import(
    '../dist/middleware/api-version.middleware.js'
  )
  const registry = new InMemoryApiVersionRegistry()
  registry.register({ name: 'v1', status: 'live', introducedAt: '2026-01-01' }, { default: true })
  registry.register({ name: 'v2', status: 'live', introducedAt: '2026-06-01' })

  const handler = apiVersionMiddleware(registry)
  const req = buildMockRequest({ path: '/api/health', headers: { accept: 'application/json; version=v2' } })
  const res = buildMockResponse()
  await handler(req, res, () => {})
  assert.strictEqual(res.locals.apiVersion.name, 'v2')
})

test('apiVersionMiddleware sets RFC 8594 headers for a deprecated version', async () => {
  const { InMemoryApiVersionRegistry, apiVersionMiddleware } = await import(
    '../dist/middleware/api-version.middleware.js'
  )
  const registry = new InMemoryApiVersionRegistry()
  registry.register({
    name: 'v1',
    status: 'deprecated',
    introducedAt: '2026-01-01',
    deprecatedAt: '2026-06-01',
    sunsetAt: '2026-12-31',
    migrationGuide: 'https://docs.example.com/migrate-to-v2',
  }, { default: true })

  const handler = apiVersionMiddleware(registry)
  const req = buildMockRequest({ path: '/api/v1/health' })
  const res = buildMockResponse()
  await handler(req, res, () => {})

  assert.strictEqual(res.headers.Deprecation, '2026-06-01')
  assert.strictEqual(res.headers.Sunset, '2026-12-31')
  assert.ok(res.headers.Link.includes('rel="deprecation"'))
})

test('apiVersionMiddleware returns 410 for a sunset version', async () => {
  const { InMemoryApiVersionRegistry, apiVersionMiddleware } = await import(
    '../dist/middleware/api-version.middleware.js'
  )
  const registry = new InMemoryApiVersionRegistry()
  registry.register({
    name: 'v0',
    status: 'sunset',
    introducedAt: '2025-01-01',
    sunsetAt: '2026-01-01',
  })
  registry.register({ name: 'v1', status: 'live', introducedAt: '2026-01-01' }, { default: true })

  const handler = apiVersionMiddleware(registry)
  const req = buildMockRequest({ path: '/api/v0/health' })
  const res = buildMockResponse()
  await handler(req, res, () => {})
  assert.strictEqual(res.statusCode, 410)
  assert.strictEqual(res.body.error, 'api_version_sunset')
})

test('apiVersionMiddleware returns 404 for an unknown version', async () => {
  const { InMemoryApiVersionRegistry, apiVersionMiddleware } = await import(
    '../dist/middleware/api-version.middleware.js'
  )
  const registry = new InMemoryApiVersionRegistry()
  registry.register({ name: 'v1', status: 'live', introducedAt: '2026-01-01' }, { default: true })

  const handler = apiVersionMiddleware(registry)
  const req = buildMockRequest({ path: '/api/v9/health' })
  const res = buildMockResponse()
  await handler(req, res, () => {})

  assert.strictEqual(res.statusCode, 404)
  assert.strictEqual(res.body.error, 'unknown_api_version')
})
