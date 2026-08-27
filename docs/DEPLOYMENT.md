# Zero-Downtime Deployments

Closes [#972](https://github.com/Arenax-gaming/ArenaX/issues/972) — blue/green
deployments with a canary phase, health-gated cutover, fast rollback, and
deployment metrics for both `backend` and `frontend`.

## How it works

```
GitHub Actions (deploy.yml)
  1. build + push backend/frontend images to GHCR, tagged with the commit SHA
  2. SSH to the deploy host, run scripts/deploy/blue-green-deploy.sh

blue-green-deploy.sh, on the deploy host:
  1. Read deploy/state/active-slot (blue|green) -> idle slot is the other color
  2. Start the idle slot's containers on the new image
  3. Health-check the idle slot (backend /api/health) before it gets any
     real traffic — a bad build never reaches users
  4. Canary: shift CANARY_WEIGHT% of traffic to the idle slot via a
     weighted nginx upstream, re-checking health for CANARY_BAKE_SECONDS.
     A failure here reverts to 100% on the still-active old slot — the
     old slot was never touched, so this is a no-op rollback.
  5. Cutover: reload nginx to send 100% of traffic to the new slot.
     `nginx -s reload` is graceful: in-flight requests finish on the old
     upstream, new requests go to the new one. No dropped connections,
     no maintenance window.
  6. Keep the old slot warm for ROLLBACK_WINDOW_SECONDS so a rollback is
     an nginx reload, not a redeploy.
  7. Stop the old slot's containers.
  8. Append a record to deploy/metrics/deployments.jsonl (start/end time,
     duration, slot transition, outcome).
```

Nginx is the single stable entry point (`deploy/nginx/`) — its published
port never changes; only which backend/frontend containers it proxies to
changes, which is what makes the cutover invisible to clients.

## Running it

Locally / on the deploy host:

```bash
export IMAGE_TAG=<git-sha-or-tag>
export BACKEND_IMAGE=ghcr.io/arenax-gaming/arenax/backend
export FRONTEND_IMAGE=ghcr.io/arenax-gaming/arenax/frontend
export DATABASE_URL=... REDIS_URL=... JWT_SECRET=...
./scripts/deploy/blue-green-deploy.sh
```

Roll back immediately (flips traffic to the previous slot):

```bash
./scripts/deploy/rollback.sh
```

Both are also exposed as GitHub Actions:
- `.github/workflows/deploy.yml` — runs on push to `main` (paths under
  `backend/`, `frontend/`, `deploy/`) or manually via
  `workflow_dispatch`, with `canary_weight` / `canary_bake_seconds`
  inputs.
- `.github/workflows/deploy-rollback.yml` — manual `workflow_dispatch`
  for an immediate rollback.

## Required secrets / environment

The `production` GitHub Environment gates both workflows and should hold:
`DEPLOY_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY` (SSH access to the
deploy host, which must have `/opt/arenax` checked out with Docker +
Docker Compose installed). GHCR push uses the workflow's own
`GITHUB_TOKEN`.

## Deployment metrics

Every deploy and rollback appends one JSON line to
`deploy/metrics/deployments.jsonl` on the deploy host:

```json
{"started_at":"...","finished_at":"...","duration_seconds":142,"image_tag":"a1b2c3d4e5f6","from_slot":"blue","to_slot":"green","status":"success"}
```

`status` is one of `success`, `failed`, or `rollback`. Point a log
shipper (or Prometheus's `node_exporter` textfile collector, or a small
cron that pushes this file's stats to the monitoring stack in
`server/infra/monitoring/`, see [#970](https://github.com/Arenax-gaming/ArenaX/issues/970))
at this file to get deploy-frequency / duration / failure-rate dashboards
and alerts over time.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `CANARY_WEIGHT` | 10 | % of traffic sent to the canary phase |
| `CANARY_BAKE_SECONDS` | 60 | how long the canary split is held |
| `ROLLBACK_WINDOW_SECONDS` | 120 | how long the old slot stays warm post-cutover before being stopped |
| `HEALTH_CHECK_RETRIES` | 10 | readiness probe attempts before giving up |
| `HEALTH_CHECK_INTERVAL_SECONDS` | 3 | delay between readiness probes |
