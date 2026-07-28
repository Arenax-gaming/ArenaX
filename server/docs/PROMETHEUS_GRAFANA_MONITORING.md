# Monitoring — Prometheus + Grafana

Closes #661.

`arenax-server` already instruments itself with `prom-client`
(`src/services/metrics.service.ts`) and exposes it at `GET /api/metrics`
(see `METRICS_DASHBOARD.md` for what's recorded and how to record more).
This change adds the **collection, storage, visualization, and alerting**
side around that existing instrumentation — Prometheus scrapes the
endpoint, Grafana visualizes it, and Prometheus's Alertmanager-compatible
rule engine evaluates alert conditions — without changing how the app
itself records metrics.

## Architecture

```
prom-client (app process)
  -> GET /api/metrics                       (already existed)
       -> Prometheus (scrapes every 15s, evaluates infra/monitoring/alert.rules.yml)
            -> Grafana (dashboards, provisioned from infra/monitoring/grafana/)
```

The app has **no runtime dependency on Prometheus or Grafana being up** —
`/api/metrics` just serves whatever `prom-client`'s in-process registry
currently holds; if nothing scrapes it, the app behaves exactly as
before. This mirrors the same "app never depends on the observability
stack" principle used for logging (see `docs/ELK_LOGGING.md`).

## Components

All under `server/infra/monitoring/`:

- **`docker-compose.yml`** — Prometheus + Grafana.
- **`prometheus.yml`** — scrape config. Scrapes `arenax-server` at
  `host.docker.internal:3001/api/metrics` (the app runs on the host, not
  in this compose network — see the comments in the file for the Linux
  equivalent of `host.docker.internal`) and loads `alert.rules.yml`.
- **`alert.rules.yml`** — alerting rules: scrape target down, 5xx error
  rate > 5%, p95 HTTP latency > 1s, resident memory > 1.5GB, elevated
  high/critical `errors_total`.
- **`grafana/provisioning/datasources/prometheus.yml`** — auto-provisions
  the Prometheus datasource (uid `arenax-prometheus`) so Grafana needs no
  manual setup.
- **`grafana/provisioning/dashboards/dashboards.yml`** +
  **`grafana/dashboards/arenax-server-overview.json`** — auto-provisions
  the "ArenaX Server Overview" dashboard: HTTP request rate by status
  class, 5xx error ratio, HTTP latency p50/p95/p99, active connections,
  DB query rate/latency by table, application errors by severity, cache
  hit ratio, and process memory/CPU.

## Running locally

```bash
# 1. Start the app so there's something to scrape
cd server && npm run dev

# 2. Start the monitoring stack
docker compose -f server/infra/monitoring/docker-compose.yml up -d

open http://localhost:9090   # Prometheus — check Status > Targets to confirm the scrape is up
open http://localhost:3002   # Grafana — admin / admin (change the password on first login)
```

The "ArenaX Server Overview" dashboard is provisioned automatically
under the **ArenaX** folder — no manual datasource or dashboard import
needed.

## Alerting

`alert.rules.yml` is loaded by Prometheus's own rule engine
(`ALERTS`/`ALERTS_FOR_STATE` are queryable directly in Prometheus, and
firing alerts show under **Alerts** in the Prometheus UI). To actually
route them to Slack/PagerDuty/email, point Prometheus at an
Alertmanager instance (`alerting.alertmanagers` in `prometheus.yml`) —
that's intentionally not bundled here since the routing destinations are
environment-specific credentials, matching how `docs/ELK_LOGGING.md`
handles Kibana alerting.

## Production notes

The bundled compose file is for local development:

- Grafana ships with the default `admin/admin` credentials — set
  `GF_SECURITY_ADMIN_PASSWORD` from a secret in any shared environment.
- Prometheus's local TSDB (`--storage.tsdb.retention.time=15d`) is fine
  for a single box; for HA or longer retention, use Thanos/Cortex/Mimir
  or a managed Prometheus-compatible backend.
- The `host.docker.internal` scrape target assumes the app runs on the
  same host as the compose stack. If `arenax-server` is containerized
  and joined to a shared network (or run in Kubernetes), replace the
  static target with the container/service DNS name (or a Kubernetes
  `ServiceMonitor` if using the Prometheus Operator).
