# ArenaX API Documentation

Competitive gaming platform — REST API + WebSocket reference.

## Quick Links

| Document | Description |
|----------|-------------|
| [openapi.yaml](./openapi.yaml) | OpenAPI 3.0 specification (machine-readable) |
| [index.html](./index.html) | Interactive Swagger UI (open in browser) |
| [authentication.md](./authentication.md) | JWT auth flows, token refresh, session management |
| [websocket.md](./websocket.md) | WebSocket connection, channels, and all event types |
| [errors.md](./errors.md) | Error codes, formats, and troubleshooting |
| [integration-guide.md](./integration-guide.md) | End-to-end walkthroughs + SDK examples (JS, Python, Rust) |
| [idempotency.md](./idempotency.md) | Idempotency key usage and conflict handling |
| [security.md](./security.md) | Security best practices |
| [performance.md](./performance.md) | Caching, WebSocket vs polling, optimization tips |
| [deployment.md](./deployment.md) | Environment variables, migrations, Docker, scaling |

## Viewing the Interactive Docs

```bash
# Serve locally
python3 -m http.server 3000 --directory docs/api
# Open http://localhost:3000
```

## API Overview

**Base URL**: `https://api.arenax.gg`

| Tag | Endpoints |
|-----|-----------|
| Auth | `/api/auth/*` — register, login, refresh, logout, sessions |
| Matchmaking | `/api/matchmaking/*` — queue join/leave, ELO, stats |
| Matches | `/api/matches/*` — full match lifecycle with on-chain settlement |
| Notifications | `/api/notifications/*` — CRUD + mark-read |
| Reputation | `/api/reputation/*` — skill/fair-play scores, bad actor management |
| Idempotency | `/api/idempotency/*` — key management and framework config |
| Health | `/api/health` |
| WebSocket | `wss://api.arenax.gg/ws?token=<jwt>` |

## Authentication

All protected endpoints require:
```
Authorization: Bearer <access_token>
```

Access tokens expire in **15 minutes**. Refresh via `POST /api/auth/refresh`.

## Changelog

| Version | Date | Notes |
|---------|------|-------|
| 1.0.0 | 2026-04-24 | Initial documentation release |
