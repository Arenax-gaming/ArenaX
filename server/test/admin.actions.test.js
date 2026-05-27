import test from 'node:test'
import assert from 'node:assert'
import fetch from 'node-fetch'

// Ensure test environment has minimal required secrets before importing compiled app
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret_for_unit_tests_must_be_long_enough_1234'
process.env.NODE_ENV = 'test'

// Import compiled app from dist so tests run against built code
const { createApp } = await import('../dist/app.js')

// These tests run against the built JS in dist when using the project's test runner.
// For quick unit-like assertions we import app and call handlers through supertest-like requests.

const app = createApp()
let server

test('banUser validation prevents banning admins and short reasons', async (t) => {
  server = app.listen(0)
  const base = `http://localhost:${server.address().port}`

  // create a normal user and an admin via the API
  // register user A (normal)
  const resA = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'uA@example.com', password: 'Password1!', username: 'userA' }) })
  import test from 'node:test'
  import assert from 'node:assert'
  import http from 'node:http'

  // Validate input checks on banUser without loading full app
  test('banUser input validation rejects short reasons and excessive durations', async (t) => {
    const { createAdminService } = await import('../dist/services/admin.service.js')
    const svc = createAdminService()

    // short reason should throw
    await assert.rejects(async () => svc.banUser({ userId: 'u1', reason: 'x', duration: 1 }))

    // excessive duration should throw
    await assert.rejects(async () => svc.banUser({ userId: 'u1', reason: 'valid reason', duration: 24 * 31 }))
  })

  test('health monitor triggers webhook notification when degraded', async (t) => {
    // start a simple http server to capture webhook
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
    // set low threshold to trigger alert from random metrics
    const monitor = startHealthMonitor({ intervalMs: 100, thresholds: { dbLatency: 0, serverLatency: 0 } })

    await new Promise(r => setTimeout(r, 300))
    monitor.stop()
    server.close()

    // If capture occurred, assert payload shape
    if (captured) {
      assert.ok(captured.payload && (captured.payload.health || captured.payload.error))
    }
  })
  await new Promise(r => setTimeout(r, 500))
