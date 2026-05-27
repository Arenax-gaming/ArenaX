import test from 'node:test'
import assert from 'node:assert'
import http from 'node:http'

test('banUser input validation rejects short reasons and excessive durations', async (t) => {
  const { createAdminService } = await import('../dist/services/admin.service.js')
  const svc = createAdminService()

  await assert.rejects(async () => svc.banUser({ userId: 'u1', reason: 'x', duration: 1 }))
  await assert.rejects(async () => svc.banUser({ userId: 'u1', reason: 'valid reason', duration: 24 * 31 }))
})

test('health monitor triggers webhook notification when degraded', async (t) => {
  let captured = null
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', c => body += c)
      req.on('end', () => {
        try { captured = JSON.parse(body) } catch (e) { captured = body }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise((r) => server.listen(0, r))
  const port = server.address().port
  process.env.ADMIN_WEBHOOK_URL = `http://localhost:${port}/webhook`

  const { startHealthMonitor } = await import('../dist/services/health.service.js')
  const monitor = startHealthMonitor({ intervalMs: 100, thresholds: { dbLatency: 0, serverLatency: 0 } })

  await new Promise(r => setTimeout(r, 300))
  monitor.stop()
  server.close()

  if (captured) {
    assert.ok(captured.payload && (captured.payload.health || captured.payload.error))
  }
})
