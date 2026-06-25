import test from 'node:test';
import assert from 'node:assert';
import prisma from '../dist/services/database.service.js';

test('Feature Flag System Integration Tests', async (t) => {
  const { featureFlagService } = await import('../dist/services/feature-flag.service.js');

  // Clean up table first
  await prisma.featureFlagAuditLog.deleteMany({});
  await prisma.featureFlag.deleteMany({});

  const adminId = 'admin-user-123';
  const flagKey = 'test-flag-1';

  await t.test('should create a feature flag and log audit log', async () => {
    const flag = await featureFlagService.createFlag({
      key: flagKey,
      description: 'Test Feature Flag',
      isEnabled: true,
      rules: [
        { type: 'user', userIds: ['user-1'] }
      ]
    }, adminId);

    assert.strictEqual(flag.key, flagKey);
    assert.strictEqual(flag.isEnabled, true);

    const auditLogs = await featureFlagService.getAuditLogs(flagKey);
    assert.strictEqual(auditLogs.length, 1);
    assert.strictEqual(auditLogs[0].action, 'CREATE');
    assert.strictEqual(auditLogs[0].changedBy, adminId);
  });

  await t.test('should evaluate user targeting rules', async () => {
    const matched = await featureFlagService.evaluate(flagKey, { userId: 'user-1' });
    assert.strictEqual(matched, true);

    const mismatched = await featureFlagService.evaluate(flagKey, { userId: 'user-2' });
    assert.strictEqual(mismatched, false);
  });

  await t.test('should evaluate role targeting rules', async () => {
    const tempKey = 'role-flag';
    await featureFlagService.createFlag({
      key: tempKey,
      isEnabled: true,
      rules: [
        { type: 'role', roles: ['ADMIN'] }
      ]
    }, adminId);

    const matched = await featureFlagService.evaluate(tempKey, { role: 'ADMIN' });
    assert.strictEqual(matched, true);

    const mismatched = await featureFlagService.evaluate(tempKey, { role: 'USER' });
    assert.strictEqual(mismatched, false);
  });

  await t.test('should evaluate email domain targeting rules', async () => {
    const tempKey = 'email-flag';
    await featureFlagService.createFlag({
      key: tempKey,
      isEnabled: true,
      rules: [
        { type: 'email', domains: ['arenax.gg'] }
      ]
    }, adminId);

    const matched = await featureFlagService.evaluate(tempKey, { email: 'test@arenax.gg' });
    assert.strictEqual(matched, true);

    const mismatched = await featureFlagService.evaluate(tempKey, { email: 'test@gmail.com' });
    assert.strictEqual(mismatched, false);
  });

  await t.test('should evaluate percentage rollout rules consistently', async () => {
    const tempKey = 'percentage-flag';
    await featureFlagService.createFlag({
      key: tempKey,
      isEnabled: true,
      rules: [
        { type: 'percentage', value: 50 } // 50% rollout
      ]
    }, adminId);

    // Evaluate for 100 users and check if result is deterministic and within range
    let enabledCount = 0;
    for (let i = 0; i < 100; i++) {
      const userId = `user-id-${i}`;
      const res1 = await featureFlagService.evaluate(tempKey, { userId });
      const res2 = await featureFlagService.evaluate(tempKey, { userId });
      assert.strictEqual(res1, res2); // must be deterministic
      if (res1) enabledCount++;
    }

    // With 50%, we expect roughly 50, but let's check it is between 30 and 70 (normal hash distribution)
    assert.ok(enabledCount >= 30 && enabledCount <= 70);
  });

  await t.test('should support disabling flag globally', async () => {
    await featureFlagService.updateFlag(flagKey, { isEnabled: false }, adminId);
    const res = await featureFlagService.evaluate(flagKey, { userId: 'user-1' });
    assert.strictEqual(res, false);
  });

  await t.test('should delete the flag and clean up cache', async () => {
    await featureFlagService.deleteFlag(flagKey, adminId);
    const flag = await featureFlagService.getFlag(flagKey);
    assert.strictEqual(flag, null);
  });
});
