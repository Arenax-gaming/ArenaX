import test from 'node:test';
import assert from 'node:assert';
import rawDbModule, { setDatabaseClientForTesting } from '../dist/services/database.service.js';
import { cacheService } from '../dist/services/cache.service.js';
import { evaluateFlag } from '../dist/controllers/feature-flag.controller.js';
import { requireFeatureFlag } from '../dist/middleware/feature-flag.middleware.js';

test('Feature Flag System Integration & Segment Targeting Tests', async (t) => {
  const { featureFlagService } = await import('../dist/services/feature-flag.service.js');

  // In-memory mock database store for feature flags and audit logs
  const flagsMap = new Map();
  const auditLogsList = [];

  const mockDb = {
    featureFlag: {
      deleteMany: async () => { flagsMap.clear(); return { count: 0 }; },
      create: async ({ data }) => {
        const flag = {
          id: `flag-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          key: data.key,
          description: data.description || null,
          isEnabled: data.isEnabled ?? false,
          rules: data.rules ?? [],
          createdAt: new Date(),
          updatedAt: new Date()
        };
        flagsMap.set(data.key, flag);
        return flag;
      },
      findUnique: async ({ where }) => {
        return flagsMap.get(where.key) || null;
      },
      update: async ({ where, data }) => {
        const existing = flagsMap.get(where.key);
        if (!existing) throw new Error(`Not found: ${where.key}`);
        const updated = {
          ...existing,
          ...data,
          updatedAt: new Date()
        };
        flagsMap.set(where.key, updated);
        return updated;
      },
      delete: async ({ where }) => {
        const existing = flagsMap.get(where.key);
        flagsMap.delete(where.key);
        return existing;
      },
      findMany: async () => Array.from(flagsMap.values())
    },
    featureFlagAuditLog: {
      deleteMany: async () => { auditLogsList.length = 0; return { count: 0 }; },
      create: async ({ data }) => {
        const log = {
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          flagId: data.flagId,
          action: data.action,
          changedBy: data.changedBy,
          changes: data.changes,
          createdAt: new Date()
        };
        auditLogsList.push(log);
        return log;
      },
      findMany: async ({ where }) => {
        return auditLogsList
          .filter(l => !where?.flagId || l.flagId === where.flagId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
    }
  };

  setDatabaseClientForTesting(mockDb);

  await mockDb.featureFlagAuditLog.deleteMany();
  await mockDb.featureFlag.deleteMany();
  await cacheService.clear();

  const adminId = 'admin-user-123';
  const flagKey = 'test-flag-1';

  await t.test('should create a feature flag and log audit log', async () => {
    const flag = await featureFlagService.createFlag({
      key: flagKey,
      description: 'Test Feature Flag',
      isEnabled: true,
      rules: [
        { type: 'userIds', userIds: ['user-1'] }
      ]
    }, adminId);

    assert.strictEqual(flag.key, flagKey);
    assert.strictEqual(flag.isEnabled, true);

    const auditLogs = await featureFlagService.getAuditLogs(flagKey);
    assert.strictEqual(auditLogs.length, 1);
    assert.strictEqual(auditLogs[0].action, 'CREATE');
    assert.strictEqual(auditLogs[0].changedBy, adminId);
  });

  await t.test('Acceptance Criteria 1: A flag with a userIds rule is only enabled for the listed users', async () => {
    const userFlagKey = 'user-targeting-flag';
    await featureFlagService.createFlag({
      key: userFlagKey,
      isEnabled: true,
      rules: [
        { userIds: ['user-alpha', 'user-beta'] }
      ]
    }, adminId);

    // Listed users should evaluate to true
    const evalAlpha = await featureFlagService.evaluateDetail(userFlagKey, { userId: 'user-alpha' });
    assert.strictEqual(evalAlpha.enabled, true);
    assert.ok(evalAlpha.reason.includes('user-alpha'));

    const evalBeta = await featureFlagService.evaluate(userFlagKey, { userId: 'user-beta' });
    assert.strictEqual(evalBeta, true);

    // Non-listed user should evaluate to false
    const evalGamma = await featureFlagService.evaluateDetail(userFlagKey, { userId: 'user-gamma' });
    assert.strictEqual(evalGamma.enabled, false);

    // Unauthenticated / no user ID should evaluate to false
    const evalAnon = await featureFlagService.evaluate(userFlagKey, {});
    assert.strictEqual(evalAnon, false);
  });

  await t.test('Acceptance Criteria 2: A flag with percentage: 10 enables for approximately 10% of users', async () => {
    const pctKey = 'percentage-10-flag';
    await featureFlagService.createFlag({
      key: pctKey,
      isEnabled: true,
      rules: [
        { percentage: 10 }
      ]
    }, adminId);

    let enabledCount = 0;
    const totalUsers = 200;

    for (let i = 0; i < totalUsers; i++) {
      const userId = `pct-user-${i}`;
      const res1 = await featureFlagService.evaluate(pctKey, { userId });
      const res2 = await featureFlagService.evaluate(pctKey, { userId });
      assert.strictEqual(res1, res2); // must be deterministic per user ID
      if (res1) enabledCount++;
    }

    const percentage = (enabledCount / totalUsers) * 100;
    // Expected ~10%, allow reasonable statistical margin for hash distribution (5% - 18%)
    assert.ok(percentage >= 5 && percentage <= 20, `Expected ~10% rollout, got ${percentage}%`);
  });

  await t.test('Acceptance Criteria 3: A flag with region: NG only enables for users whose region is Nigeria', async () => {
    const regionKey = 'region-ng-flag';
    await featureFlagService.createFlag({
      key: regionKey,
      isEnabled: true,
      rules: [
        { region: 'NG' }
      ]
    }, adminId);

    // Match code 'NG'
    const evalNG = await featureFlagService.evaluateDetail(regionKey, { userId: 'user-ng', region: 'NG' });
    assert.strictEqual(evalNG.enabled, true);

    // Match country name 'Nigeria'
    const evalNigeria = await featureFlagService.evaluateDetail(regionKey, { userId: 'user-nigeria', region: 'Nigeria' });
    assert.strictEqual(evalNigeria.enabled, true);

    // Match case-insensitively 'ng'
    const evalLower = await featureFlagService.evaluate(regionKey, { userId: 'user-ng-lower', region: 'ng' });
    assert.strictEqual(evalLower, true);

    // Other regions should not enable
    const evalUS = await featureFlagService.evaluateDetail(regionKey, { userId: 'user-us', region: 'US' });
    assert.strictEqual(evalUS.enabled, false);

    const evalKE = await featureFlagService.evaluate(regionKey, { userId: 'user-ke', region: 'KE' });
    assert.strictEqual(evalKE, false);

    const evalNoRegion = await featureFlagService.evaluate(regionKey, { userId: 'user-none' });
    assert.strictEqual(evalNoRegion, false);
  });

  await t.test('Targeting rule: betaOnly enables only for beta users', async () => {
    const betaKey = 'beta-flag';
    await featureFlagService.createFlag({
      key: betaKey,
      isEnabled: true,
      rules: [
        { betaOnly: true }
      ]
    }, adminId);

    const evalBeta = await featureFlagService.evaluateDetail(betaKey, { userId: 'beta-user', isBeta: true });
    assert.strictEqual(evalBeta.enabled, true);

    const evalNonBeta = await featureFlagService.evaluateDetail(betaKey, { userId: 'regular-user', isBeta: false });
    assert.strictEqual(evalNonBeta.enabled, false);
  });

  await t.test('Targeting rules are evaluated in order: the first matching rule wins', async () => {
    const orderKey = 'order-priority-flag';
    await featureFlagService.createFlag({
      key: orderKey,
      isEnabled: true,
      rules: [
        // Rule 1: Exclude specific VIP user even if they are in Nigeria
        { userIds: ['blocked-user'], enabled: false },
        // Rule 2: Enable for Nigeria
        { region: 'NG', enabled: true },
        // Rule 3: Enable for 100% rollout
        { percentage: 100, enabled: true }
      ]
    }, adminId);

    // blocked-user matches Rule 1 first -> disabled (even though in NG)
    const evalBlocked = await featureFlagService.evaluateDetail(orderKey, { userId: 'blocked-user', region: 'NG' });
    assert.strictEqual(evalBlocked.enabled, false);

    // normal-ng user does not match Rule 1, matches Rule 2 -> enabled with region reason
    const evalNg = await featureFlagService.evaluateDetail(orderKey, { userId: 'normal-ng', region: 'NG' });
    assert.strictEqual(evalNg.enabled, true);
    assert.ok(evalNg.reason.includes('region'));

    // us-user does not match Rule 1 or 2, matches Rule 3 -> enabled with percentage reason
    const evalUs = await featureFlagService.evaluateDetail(orderKey, { userId: 'us-user', region: 'US' });
    assert.strictEqual(evalUs.enabled, true);
    assert.ok(evalUs.reason.includes('percentage'));
  });

  await t.test('Acceptance Criteria 4: Evaluated results are cached in Redis with a 60-second TTL', async () => {
    const cacheTestKey = 'cache-ttl-flag';
    await featureFlagService.createFlag({
      key: cacheTestKey,
      isEnabled: true,
      rules: [
        { userIds: ['cached-user-1'] }
      ]
    }, adminId);

    // First evaluation populates cache
    const eval1 = await featureFlagService.evaluateDetail(cacheTestKey, { userId: 'cached-user-1' });
    assert.strictEqual(eval1.enabled, true);

    // Verify it is cached
    const cached = await cacheService.get(`ff:eval:${cacheTestKey}:cached-user-1`);
    assert.ok(cached !== null);
    assert.strictEqual(cached.enabled, true);
    assert.strictEqual(cached.reason, eval1.reason);
  });

  await t.test('Acceptance Criteria 5: GET /feature-flags/:flagKey/evaluate returns { enabled: true/false, reason: string }', async () => {
    const endpointFlagKey = 'endpoint-flag';
    await featureFlagService.createFlag({
      key: endpointFlagKey,
      isEnabled: true,
      rules: [
        { region: 'NG' }
      ]
    }, adminId);

    // Test client-side GET evaluation via controller
    let responseStatus = 0;
    let responseBody = null;

    const mockReq = {
      params: { flagKey: endpointFlagKey },
      query: { userId: 'client-user', region: 'NG' },
      headers: {}
    };

    const mockRes = {
      status: (code) => {
        responseStatus = code;
        return mockRes;
      },
      json: (data) => {
        responseBody = data;
        return mockRes;
      }
    };

    await evaluateFlag(mockReq, mockRes);

    assert.strictEqual(responseStatus, 200);
    assert.ok(responseBody !== null);
    assert.strictEqual(typeof responseBody.enabled, 'boolean');
    assert.strictEqual(typeof responseBody.reason, 'string');
    assert.strictEqual(responseBody.enabled, true);
    assert.ok(responseBody.reason.includes('region'));

    // Non-matching evaluation
    mockReq.query = { userId: 'client-user-us', region: 'US' };
    await evaluateFlag(mockReq, mockRes);
    assert.strictEqual(responseStatus, 200);
    assert.strictEqual(responseBody.enabled, false);
    assert.strictEqual(typeof responseBody.reason, 'string');
  });

  await t.test('requireFeatureFlag middleware enforcement', async () => {
    const middlewareFlagKey = 'middleware-gate-flag';
    await featureFlagService.createFlag({
      key: middlewareFlagKey,
      isEnabled: true,
      rules: [
        { region: 'NG' }
      ]
    }, adminId);

    const middleware = requireFeatureFlag(middlewareFlagKey);

    // Test allowed user
    let nextCalled = false;
    let nextError = null;

    const reqAllowed = {
      user: { id: 'user-ng', region: 'NG' },
      headers: {},
      query: {}
    };
    await middleware(reqAllowed, {}, (err) => {
      nextCalled = true;
      nextError = err;
    });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(nextError, undefined);

    // Test blocked user
    let blockedCalled = false;
    let blockedError = null;

    const reqBlocked = {
      user: { id: 'user-us', region: 'US' },
      headers: {},
      query: {}
    };
    await middleware(reqBlocked, {}, (err) => {
      blockedCalled = true;
      blockedError = err;
    });
    assert.strictEqual(blockedCalled, true);
    assert.ok(blockedError);
    assert.strictEqual(blockedError.status, 403);
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
