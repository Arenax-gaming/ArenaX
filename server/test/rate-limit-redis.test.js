const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Mock Redis (ioredis) — avoids requiring a live Redis server in unit tests
// ---------------------------------------------------------------------------

class MockRedis {
  constructor() {
    this.store = new Map();
    this._connected = true;
  }

  async incr(key) {
    const val = (this.store.get(key) || 0) + 1;
    this.store.set(key, val);
    return val;
  }

  async expire(_key, _ttl) { return 1; }
  async pttl(_key) { return 55000; }
  async decr(key) {
    const val = (this.store.get(key) || 0) - 1;
    if (val <= 0) { this.store.delete(key); return 0; }
    this.store.set(key, val);
    return val;
  }
  async del(...keys) { keys.forEach(k => this.store.delete(k)); return keys.length; }
  async keys(pattern) {
    const prefix = pattern.replace('*', '');
    return [...this.store.keys()].filter(k => k.startsWith(prefix));
  }
  async get(key) { return this.store.get(key) ?? null; }
  async set(key, val) { this.store.set(key, val); return 'OK'; }
  async hgetall(key) {
    const data = this.store.get(key);
    return data || {};
  }
  async hset(key, obj) {
    const existing = this.store.get(key) || {};
    Object.assign(existing, obj);
    this.store.set(key, existing);
    return 1;
  }
  async hget(key, field) {
    const data = this.store.get(key);
    return data?.[field] ?? null;
  }
  async zadd(key, score, member) {
    if (!this.store.has(key)) this.store.set(key, []);
    this.store.get(key).push({ score, member });
    return 1;
  }
  async zcount(key, min, max) {
    const members = this.store.get(key) || [];
    return members.filter(m => m.score >= min && m.score <= max).length;
  }
  async zrevrangebyscore(key, max, min) {
    const members = this.store.get(key) || [];
    return members
      .filter(m => m.score >= min && m.score <= max)
      .sort((a, b) => b.score - a.score)
      .flatMap(m => [m.member, String(m.score)]);
  }
  async ping() { return 'PONG'; }
  get status() { return this._connected ? 'ready' : 'end'; }
  pipeline() { return this; }
  multi() { return this; }
  async exec() { return []; }
  on() { return this; }
  async connect() { return this; }

  // Mirrors the increment-and-read-previous Lua script used by
  // SlidingWindowRateLimitStore: INCR key[0], PEXPIRE on first write, GET key[1].
  async eval(_script, _numkeys, currentKey, previousKey) {
    const current = (this.store.get(currentKey) || 0) + 1;
    this.store.set(currentKey, current);
    const previous = Number(this.store.get(previousKey) || 0);
    return [current, previous];
  }
}

// ---------------------------------------------------------------------------
// Tests: RedisRateLimitStore
// ---------------------------------------------------------------------------

describe('RedisRateLimitStore', () => {
  it('increments counter and returns totalHits + resetTime', async () => {
    const { RedisRateLimitStore } = await import('../dist/middleware/rate-limit-redis.store.js');
    const redis = new MockRedis();
    const store = new RedisRateLimitStore({ redis, windowMs: 60000 });

    const result1 = await store.increment('user:123');
    assert.equal(result1.totalHits, 1);
    assert.ok(result1.resetTime instanceof Date);
    assert.ok(result1.resetTime.getTime() > Date.now());

    const result2 = await store.increment('user:123');
    assert.equal(result2.totalHits, 2);
  });

  it('decrements counter', async () => {
    const { RedisRateLimitStore } = await import('../dist/middleware/rate-limit-redis.store.js');
    const redis = new MockRedis();
    const store = new RedisRateLimitStore({ redis, windowMs: 60000 });

    await store.increment('k');
    await store.increment('k');
    await store.decrement('k');
    const result = await store.increment('k');
    assert.equal(result.totalHits, 2);
  });

  it('resets a single key', async () => {
    const { RedisRateLimitStore } = await import('../dist/middleware/rate-limit-redis.store.js');
    const redis = new MockRedis();
    const store = new RedisRateLimitStore({ redis, windowMs: 60000 });

    await store.increment('k');
    await store.resetKey('k');
    const result = await store.increment('k');
    assert.equal(result.totalHits, 1);
  });

  it('handles Redis errors gracefully', async () => {
    const { RedisRateLimitStore } = await import('../dist/middleware/rate-limit-redis.store.js');
    const redis = new MockRedis();
    redis.incr = () => { throw new Error('ECONNREFUSED'); };
    const store = new RedisRateLimitStore({ redis, windowMs: 60000 });

    const result = await store.increment('k');
    assert.equal(result.totalHits, 1);
    assert.ok(result.resetTime instanceof Date);
  });
});

// ---------------------------------------------------------------------------
// Tests: SlidingWindowRateLimitStore
// ---------------------------------------------------------------------------

describe('SlidingWindowRateLimitStore', () => {
  it('increments counter and returns totalHits + resetTime', async () => {
    const { SlidingWindowRateLimitStore } = await import('../dist/middleware/sliding-window-rate-limit.store.js');
    const redis = new MockRedis();
    const store = new SlidingWindowRateLimitStore({ redis, windowMs: 60000 });

    const result1 = await store.increment('user:123');
    assert.equal(result1.totalHits, 1);
    assert.ok(result1.resetTime instanceof Date);
    assert.ok(result1.resetTime.getTime() > Date.now());

    const result2 = await store.increment('user:123');
    assert.equal(result2.totalHits, 2);
  });

  it('smooths bursts across a fixed-window boundary', async () => {
    const { SlidingWindowRateLimitStore } = await import('../dist/middleware/sliding-window-rate-limit.store.js');
    const redis = new MockRedis();
    const windowMs = 60000;
    const store = new SlidingWindowRateLimitStore({ redis, windowMs });

    const realNow = Date.now;
    try {
      // Fill the first window with 100 hits.
      Date.now = () => 0;
      for (let i = 0; i < 100; i++) {
        await store.increment('burst');
      }

      // A fixed-window counter would reset to 1 here, allowing another
      // full burst. The sliding window should still see ~100 hits.
      Date.now = () => windowMs + 1;
      const rightAfterBoundary = await store.increment('burst');
      assert.ok(
        rightAfterBoundary.totalHits > 90,
        `expected sliding window to carry over most of the previous window's hits, got ${rightAfterBoundary.totalHits}`,
      );

      // Well past the boundary, the previous window's weight should have
      // decayed to (close to) nothing.
      Date.now = () => windowMs * 2 + 5000;
      const farFromBoundary = await store.increment('burst');
      assert.ok(
        farFromBoundary.totalHits < 10,
        `expected the previous window's influence to have decayed, got ${farFromBoundary.totalHits}`,
      );
    } finally {
      Date.now = realNow;
    }
  });

  it('decrements counter', async () => {
    const { SlidingWindowRateLimitStore } = await import('../dist/middleware/sliding-window-rate-limit.store.js');
    const redis = new MockRedis();
    const store = new SlidingWindowRateLimitStore({ redis, windowMs: 60000 });

    await store.increment('k');
    await store.increment('k');
    await store.decrement('k');
    const result = await store.increment('k');
    assert.equal(result.totalHits, 2);
  });

  it('resets a single key', async () => {
    const { SlidingWindowRateLimitStore } = await import('../dist/middleware/sliding-window-rate-limit.store.js');
    const redis = new MockRedis();
    const store = new SlidingWindowRateLimitStore({ redis, windowMs: 60000 });

    await store.increment('k');
    await store.resetKey('k');
    const result = await store.increment('k');
    assert.equal(result.totalHits, 1);
  });

  it('handles Redis errors gracefully', async () => {
    const { SlidingWindowRateLimitStore } = await import('../dist/middleware/sliding-window-rate-limit.store.js');
    const redis = new MockRedis();
    redis.eval = () => { throw new Error('ECONNREFUSED'); };
    const store = new SlidingWindowRateLimitStore({ redis, windowMs: 60000 });

    const result = await store.increment('k');
    assert.equal(result.totalHits, 1);
    assert.ok(result.resetTime instanceof Date);
  });
});

// ---------------------------------------------------------------------------
// Tests: RedisTokenBucketStore
// ---------------------------------------------------------------------------

describe('RedisTokenBucketStore', () => {
  it('stores and retrieves bucket state', async () => {
    const { RedisTokenBucketStore } = await import('../dist/middleware/redis-token-bucket.store.js');
    const redis = new MockRedis();
    const store = new RedisTokenBucketStore(redis);

    await store.set('ip:1.2.3.4', { tokens: 10, lastRefill: Date.now() });
    const state = await store.get('ip:1.2.3.4');
    assert.equal(state.tokens, 10);
  });

  it('returns undefined for missing keys', async () => {
    const { RedisTokenBucketStore } = await import('../dist/middleware/redis-token-bucket.store.js');
    const redis = new MockRedis();
    const store = new RedisTokenBucketStore(redis);

    const state = await store.get('nonexistent');
    assert.equal(state, undefined);
  });
});

// ---------------------------------------------------------------------------
// Tests: RedisIpReputationStore
// ---------------------------------------------------------------------------

describe('RedisIpReputationStore', () => {
  it('defaults to 1.0 for unknown IPs', async () => {
    const { RedisIpReputationStore } = await import('../dist/middleware/redis-ip-reputation.store.js');
    const redis = new MockRedis();
    const store = new RedisIpReputationStore(redis);

    const score = await store.getReputation('1.2.3.4');
    assert.equal(score, 1.0);
  });

  it('clamps scores to [0, 1]', async () => {
    const { RedisIpReputationStore } = await import('../dist/middleware/redis-ip-reputation.store.js');
    const redis = new MockRedis();
    const store = new RedisIpReputationStore(redis);

    await store.setReputation('1.2.3.4', 1.5);
    const score = await store.getReputation('1.2.3.4');
    assert.equal(score, 1.0);

    await store.setReputation('5.6.7.8', -0.5);
    const score2 = await store.getReputation('5.6.7.8');
    assert.equal(score2, 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: FailoverStore
// ---------------------------------------------------------------------------

describe('FailoverStore', () => {
  it('delegates to primary store when healthy', async () => {
    const { FailoverStore } = await import('../dist/middleware/rate-limit-failover.js');
    let primaryHits = 0;
    const primary = {
      increment: async () => { primaryHits++; return { totalHits: primaryHits, resetTime: new Date(Date.now() + 60000) }; },
      decrement: async () => {},
      resetKey: async () => {},
    };
    const fallback = {
      increment: async () => ({ totalHits: 1, resetTime: new Date(Date.now() + 60000) }),
      decrement: async () => {},
      resetKey: async () => {},
    };

    const store = new FailoverStore(primary, fallback, {
      healthCheckFn: async () => true,
      healthCheckIntervalMs: 0,
    });

    const result = await store.increment('k');
    assert.equal(result.totalHits, 1);
  });

  it('falls back to secondary on primary failure', async () => {
    const { FailoverStore } = await import('../dist/middleware/rate-limit-failover.js');
    const primary = {
      increment: async () => { throw new Error('ECONNREFUSED'); },
      decrement: async () => { throw new Error('ECONNREFUSED'); },
      resetKey: async () => { throw new Error('ECONNREFUSED'); },
    };
    let fallbackHits = 0;
    const fallback = {
      increment: async () => { fallbackHits++; return { totalHits: fallbackHits, resetTime: new Date(Date.now() + 60000) }; },
      decrement: async () => {},
      resetKey: async () => {},
    };

    const store = new FailoverStore(primary, fallback, {
      healthCheckFn: async () => false,
      healthCheckIntervalMs: 0,
    });

    const result = await store.increment('k');
    assert.equal(result.totalHits, 1);
  });
});

// ---------------------------------------------------------------------------
// Tests: RateLimitAnalytics
// ---------------------------------------------------------------------------

describe('RateLimitAnalytics', () => {
  it('records hits and blocks', async () => {
    const { RateLimitAnalytics } = await import('../dist/services/rate-limit-analytics.service.js');
    const redis = new MockRedis();
    const analytics = new RateLimitAnalytics(redis);

    await analytics.recordHit('user:1', 'auth');
    await analytics.recordBlock('ip:1.2.3.4', 'public');

    const stats = await analytics.getStats(60000);
    assert.equal(stats.totalHits, 1);
    assert.equal(stats.totalBlocks, 1);
    assert.equal(stats.hitsByTier.auth, 1);
    assert.equal(stats.blocksByTier.public, 1);
  });

  it('returns empty stats on Redis error', async () => {
    const { RateLimitAnalytics } = await import('../dist/services/rate-limit-analytics.service.js');
    const redis = new MockRedis();
    redis.zcount = () => { throw new Error('fail'); };
    const analytics = new RateLimitAnalytics(redis);

    const stats = await analytics.getStats();
    assert.equal(stats.totalHits, 0);
    assert.equal(stats.totalBlocks, 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Rate Limit Health Check
// ---------------------------------------------------------------------------

describe('Rate limit monitoring', () => {
  it('health check returns true when Redis responds PONG', async () => {
    const { createRateLimitHealthCheck } = await import('../dist/middleware/rate-limit-monitoring.js');
    const redis = new MockRedis();
    const check = createRateLimitHealthCheck(redis);

    const healthy = await check();
    assert.equal(healthy, true);
  });

  it('health check returns false on error', async () => {
    const { createRateLimitHealthCheck } = await import('../dist/middleware/rate-limit-monitoring.js');
    const redis = new MockRedis();
    redis.ping = () => { throw new Error('ECONNREFUSED'); };
    const check = createRateLimitHealthCheck(redis);

    const healthy = await check();
    assert.equal(healthy, false);
  });
});
