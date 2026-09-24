# Dual-Backend Architecture

ArenaX runs **two independent servers** that share one conceptual product but
have a hard ownership boundary. This document defines the boundary so that new
endpoints land in the right service, feature flags and env vars stay consistent,
and no route collides between the two.

| Server | Directory | Stack | Public entrypoint |
|---|---|---|---|
| Rust backend | `backend/` | actix-web 4, PostgreSQL, Redis, Stellar/Soroban | :8080 (default) |
| TypeScript server | `server/` | Express, Passport, Redis | port from `PORT` env |

There is **no single request router that fans out to both**. Each server is
independently deployed and reachable; the frontend calls whichever server owns
the resource it needs (see `frontend/src/lib/api.ts`).

## Ownership boundary (decision rule)

- **Rust backend owns** anything that is a *game, ledger, or system primitive*:
  auth, wallet/ledger, matches + match authority, tournaments, matchmaking,
  reputation, staking, analytics, idempotency, feature flags, anti-bot, IP
  lists, notifications, batch, player stats.
- **TypeScript server owns** anything that is an *account/product surface,
  integration, or unlock/monetization flow*: OAuth/SSO, profile, admin &
  governance, cross-game assets, search, cache, i18n, metrics/dashboards,
  achievements, gateways, wallet "connectors", and payment provider webhooks
  (Paystack / Flutterwave).

**Golden rule:** new HTTP endpoints must be mounted exactly once, in exactly one
server. If a route family already exists on one side (see the table below), it
belongs there; do not create a parallel family on the other side.

## Current route ownership (as of this document)

### Rust backend — mounted under `/api` in `backend/src/main.rs` (+ `configure_routes` sub-scopes)

| Prefix | Owned by | Notes |
|---|---|---|
| `/api/health` | Rust | health probe |
| `/api/csrf-token` | Rust | CSRF token issuance |
| `/api/batch` | Rust | batch operations (#952), `/progress` |
| `/api/docs` | Rust | OpenAPI spec + Swagger UI (#901) |
| `/api/anti-bot` | Rust | bot status/metrics (#903) |
| `/api/admin/ip-list` | Rust | IP allow/deny (#975) |
| `/api/stats/player/{user_id}` | Rust | per-player stats (#904) |
| `/api/feature-flags` | Rust | flag CRUD + evaluate/overrides (#948) |
| `/api/auth` | Rust | register/login/refresh/logout/me/change-password/sessions/ws-token |
| `/api/notifications` | Rust | get/create/read/delete |
| `/api/wallet` | Rust | get/transactions/deposit/withdraw |
| `/api/reputation` | Rust | player/history/bad-actors/stats/me |
| `/api/staking` | Rust | stake/claim/unstake/position/stats |
| `/api/analytics` | Rust | match/behaviour/game/platform/player insights |
| `/api/tournaments` | Rust | full lifecycle + register/start/advance/prizes/stats |
| `/api/matches` | Rust | match authority FSM (start/complete/dispute/finalize/reconcile) |
| `/api/gas` | Rust | gas estimation |
| `/api/matchmaking` | Rust | join/leave/status/metrics/elo |
| `/api/idempotency` | Rust | key lifecycle + framework info |
| `/api/test` | Rust | idempotency simulation endpoints |
| `/ws/matches/{id}` | Rust | websocket match stream |
| `/ws/...` (user realtime) | Rust | `realtime::user_ws::configure_ws_route` |
| `/api/v1/party/...` | Rust *(declared, not yet mounted)* | social handler (create_party) exists in `backend/src/http/social_handler.rs`; invite/kick/leave/disband/ready/voice + `/party/me`, `/party/invites` are the frontend contract but are **not** implemented server-side yet |

### TypeScript server — `server/src/routes/index.ts` mounted at `/api` (versioned + deprecated unversioned alias via `mountVersioned`)

| Prefix | Owned by | Notes |
|---|---|---|
| `/api/v1/auth` & `/api/auth` | TS | OAuth/SSO session surface (distinct from Rust `/api/auth` JWT flow) |
| `/api/v1/profiles` & `/api/profiles` | TS | player-facing profile API |
| `/api/v1/matches` & `/api/matches` | TS | client-facing match data (read/summaries) |
| `/api/v1/admin` & `/api/admin` | TS | admin console |
| `/api/v1/governance` & `/api/governance` | TS | governance/DAO surface |
| `/api/v1/soroban` & `/api/soroban` | TS | Soroban bridge helpers |
| `/api/v1/wallets`, `/api/wallet` | TS | wallet connectors/sessions (vs Rust `/api/wallet` ledger ops) |
| `/api/v1/analytics` | TS | product analytics API |
| `/api/v1/achievements` | TS | achievement tracking |
| `/api/v1/tournaments` | TS | tournament *product* API (separate from Rust match engine) |
| `/api/v1/search` | TS | search |
| `/api/v1/cache` | TS | cache control |
| `/api/v1/gateway` | TS | api gateway routes |
| `/api/v1/queue` | TS | queue surface |
| `/api/v1/access-control` | TS | access-control/authz routes |
| `/api/v1/assets` | TS | cross-game assets |
| `/api/v1/i18n` | TS | localization |
| `/api/metrics`, `/api/dashboard` | TS | unversioned infra endpoints |
| `POST /api/webhooks/paystack`, `POST /api/webhooks/flutterwave` | TS | payment provider webhooks (signature-verified, see `middleware/webhook-signature.middleware.ts`) |

## Where NOT to put routes

- **Do not add** webhooks, OAuth, SSO, payments, or dashboard/metrics routes to
  the Rust backend — those belong to the TypeScript server.
- **Do not add** match engine, ledger/wallet ops, tournaments lifecycle, or
  matchmaking routes to the TypeScript server — those belong to the Rust
  backend.
- When a resource is conceptually shared (e.g. tournaments), one server owns the
  canonical write path and the other may expose read/projections only — never a
  second write path.

## Environment & config spread

Each server has its own config source. Keep secrets on the side that uses them:

- Rust: `backend/src/config.rs` (Rust config, e.g. `RATE_LIMIT_*`, `SOROBAN_*`).
- TS: `server/src/config/env.ts` (zod schema), `.env.example` documents new vars
  (e.g. `PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_HASH`).
- Naming collisions across servers are expected (both read `DATABASE_URL`, etc.)
  but route prefixes must not collide; see the ownership table above.

## Migration context

Backend migration phases are tracked in `backend_migration_issues.md`. As
migration proceeds, families move from the TypeScript server to the Rust backend
in atomic units (handlers + service + DB schema together), and this table is the
source of truth for which side owns what at any given time.