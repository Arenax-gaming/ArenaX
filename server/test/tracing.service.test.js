import test from 'node:test'
import assert from 'node:assert'

test('isTracingEnabled returns false when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
  const { isTracingEnabled } = await import('../dist/services/tracing.service.js')
  assert.strictEqual(isTracingEnabled({}), false)
  assert.strictEqual(isTracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: '' }), false)
})

test('isTracingEnabled returns true when OTEL_EXPORTER_OTLP_ENDPOINT is configured', async () => {
  const { isTracingEnabled } = await import('../dist/services/tracing.service.js')
  assert.strictEqual(
    isTracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318' }),
    true,
  )
})

test('initTracing is a no-op when disabled (returns null)', async () => {
  const { initTracing } = await import('../dist/services/tracing.service.js')
  const handle = initTracing({}) // no env
  assert.strictEqual(handle, null)
})

test('withSpan runs fn directly when tracing has not been started', async () => {
  const { withSpan } = await import('../dist/services/tracing.service.js')
  let ran = false
  const out = await withSpan('test-span', { foo: 'bar' }, async () => {
    ran = true
    return 42
  })
  assert.strictEqual(ran, true)
  assert.strictEqual(out, 42)
})

test('withSpan re-throws errors thrown by fn (tracing disabled path)', async () => {
  const { withSpan } = await import('../dist/services/tracing.service.js')
  await assert.rejects(
    withSpan('failing-span', {}, async () => {
      throw new Error('boom')
    }),
    /boom/,
  )
})

test('traceparentResponseMiddleware is a no-op when tracing is disabled', async () => {
  const { traceparentResponseMiddleware } =
    await import('../dist/services/tracing.service.js')
  const mw = traceparentResponseMiddleware()
  let nextCalled = false
  let traceparentHeaderSet = false
  const req = {}
  const res = {
    setHeader(name) { if (name === 'traceparent') traceparentHeaderSet = true },
    getHeader() { return undefined },
  }
  mw(req, res, () => { nextCalled = true })
  assert.strictEqual(nextCalled, true)
  assert.strictEqual(traceparentHeaderSet, false)
})

test('shutdownTracing is safe to call when tracing was never started', async () => {
  const { shutdownTracing } = await import('../dist/services/tracing.service.js')
  await assert.doesNotReject(shutdownTracing())
})
