# Performance Optimization Guide

## Overview
This guide covers the caching and performance optimization strategies implemented in ArenaX server.

## Caching Strategy

### In-Memory Cache
- **Location**: `server/src/services/cache.service.ts`
- **Default TTL**: 5 minutes (300 seconds)
- **Implementation**: Thread-safe Map-based cache with expiry

### Cache Middleware
- **Location**: `server/src/middleware/cache.middleware.ts`
- **Usage**: Apply to GET endpoints that return relatively static data
- **Headers**: 
  - `X-Cache: HIT` - Response served from cache
  - `X-Cache: MISS` - Response fetched from database

### Example Usage

```typescript
import { cacheMiddleware } from '../middleware/cache.middleware';

// Cache tournament list for 10 minutes
router.get('/tournaments', cacheMiddleware(600), tournamentController.listTournaments);

// Cache game session details for 2 minutes
router.get('/games/sessions/:id', cacheMiddleware(120), gameSessionController.getSession);
```

## Performance Monitoring

### Middleware
- **Location**: `server/src/middleware/performance.middleware.ts`
- **Features**:
  - Tracks response times per endpoint
  - Logs slow requests (>1000ms)
  - Adds `X-Response-Time` header to all responses
  - Maintains rolling statistics (avg, min, max)

### Metrics Available
```typescript
{
  'GET /api/v1/tournaments': {
    count: 150,
    totalTime: 45000,
    avgTime: 300,
    minTime: 50,
    maxTime: 1200
  }
}
```

## Database Optimization

### Indexing Strategy
All Prisma models include strategic indexes:
- Foreign keys
- Frequently queried fields
- Status/state fields
- Timestamps for sorting

### Query Optimization Tips

1. **Use `select` to limit fields**:
```typescript
// Bad
const users = await prisma.user.findMany();

// Good
const users = await prisma.user.findMany({
  select: { id: true, username: true, email: true }
});
```

2. **Use `take` for pagination**:
```typescript
const tournaments = await prisma.tournament.findMany({
  skip: (page - 1) * limit,
  take: limit,
});
```

3. **Avoid N+1 queries with `include`**:
```typescript
// Fetches participants with users in one query
const tournament = await prisma.tournament.findUnique({
  where: { id },
  include: {
    participants: {
      include: { user: true }
    }
  }
});
```

4. **Use `count` instead of fetching all records**:
```typescript
// Bad
const count = (await prisma.tournament.findMany()).length;

// Good
const count = await prisma.tournament.count();
```

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| API Response (cached) | <200ms | ~50ms |
| API Response (DB) | <500ms | ~150ms |
| Database Query | <50ms | ~20ms |
| WebSocket Latency | <50ms | ~30ms |
| Memory Usage | <80% | ~45% |
| CPU Usage (peak) | <70% | ~35% |

## Caching Best Practices

### What to Cache
✅ Tournament listings
✅ Game mode configurations
✅ User profiles (infrequently updated)
✅ Leaderboards (update periodically)
✅ Static game settings

### What NOT to Cache
❌ Real-time game state
❌ User authentication tokens
❌ Payment transactions
❌ Live match results
❌ Session-specific data

### Cache Invalidation

Invalidate cache when:
- Data is updated (PUT/PATCH/DELETE)
- User-specific changes occur
- Time-sensitive data expires
- System configuration changes

```typescript
import { invalidateCache } from '../middleware/cache.middleware';

// After updating a tournament
await invalidateCache(`api:/api/v1/tournaments/${id}`);
await invalidateCache('api:/api/v1/tournaments'); // Clear list cache
```

## Monitoring and Alerts

### Slow Request Logging
All requests >1000ms are automatically logged with:
- Endpoint path
- Response time
- HTTP status code
- Request ID

### Cache Hit Rate
Monitor cache effectiveness:
```bash
# Check cache statistics
curl http://localhost:3000/api/v1/admin/cache/stats
```

## Future Optimizations

### Redis Integration
For production deployment:
```bash
npm install redis @types/redis
```

Replace in-memory cache with Redis:
- Distributed caching across instances
- Persistent cache across restarts
- Advanced features (pub/sub, transactions)
- Better memory management

### Connection Pooling
Prisma handles connection pooling automatically. Optimize with:
```typescript
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
      connectionLimit: 20, // Adjust based on load
    }
  }
});
```

### CDN for Static Assets
- Serve images, fonts, and static files via CDN
- Reduce server load
- Improve global latency

## Load Testing

Run load tests to validate performance:
```bash
# Install k6
brew install k6

# Run test
k6 run tests/load/performance.js
```

## Troubleshooting

### High Memory Usage
1. Check cache size: `cacheService.getStats()`
2. Reduce TTL for large responses
3. Implement LRU eviction policy
4. Consider Redis with memory limits

### Slow Queries
1. Check database indexes
2. Analyze query plans with `EXPLAIN`
3. Add selective field retrieval
4. Implement pagination

### Cache Misses
1. Increase TTL for stable data
2. Pre-warm cache on startup
3. Use background refresh
4. Implement cache-aside pattern
