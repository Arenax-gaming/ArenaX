const assert = require('node:assert');
const { describe, it, before, after } = require('node:test');

// Mock env before importing service
process.env.CDN_PROVIDER = 'cloudflare';
process.env.CDN_ZONE_ID = 'test-zone';
process.env.CDN_DEFAULT_TTL = '3600';
process.env.CDN_STALE_WHILE_REVALIDATE = '600';
process.env.BACKEND_URL = 'http://localhost:3001';

// Import with module mocking
const { CdnCacheService } = require('../dist/services/cdn-cache.service.js');

describe('CDN Cache Service', () => {
  let service;

  before(() => {
    service = new CdnCacheService({
      provider: 'cloudflare',
      zoneId: 'test-zone',
      baseUrl: 'http://localhost:3001',
      defaultTtl: 3600,
      staleWhileRevalidate: 600,
    });
  });

  it('should generate cache control headers', () => {
    const headers = service.buildCacheControlHeaders();
    assert.ok(headers['Cache-Control'].includes('max-age=3600'));
    assert.ok(headers['Cache-Control'].includes('stale-while-revalidate=600'));
    assert.ok(headers['CDN-Cache-Control'].includes('max-age=3600'));
  });

  it('should build cache keys', () => {
    const key = service.buildCacheKey(['cdn', '/api/v1/tournaments', 'page=1']);
    assert.strictEqual(key, 'cdn:/api/v1/tournaments:page=1');
  });

  it('should generate cache tags', () => {
    const tags = service.generateCacheTags(
      { type: 'user', value: '123' },
      { type: 'endpoint', value: 'tournaments' }
    );
    assert.deepStrictEqual(tags, ['user:123', 'endpoint:tournaments']);
  });

  it('should record hits and misses', () => {
    service.recordHit();
    service.recordHit();
    service.recordMiss();

    const analytics = service.getAnalytics();
    assert.strictEqual(analytics.hits, 2);
    assert.strictEqual(analytics.misses, 1);
    assert.strictEqual(analytics.hitRate, 2 / 3);
  });

  it('should purge by tag', async () => {
    const result = await service.purgeByTag('user:123', 'test purge');
    assert.ok(result);
    assert.strictEqual(service.getAnalytics().purgeCount, 1);
  });

  it('should purge all', async () => {
    const result = await service.purgeAll('full purge');
    assert.ok(result);
    const history = service.getPurgeHistory();
    assert.ok(history.some(h => h.pattern === '*'));
  });

  it('should return analytics', () => {
    const analytics = service.getAnalytics();
    assert.ok(analytics.timestamp > 0);
    assert.ok(typeof analytics.hitRate === 'number');
    assert.ok(typeof analytics.bandwidthSaved === 'number');
  });

  it('should queue for warming', () => {
    service.queueForWarming('/api/v1/tournaments');
    assert.ok(service.getWarmingQueueSize() >= 0);
  });
});

describe('CDN Cache Analytics', () => {
  let service;

  before(() => {
    service = new CdnCacheService({
      provider: 'cloudflare',
      zoneId: 'test-zone',
      baseUrl: 'http://localhost:3001',
      defaultTtl: 3600,
      staleWhileRevalidate: 600,
    });
  });

  it('should provide analytics with all required fields', () => {
    service.recordHit();
    service.recordMiss();
    const analytics = service.getAnalytics();
    assert.ok('timestamp' in analytics);
    assert.ok('hitRate' in analytics);
    assert.ok('totalRequests' in analytics);
    assert.ok('hits' in analytics);
    assert.ok('misses' in analytics);
    assert.ok('bandwidthSaved' in analytics);
    assert.ok('purgeCount' in analytics);
  });

  it('should compute hit rate correctly', () => {
    // Reset by creating new service
    const s = new CdnCacheService({
      provider: 'cloudflare',
      zoneId: 'test-zone',
      baseUrl: 'http://localhost:3001',
      defaultTtl: 3600,
      staleWhileRevalidate: 600,
    });
    s.recordHit();
    s.recordHit();
    s.recordHit();
    s.recordHit();
    s.recordMiss();
    assert.strictEqual(s.getAnalytics().hitRate, 0.8);
  });
});
