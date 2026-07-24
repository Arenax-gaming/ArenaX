import test from 'node:test'
import assert from 'node:assert'

test('ADMIN should have all permissions', async () => {
  const { hasPermission } = await import('../dist/middleware/rbac.middleware.js')
  assert.ok(hasPermission('ADMIN', 'users:write'))
  assert.ok(hasPermission('ADMIN', 'system:write'))
  assert.ok(hasPermission('ADMIN', 'payments:write'))
  assert.ok(hasPermission('ADMIN', 'assets:bridge'))
})

test('USER should have basic read permissions only', async () => {
  const { hasPermission } = await import('../dist/middleware/rbac.middleware.js')
  assert.ok(hasPermission('USER', 'games:read'))
  assert.ok(hasPermission('USER', 'matches:read'))
  assert.ok(!hasPermission('USER', 'users:write'))
})

test('MODERATOR should have moderation permissions', async () => {
  const { hasPermission } = await import('../dist/middleware/rbac.middleware.js')
  assert.ok(hasPermission('MODERATOR', 'moderation:read'))
  assert.ok(hasPermission('MODERATOR', 'moderation:write'))
  assert.ok(hasPermission('MODERATOR', 'users:read'))
  assert.ok(!hasPermission('MODERATOR', 'users:write'))
})

test('GAME_DEVELOPER should have game write permissions', async () => {
  const { hasPermission } = await import('../dist/middleware/rbac.middleware.js')
  assert.ok(hasPermission('GAME_DEVELOPER', 'games:write'))
  assert.ok(hasPermission('GAME_DEVELOPER', 'matches:write'))
  assert.ok(hasPermission('GAME_DEVELOPER', 'analytics:write'))
  assert.ok(!hasPermission('GAME_DEVELOPER', 'system:write'))
})

test('CROSS_GAME_ADMIN should have asset permissions', async () => {
  const { hasPermission } = await import('../dist/middleware/rbac.middleware.js')
  assert.ok(hasPermission('CROSS_GAME_ADMIN', 'assets:read'))
  assert.ok(hasPermission('CROSS_GAME_ADMIN', 'assets:write'))
  assert.ok(hasPermission('CROSS_GAME_ADMIN', 'assets:bridge'))
  assert.ok(!hasPermission('CROSS_GAME_ADMIN', 'system:write'))
})

test('STAKING_MANAGER should have staking permissions', async () => {
  const { hasPermission } = await import('../dist/middleware/rbac.middleware.js')
  assert.ok(hasPermission('STAKING_MANAGER', 'staking:read'))
  assert.ok(hasPermission('STAKING_MANAGER', 'staking:write'))
  assert.ok(!hasPermission('STAKING_MANAGER', 'users:write'))
})

test('PLAYER should inherit from USER', async () => {
  const { getRolePermissions } = await import('../dist/middleware/rbac.middleware.js')
  const playerPerms = getRolePermissions('PLAYER')
  assert.ok(playerPerms.includes('games:read'))
  assert.ok(playerPerms.includes('matches:read'))
  assert.ok(playerPerms.includes('matches:write'))
  assert.ok(playerPerms.includes('analytics:read'))
})

test('OPERATOR should have most permissions', async () => {
  const { getRolePermissions } = await import('../dist/middleware/rbac.middleware.js')
  const operatorPerms = getRolePermissions('OPERATOR')
  assert.ok(operatorPerms.includes('users:write'))
  assert.ok(operatorPerms.includes('games:write'))
  assert.ok(operatorPerms.includes('analytics:admin'))
  assert.ok(operatorPerms.includes('payments:write'))
})

test('AccessControlService checks access correctly', async () => {
  const { defaultAccessControlService } = await import('../dist/services/access-control.service.js')
  const result = defaultAccessControlService.checkAccess(
    { id: '1', email: 'test@test.com', username: 'test', role: 'ADMIN' },
    'users:write'
  )
  assert.ok(result.allowed)
  assert.strictEqual(result.role, 'ADMIN')
})

test('AccessControlService denies insufficient permissions', async () => {
  const { defaultAccessControlService } = await import('../dist/services/access-control.service.js')
  const result = defaultAccessControlService.checkAccess(
    { id: '1', email: 'test@test.com', username: 'test', role: 'USER' },
    'users:write'
  )
  assert.ok(!result.allowed)
  assert.deepStrictEqual(result.missingPermissions, ['users:write'])
})

test('AccessControlService logs audit entries', async () => {
  const { defaultAccessControlService } = await import('../dist/services/access-control.service.js')
  defaultAccessControlService.logAuditEntry({
    actorId: 'test-user',
    action: 'test.action',
    resource: 'test',
    details: 'Test entry',
  })
  const entries = defaultAccessControlService.getAuditLog({ actorId: 'test-user' })
  assert.ok(entries.length > 0)
  assert.strictEqual(entries[0].actorId, 'test-user')
})

test('AccessControlService creates and revokes delegations', async () => {
  const { defaultAccessControlService } = await import('../dist/services/access-control.service.js')
  const delegator = { id: 'admin-1', email: 'admin@test.com', username: 'admin', role: 'ADMIN' }
  const delegation = defaultAccessControlService.createDelegation(delegator, 'user-1', 'MODERATOR', 3600000, 10)
  assert.ok(delegation)
  assert.strictEqual(delegation.role, 'MODERATOR')
  assert.strictEqual(delegation.maxUses, 10)
  const revoked = defaultAccessControlService.revokeDelegation(delegation.id, 'admin-1')
  assert.ok(revoked)
})
