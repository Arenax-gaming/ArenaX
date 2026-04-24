# Performance & Optimization Guide

## Connection Pooling

The backend uses `sqlx` with a PostgreSQL connection pool. Ensure your deployment sets appropriate pool sizes via `DATABASE_URL` parameters:

```
DATABASE_URL=postgres://user:pass@host/db?pool_max_connections=20
```

## Caching

- **Redis** is used for JWT session storage, matchmaking queues, and idempotency key caching.
- Idempotency responses are cached for 24 hours — leverage this to avoid redundant processing on retried requests.

## WebSocket vs Polling

Prefer WebSocket for real-time data (match status, balance updates, notifications). Polling the REST API for these creates unnecessary load. Connect once and subscribe to the relevant channels.

## Pagination

Endpoints that return lists (notifications, ELO history) are limited server-side. Use the `page` and `limit` query parameters where available:

```http
GET /api/matchmaking/elo/chess?page=1&limit=20
```

## Idempotency for Retries

On network timeouts, replay the request with the **same** `Idempotency-Key` instead of creating a new request. This avoids duplicate operations and returns the cached result instantly.

## Matchmaking Queue Behaviour

- ELO search range expands by **50 points every 30 minutes** of waiting.
- The matchmaker worker runs continuously in the background — you don't need to poll for match status; use the WebSocket `match_found` event.

## Reducing Latency

- Deploy client applications in the same region as the API server.
- Reuse HTTP connections (keep-alive) — avoid opening a new TCP connection per request.
- Batch notification reads — the `GET /api/notifications` endpoint returns up to 100 at once.

## Monitoring

The `/api/health` endpoint is suitable for load balancer health checks. It returns `200 OK` when the service is healthy.

For deeper observability, the backend emits structured logs via `tracing` — integrate with your log aggregation platform (e.g. Datadog, Grafana Loki).
