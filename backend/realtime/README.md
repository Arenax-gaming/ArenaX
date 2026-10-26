# Live tournament updates

The backend initializes one `TournamentHub` at startup using `REDIS_URL`. Its
shared publisher writes JSON updates to `tournament:<uuid>`; a single Redis
`PSUBSCRIBE tournament:*` connection per backend process fans messages out to
local viewers. Backend instances therefore receive each other's updates without
opening a Redis connection for each viewer.

`GET /api/tournaments/{uuid}/events` returns an SSE stream for public tournaments.
Missing and private tournaments return 404, unavailable Redis subscriptions
return 503, and exhausted connection capacity returns 429. The public-only
access check uses the tournament's visibility in PostgreSQL. The `dev` branch's
existing HTTP authentication placeholders must be completed before enabling
private tournament feeds.

The stream emits named events:

```text
event: resync
data: {}

event: tournament_update
data: {"tournament_id":"...","kind":"prize_pool_changed","timestamp":"...","data":{...}}

```

The kinds are `created`, `status_changed`, `match_result`, `prize_pool_changed`,
`participants_changed`, and `bracket_changed`. Service mutations publish after
their database writes; live-delivery failures log a warning and preserve the
successful mutation result. Prize increments update `prize_pools` and the value
served by the tournament snapshot in one transaction, then publish the committed
amount and currency. Existing status, participant, score-report, and match-result
hooks feed the same hub.

The existing Redis adapter uses asynchronous owned connections, and the existing
WebSocket routes return their upgrade responses and handle protocol control
frames correctly. The new tournament fan-out is delivered through SSE. The
health endpoint reports readiness of the configured tournament hub.

The frontend detail route reads `GET /api/tournaments/{uuid}` using
`NEXT_PUBLIC_API_URL` (include `/api` in this base URL), opens that tournament's
stream, and refetches its authoritative snapshot for updates. It coalesces event
bursts, queues a follow-up read during slow requests, retries transient snapshot
failures, and prevents late responses from replacing a newer snapshot. The page
shows current status, prize pool, participant counts, connection state, and the
latest received match result. Route teardown cancels requests, timers and streams.

Redis Pub/Sub has no durable replay. Each new stream, detected Redis disconnect
or reconnect, and lagging viewer emits `resync`. Clients refetch snapshots rather
than depend on an event history. SSE comments every 15 seconds keep idle streams
alive; proxy buffering and caching are disabled in the response headers.

Default capacity per backend process is 5,000 viewers, at most 1,000 per
tournament, and 256 buffered events per tournament. Configure the first two with
`TOURNAMENT_REALTIME_MAX_CLIENTS` and `TOURNAMENT_REALTIME_MAX_PER_TOURNAMENT`.
Messages are capped at 64 KiB. Dropping a stream releases its connection permit
and removes an empty room immediately. Redis operations have a five-second
deadline and the subscriber reconnects with bounded backoff.

## Verification

Run the library and frontend tests without starting the full application:

```bash
cargo test --manifest-path backend/realtime/Cargo.toml --locked --lib
npm --prefix frontend run test:realtime
```

Use **dedicated** Redis and PostgreSQL instances for integration tests. The Redis
reconnection test terminates Pub/Sub connections on its configured server. HTTP
and prize-pool tests compile the actual backend route and SQL helper and use
connection-local temporary tables; they do not exercise the full application
schema or authenticated service flows.

```bash
REDIS_TEST_URL=redis://127.0.0.1:6379 \
DATABASE_TEST_URL=postgres://realtime_test:realtime_test@127.0.0.1:5432/realtime_test \
cargo test --manifest-path backend/realtime/Cargo.toml --locked --all-targets \
  -- --include-ignored --test-threads=1

npm --prefix frontend run lint
frontend/node_modules/.bin/tsc --project frontend/tsconfig.json --noEmit --incremental false
npm --prefix frontend run build
```

The full `dev` backend also requires its existing SQLx query metadata/database
setup and the service/model inconsistencies to be resolved. The focused crate
and integration tests provide executable coverage of this feature while those
baseline compilation problems remain visible in the PR validation notes.
