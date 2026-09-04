# ArenaX Disaster Recovery Plan

## 1. Purpose and Scope

This document defines how ArenaX detects, responds to, and recovers from
infrastructure and application failures that threaten availability or data
integrity. It covers the production stack: the Rust `backend` API
(`backend/`), the Node `server` services (`server/`), PostgreSQL, the Redis
cluster, Kong API gateway, the ELK logging stack, and Prometheus/Grafana
monitoring (see `server/infra/`).

It does not cover on-chain (Soroban/Stellar) contract state — smart
contracts are immutable and out of scope for data-restore procedures, though
the availability of services that interact with them (transaction monitor,
match authority service) is in scope.

## 2. Recovery Objectives

| Tier | Systems | RTO | RPO |
|---|---|---|---|
| Tier 0 — Critical | Auth, matchmaking, payments/wallet, primary Postgres | **< 1 hour** | **< 15 min** |
| Tier 1 — Core | Tournaments, leaderboards, notifications, WebSocket realtime | < 2 hours | < 30 min |
| Tier 2 — Supporting | Analytics, ELK/logging, Grafana dashboards | < 8 hours | < 4 hours |

- **RTO (Recovery Time Objective):** maximum acceptable time from incident
  declaration to Tier 0 service restoration is **60 minutes**.
- **RPO (Recovery Point Objective):** maximum acceptable data loss for Tier 0
  systems is **15 minutes**, driven by continuous WAL archiving on Postgres
  and Redis AOF persistence (see §4).

These targets apply to declared disasters (region loss, corrupted primary
database, total cluster loss), not routine single-node failures, which are
handled by existing redundancy (Redis cluster replicas, load-balanced API
instances) without triggering this plan.

## 3. Failure Scenarios in Scope

1. **Primary database loss/corruption** — PostgreSQL instance or volume
   destroyed, or data corrupted by a bad migration/deploy.
2. **Redis cluster loss** — session state, rate-limit counters, matchmaking
   queues, pub/sub broadcaster unavailable.
3. **Region/availability-zone outage** — cloud provider region hosting the
   backend, server, or database becomes unreachable.
4. **API gateway failure** — Kong outage blocking all inbound traffic.
5. **Bad deploy / data-corrupting migration** — application-level incident
   requiring rollback and point-in-time data recovery.
6. **Credential/secrets compromise** — requires emergency key rotation
   (JWT signing keys, DB credentials, protocol signer secret) without
   extended downtime.
7. **Total logging/monitoring loss** — ELK or Prometheus stack down,
   reducing incident visibility (Tier 2, does not block Tier 0 recovery).

## 4. Backup Strategy (RPO enforcement)

| Data store | Method | Frequency | Retention |
|---|---|---|---|
| PostgreSQL (primary) | Continuous WAL archiving + nightly base backup | Continuous (WAL shipped ≤ 5 min lag) | 35 days |
| PostgreSQL | Logical `pg_dump` snapshot | Daily | 14 days |
| Redis cluster | AOF (`appendfsync everysec`) + RDB snapshot | AOF continuous, RDB every 15 min | 7 days |
| Application secrets / config | Encrypted vault export | On every change | Full history in vault |
| Kong declarative config (`kong.yml`) | Version-controlled in repo | On every change | Full git history |

Backups are stored in a separate cloud region/account from production to
survive a full regional loss. Backup integrity (restorability) is verified
automatically after each nightly base backup via an automated restore-and-
checksum job.

## 5. Runbooks

Each runbook below assumes the on-call engineer has paged in via the
incident channel and declared a Sev1/Sev2 incident.

### 5.1 Primary database loss/corruption
1. Declare incident, freeze writes: scale backend API to 0 or enable
   maintenance mode at Kong.
2. Identify last-known-good point in time from WAL/backup catalog.
3. Provision a new Postgres instance from the latest base backup and replay
   WAL up to the target recovery point (point-in-time recovery).
4. Run `sqlx migrate info` against the restored instance to confirm schema
   version matches expected `backend/migrations` state.
5. Point `DATABASE_URL` at the restored instance, redeploy backend/server.
6. Smoke-test auth, matchmaking, and wallet read paths.
7. Lift maintenance mode; resume writes.
8. **Target: detection → restored ≤ 60 min.**

### 5.2 Redis cluster loss
1. Declare incident. Backend degrades gracefully where possible (rate
   limiting fails closed per `SecurityMiddleware` design — confirm this
   during drills), but matchmaking/session state is unavailable.
2. Provision a new Redis cluster from the most recent RDB snapshot; replay
   AOF if available for the freshest state.
3. Update `redis.url` in backend/server config and restart affected
   services (`RateLimitMiddleware`, `SecurityMiddleware`, `AntiBotMiddleware`,
   matchmaker, WS broadcaster all hold Redis connections — restart order:
   Redis → backend → server → WS broadcaster).
4. Verify matchmaking queue and pub/sub broadcast resume.

### 5.3 Region/AZ outage
1. Declare incident, initiate failover to standby region (DNS/load-balancer
   cutover to secondary deployment).
2. Promote the cross-region Postgres replica to primary (accept up to the
   replication-lag RPO, target < 15 min).
3. Point Redis clients at standby cluster (or rebuild per §5.2 in the
   standby region).
4. Redeploy backend/server/Kong into the standby region if not already warm.
5. Update external DNS/CDN to route to standby region.
6. Once origin region recovers, resync and fail back during a low-traffic
   window with a planned maintenance window (not under incident pressure).

### 5.4 API gateway (Kong) failure
1. Declare incident. Check `server/infra/kong/docker-compose.yml` /
   `kong.yml` deployment for crash-loop or config error.
2. Roll back to last known-good `kong.yml` (version-controlled) and
   redeploy.
3. If the gateway host itself is lost, redeploy Kong from the declarative
   config on a fresh host/container — this is why `kong.yml` must always be
   the source of truth, never mutated only via Admin API in production.

### 5.5 Bad deploy / data-corrupting migration
1. Declare incident, roll back application deploy to previous known-good
   release immediately (this alone resolves most app-level incidents).
2. If a migration wrote corrupt data: identify the corrupting migration in
   `backend/migrations`, write and review a compensating migration, and/or
   restore affected tables from the pre-migration WAL point (see §5.1) into
   a scratch instance to extract clean rows.
3. Never run `sqlx migrate revert` against production without a fresh
   backup taken immediately beforehand.

### 5.6 Credential/secrets compromise
1. Declare incident immediately — this is Sev1 regardless of visible
   customer impact.
2. Rotate the compromised credential(s): JWT signing key, DB credentials,
   protocol signer secret, Redis auth, or third-party API keys.
3. For JWT signing key rotation: deploy new key, accept both old and new
   for the token TTL window, then retire the old key — avoids mass
   logout while closing the exposure window.
4. Force-expire all active sessions if the compromise scope includes
   session/auth cookies.
5. Post-incident: audit access logs (ELK) for the exposure window.

### 5.7 Logging/monitoring loss (Tier 2)
1. Does not block other recovery runbooks — proceed with Tier 0/1 recovery
   using direct service health checks if ELK/Grafana are down.
2. Redeploy ELK/Prometheus stack from `server/infra/elk` and
   `server/infra/monitoring` compose definitions.
3. Backfill logs from local service log buffers where retained.

## 6. Quarterly DR Drills

- A DR drill is run **once per quarter**, scheduled by the infrastructure
  lead, rotating through the scenarios in §3 so each is drilled at least
  annually.
- Drills run against a staging environment that mirrors production
  topology, never against production data.
- Each drill measures actual time-to-recovery against the RTO/RPO targets
  in §2 and is timed by an observer who does not participate in the
  recovery itself.
- Drill scope includes: triggering the failure, following the runbook
  as written (not from memory), and recording every deviation from the
  documented steps.
- Drill outcomes feed directly into the post-incident review process
  (§7) — a failed or over-time drill is treated exactly like a real
  incident for review purposes and the corresponding runbook must be
  updated before the next drill.
- Drill schedule and history are tracked in the infrastructure team's
  incident tracker; the next scheduled drill date is always visible there
  (not duplicated in this document, to avoid staleness).

## 7. Post-Incident Reviews

Every declared disaster-recovery event (real incident or drill) gets a
post-incident review (PIR) within **5 business days**, covering:

1. **Timeline** — detection time, declaration time, each runbook step's
   start/end, full-recovery time, measured against RTO/RPO.
2. **Root cause** — technical root cause, not just the immediate trigger.
3. **What went well / what didn't** — including any runbook step that was
   unclear, wrong, or missing.
4. **Data loss assessment** — actual RPO achieved vs. target.
5. **Action items** — each with an owner and due date; tracked to closure,
   not just logged. Action items commonly include runbook updates, added
   monitoring/alerting, or automation of a manual recovery step.
6. **Runbook updates** — the relevant runbook in §5 is updated in the same
   pull request as the PIR document, so the next drill or incident uses the
   corrected procedure.

PIRs are blameless: the goal is systemic improvement, not individual
accountability. PIR documents are stored alongside incident records in the
infrastructure team's incident tracker and linked from this file's revision
history when they result in a plan change.

## 8. Ownership and Review Cadence

- **Owner:** Infrastructure/DevOps team.
- This document is reviewed and updated after every PIR that changes a
  runbook, and at minimum once per quarter alongside the DR drill.
- Any change to production topology (new data store, new critical service,
  new region) must be reflected here before it is considered fully rolled
  out.
