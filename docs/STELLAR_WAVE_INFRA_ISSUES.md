# Stellar Wave Infrastructure — Issue Status

Tracking the four "Stellar Wave" infrastructure issues assigned for this cycle
and where each acceptance criterion is satisfied in the repo.

## #1285 — PostgreSQL schema (users, tournaments, matches, wallets)

Satisfied by `backend/migrations/` (SQLx), primarily:

- `20240928000001_create_core_tables.up.sql` — `users`, `stellar_accounts`
  (public key + encrypted secret), `tournaments`, `tournament_matches`,
  `matches`, `wallets` (`balance_ngn`, `balance_xlm`, `balance_arenax_tokens`),
  `transactions` (type, amount, currency, stellar tx reference, status)
- `20260325000001_reputation_system.up.sql` — reputation/skill scores on users
- `user_elo` / `elo_history` tables in the core migration

## #1287 — Redis (cache, OTP, leaderboards, Pub/Sub)

Satisfied by:

- `backend/src/realtime/redis_client.rs` — `ConnectionManager` (pooling) with
  `set_ex` (OTP/TTL-style storage) and `publish`
- `backend/src/realtime/event_bus.rs`, `ws_broadcaster.rs` — Pub/Sub channels
  for user/match/leaderboard real-time updates
- `backend/src/service/matchmaker.rs` — sorted-set (`ZADD`) Elo buckets for
  matchmaking/leaderboards
- Redis 7 service + persistence volume in root `docker-compose.yml`;
  cluster config under `server/infra/redis-cluster/`

## #1288 — S3/MinIO storage (screenshots, telemetry, evidence)

Satisfied by:

- `backend/src/service/evidence_storage.rs` — S3/MinIO-compatible store
  (single-shot signed PUT), validated + SHA-256-hashed evidence objects
- MinIO service in root `docker-compose.yml`; `S3_*` config in
  `backend/src/config.rs` and `backend/env.example`
- Evidence hash chain persisted via `20260829000002_dispute_evidence_hash.up.sql`

## #1290 — Prometheus + Grafana monitoring with Stellar tx latency

Satisfied by `server/infra/monitoring/`:

- `docker-compose.yml` — Prometheus, Alertmanager (PagerDuty routing), Grafana
- `prometheus.yml` — scrapes `arenax-server` (`/api/metrics`) and
  `arenax-backend` (`/metrics`)
- `alert.rules.yml`, `backend-alert.rules.yml` — error-rate, latency p95,
  pool exhaustion, memory, `SorobanDlqBacklog`
- `backend/src/metrics.rs` — API latency/error metrics, DB pool + query
  latency, Soroban tx submitted/success/failed/retry counters and
  `soroban_tx_latency_seconds` histogram
- `grafana/dashboards/arenax-backend-overview.json` + provisioning

Known follow-up (tracked separately): a few `soroban_*` / profile-cache
metric statics referenced by `backend/src/metrics.rs` helpers need their
definitions restored so `cargo check` passes cleanly.
