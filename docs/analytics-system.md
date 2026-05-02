# Game Analytics System

## Overview

This document describes the analytics system implemented in `ArenaX`.
It tracks player behaviour, game performance, and business metrics,
providing insights for game balancing and business intelligence.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/analytics/events | Track custom events |
| GET | /api/v1/analytics/dashboard | Get analytics dashboard |
| GET | /api/v1/analytics/players/:id | Get player analytics |
| GET | /api/v1/analytics/games/metrics | Get game performance |
| GET | /api/v1/analytics/reports/:type | Generate reports |
| GET | /api/v1/analytics/realtime | Get real-time stats |

---

## Event Tracking

### `POST /api/v1/analytics/events`

```json
{
  "eventType": "GAME_COMPLETED",
  "data": { "result": "win", "duration": 300 },
  "sessionId": "session-123"
}
```

Supported event types: `GAME_COMPLETED`, `SESSION_START`,
`PAYMENT_COMPLETED`, `PAGE_VIEW`, and any custom type.

---

## Report Types

| Type | Description | Required Parameters |
|------|-------------|---------------------|
| player | Player metrics | userId, startDate, endDate |
| game | Game performance | startDate, endDate |
| revenue | Revenue metrics | startDate, endDate |

---

## Implementation

**Files:**
- `server/src/services/analytics.service.ts` — core analytics logic
- `server/src/controllers/analytics.controller.ts` — REST endpoints
- `server/src/routes/analytics.routes.ts` — route definitions
- `server/prisma/schema.prisma` — AnalyticsEvent, PlayerMetrics, GameMetrics models

---

## Performance

- Events processed with under 1 second latency
- Real-time metrics update every 30 seconds
- Queries optimized with database indexes on userId, eventType, createdAt

---

## Security

- IP address and user agent captured for fraud detection
- GDPR: userId is optional — anonymous events supported
- Rate limiting applied via existing middleware

---

## Test Coverage

**File:** `server/test/analytics.test.js`

10 tests covering event tracking, player metrics, game metrics,
report generation, real-time stats, and input validation.