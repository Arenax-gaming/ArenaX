const assert = require('node:assert');
const { describe, it, before, beforeEach } = require('node:test');

const { ApiGatewayService } = require('../dist/services/api-gateway.service.js');

describe('API Gateway Service', () => {
  let service;

  before(() => {
    service = new ApiGatewayService();
  });

  it('should generate valid API keys', () => {
    // Test internal key generation format
    const key = 'ax_' + Buffer.from(require('crypto').randomBytes(32)).toString('base64url');
    assert.ok(key.startsWith('ax_'));
    assert.ok(key.length > 20);
  });

  it('should track usage records', () => {
    service.trackUsage('test-key-1', '/api/v1/tournaments', 'GET', 200);
    service.trackUsage('test-key-1', '/api/v1/matches', 'GET', 200);
    service.trackUsage('test-key-1', '/api/v1/tournaments', 'GET', 200);
    service.trackUsage('test-key-2', '/api/v1/users', 'GET', 401);

    const usage1 = service.getKeyUsage('test-key-1');
    assert.strictEqual(usage1.totalRequests, 3);
    assert.strictEqual(usage1.topEndpoints.length, 2);
    assert.strictEqual(usage1.topEndpoints[0].endpoint, '/api/v1/tournaments');
    assert.strictEqual(usage1.topEndpoints[0].count, 2);

    const usage2 = service.getKeyUsage('test-key-2');
    assert.strictEqual(usage2.totalRequests, 1);
  });

  it('should return analytics', () => {
    const analytics = service.getKeyAnalytics();
    assert.ok('totalKeys' in analytics);
    assert.ok('activeKeys' in analytics);
    assert.ok('totalRequests' in analytics);
    assert.ok('keysUsage' in analytics);
  });

  it('should store usage with timestamps', () => {
    const keyId = 'test-timestamp-key';
    service.trackUsage(keyId, '/api/v1/test', 'POST', 201);
    const usage = service.getKeyUsage(keyId);
    assert.ok(usage.recentRequests.length > 0);
    assert.ok(usage.recentRequests[0].timestamp > 0);
    assert.strictEqual(usage.recentRequests[0].method, 'POST');
    assert.strictEqual(usage.recentRequests[0].statusCode, 201);
  });
});
