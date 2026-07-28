# API Gateway — Kong

Closes #653.

Kong is deployed in front of `arenax-server` as the edge API gateway,
handling the concerns that belong at the edge rather than in every route
handler: routing, CORS, global rate limiting, request size limits,
correlation-id propagation, and access logging.

## Relationship to the existing app-level API gateway

The app already has its own API-key management system
(`src/routes/api-gateway.routes.ts`, `src/middleware/api-gateway.middleware.ts`,
`src/services/api-gateway.service.ts`) — key issuance, rotation, per-key
permissions, per-key usage analytics. **Kong does not replace this.** Kong
handles gateway-level concerns that apply uniformly to *all* traffic
(CORS, coarse rate limiting, request shaping, access logs); the app-level
system continues to own fine-grained, per-customer API key authorization
and billing/analytics data. This mirrors how most production setups split
the two: a dedicated gateway for edge concerns, application code for
business authorization.

## Configuration: DB-less / declarative mode

Kong runs in **DB-less mode** — `infra/kong/kong.yml` *is* the
configuration, checked into version control, with no separate Postgres
store to migrate, back up, or let drift from what's deployed. Changing
routing, plugins, or rate limits means editing that file and restarting
the container; there's no runtime Admin API mutation to reason about in
this setup.

If a future requirement needs dynamic, Admin-API-driven configuration
changes (e.g. self-service route creation), switch `KONG_DATABASE` to
`postgres`, add a Postgres service to the compose file, and run
`kong migrations bootstrap` — `kong.yml` can be imported once via
`deck sync` to seed the initial state.

## What's configured

See `infra/kong/kong.yml` for the full declarative config:

- **Service + routes** — `arenax-server` on `host.docker.internal:3001`
  (the TS server runs on the host via `npm run dev`, not in this compose
  file), routed from `/api/*` and `/health`.
- **`cors`** — single place browser access policy is defined, instead of
  per-service CORS middleware.
- **`rate-limiting`** — 300 req/min globally, protecting the service from
  anonymous traffic spikes ahead of (and independent of) the app's
  per-API-key limiter.
- **`correlation-id`** — reuses the `X-Request-Id` header the app's
  `correlation.middleware.ts` already reads, so a request traced at the
  gateway stays traceable through structured application logs and, via
  #660, through the ELK stack.
- **`request-size-limiting`** — 10MB payload cap at the edge.
- **`file-log`** — access logs to stdout, picked up by the same Docker
  log pipeline as application logs.

## Running locally

```bash
npm run dev                                            # arenax-server on :3001
docker compose -f infra/kong/docker-compose.yml up -d  # Kong on :8000 (proxy) / :8001 (admin)

curl http://localhost:8000/health
curl -X POST http://localhost:8000/api/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ _service { sdl } }"}'
```

From this point, `http://localhost:8000` is the entry point clients use
instead of `http://localhost:3001` directly.

## Verifying rate limiting

```bash
for i in $(seq 1 5); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/health; done
curl -sI http://localhost:8000/health | grep -i ratelimit
```

`X-RateLimit-*` response headers confirm the plugin is active; exceeding
300 requests in a rolling minute returns `429`.

## Production notes

- The bundled compose file targets local development (`host.docker.internal`
  routing to a host process). In production, `services[].url` should point
  at the real internal service address (a Kubernetes Service DNS name, an
  internal load balancer, etc.), and Kong itself should run as a
  horizontally-scaled deployment behind its own load balancer — not as a
  single container.
- TLS termination, mTLS to upstreams, and the `key-auth`/`jwt`/`oauth2`
  Kong plugins are natural next steps if/when gateway-level (rather than
  app-level) authentication is required for specific routes; they're not
  enabled here to avoid duplicating the app's existing API-key system.
