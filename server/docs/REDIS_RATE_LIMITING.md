# Redis Rate Limiting

This document describes the Redis-backed rate limiting system for ArenaX.

## Overview

All rate limiters now use Redis as their primary store for distributed counting across server instances. If Redis is unavailable, rate limiting automatically falls back to in-memory stores, ensuring no requests are ever unblocked.

## Architecture

```
Request → Rate Limiter → FailoverStore
                            ├── RedisRateLimitStore (primary)
                            └── MemoryStore (fallback)
```

### Components

| File | Purpose |
|------|---------|
| `rate-limit-redis.store.ts` | Redis-backed store implementing express-rate-limit's `Store` interface. Uses atomic `INCR` + `EXPIRE` for fixed-window counting. |
| `redis-token-bucket.store.ts` | Redis-backed token bucket store using Redis hashes. |
| `redis-ip-reputation.store.ts` | Redis-backed IP reputation store with auto-expiring keys (24h TTL). |
| `rate-limit-failover.ts` | `Store` wrapper that delegates to primary, falls back to secondary on error. |
| `rate-limit-analytics.service.ts` | Tracks hits/blocks in Redis sorted sets for time-window queries. |
| `rate-limit-monitoring.ts` | Health check and metrics export endpoints. |

## Rate Limiters

| Limiter | Window | Limit | Redis Prefix |
|---------|--------|-------|--------------|
| `authRateLimiter` | 15 min | 5 req | `rl:auth:` |
| `paymentRateLimiter` | 1 min | 10 req | `rl:payment:` |
| `adminRateLimiter` | 1 min | 30 req | `rl:admin:` |
| `publicRateLimiter` | 1 min | 100 req | `rl:public:` |
| `apiKeyRateLimiter` | 1 min | 1000 req | `rl:apikey:` |
| Global (app.ts) | 15 min | 100 req | `rl:global:` |

### Adaptive Rate Limiters

| Limiter | Base Limit | Window | Redis Prefix |
|---------|-----------|--------|--------------|
| `publicAdaptiveRateLimiter` | 200 | 1 min | `rl:adaptive:public:` |
| `authenticatedAdaptiveRateLimiter` | 60 | 1 min | `rl:adaptive:auth-write:` |
| `gameActionAdaptiveRateLimiter` | 30 | 1 min | `rl:adaptive:game-action:` |

### Token Bucket Limiters

| Limiter | Capacity | Refill Rate | Redis Prefix |
|---------|----------|-------------|--------------|
| `authTokenBucketLimiter` | 5 | 5/60s | `tb:auth:` |
| `paymentTokenBucketLimiter` | 10 | 10/60s | `tb:payment:` |
| `gameActionTokenBucketLimiter` | 30 | 30/60s | `tb:game-action:` |
| `generalTokenBucketLimiter` | 100 | 100/60s | `tb:general:` |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | — | Redis connection URL. When unset, all limiters use in-memory stores. |
| `RATE_LIMIT_REDIS_KEY_PREFIX` | `rl:` | Prefix for all rate limit Redis keys. |
| `RATE_LIMIT_ANALYTICS_ENABLED` | `true` | Enable/disable analytics tracking. |

## Health Check

```
GET /api/rate-limit/health
```

Response:
```json
{
  "status": "ok",
  "redis": "connected",
  "metrics": {
    "redisConnected": true,
    "totalKeys": 1234,
    "memoryUsageBytes": 56789,
    "uptime": 3600
  }
}
```

## Analytics

Rate limit hits and blocks are recorded in Redis sorted sets with timestamp scores. This enables:

- Time-window queries (last hour, last day, etc.)
- Per-tier breakdowns (auth, payment, public, etc.)
- Top rate-limited keys

### Query Analytics

```typescript
import { RateLimitAnalytics } from './services/rate-limit-analytics.service';

const analytics = new RateLimitAnalytics(redis);

// Get stats for the last hour
const stats = await analytics.getStats(3600_000);

// Get most rate-limited keys
const topKeys = await analytics.getTopLimitedKeys(20, 3600_000);
```

## Failover Behavior

When Redis is unavailable:

1. `FailoverStore` detects the failure via health check (every 30s)
2. All operations fall back to the in-memory `MemoryStore`
3. When Redis recovers, traffic automatically shifts back
4. Rate limiting is never disabled — only the storage backend changes

## Redis Key Structure

```
rl:auth:{key}          → counter (INCR + EXPIRE)
rl:payment:{key}       → counter
rl:admin:{key}         → counter
rl:public:{key}        → counter
rl:apikey:{key}        → counter
rl:global:{key}        → counter
rl:adaptive:{name}:{key} → counter
tb:{identifier}:{id}   → hash {tokens, lastRefill}
iprep:{ip}             → string (score 0-1, 24h TTL)
rla:hits               → sorted set {member= key:timestamp, score=timestamp}
rla:blocks             → sorted set
rla:hits:{tier}        → sorted set per tier
rla:blocks:{tier}      → sorted set per tier
```

## Troubleshooting

### Rate limiting not working

1. Check `REDIS_URL` is set and Redis is reachable
2. Hit `GET /api/rate-limit/health` to verify Redis connection
3. Check server logs for "Redis rate limit store connected" message
4. If Redis is down, check for "using in-memory fallback" log

### High Redis memory usage

Rate limit keys auto-expire based on window size. If memory is high:
- Check `rl:` prefix keys with `redis-cli KEYS rl:*`
- Adjust `RATE_LIMIT_REDIS_KEY_PREFIX` if keys collide with other data
- Consider reducing window sizes for high-traffic limiters

### False positives

- Ensure `RATE_LIMIT_TRUSTED_IPS` includes your load balancer/proxy IPs
- Ensure `RATE_LIMIT_TRUSTED_ACCOUNTS` includes service accounts
- Check if adaptive rate limiters are tightening under high system load
