import test from 'node:test'
import assert from 'node:assert'

test('confirmation token generate and one-time validate', async () => {
  const { confirmationService } = await import('../dist/services/confirmation.service.js')

  // generate
  const info = confirmationService.generate('admin-1', 'bulk:ban', { userIds: ['u1', 'u2'] }, 10000)
  assert.ok(info.token)

  // validate should succeed once
  const ok = confirmationService.validate('admin-1', info.token, 'bulk:ban', { userIds: ['u1', 'u2'] })
  assert.strictEqual(ok, true)

  // second validate should fail (one-time)
  const ok2 = confirmationService.validate('admin-1', info.token, 'bulk:ban', { userIds: ['u1', 'u2'] })
  assert.strictEqual(ok2, false)

  // cleanup
  if (confirmationService.clear) confirmationService.clear()
})
