# On-Call & Alerting

Closes [#970](https://github.com/Arenax-gaming/ArenaX/issues/970) — unified
monitoring and alerting across `arenax-server` and `arenax-backend`.

## Stack

```
Prometheus  --scrapes-->  arenax-server (/api/metrics), arenax-backend (/metrics)
Prometheus  --evaluates-> alert.rules.yml, backend-alert.rules.yml
Prometheus  --fires-->    Alertmanager
Alertmanager --routes-->  PagerDuty (Events API v2)
Grafana     --queries-->  Prometheus, renders arenax-server-overview / arenax-backend-overview
```

Bring it up:

```bash
mkdir -p server/infra/monitoring/secrets
echo -n '<pagerduty critical service integration key>' > server/infra/monitoring/secrets/pagerduty_critical_routing_key
echo -n '<pagerduty warning service integration key>'  > server/infra/monitoring/secrets/pagerduty_warning_routing_key
docker compose -f server/infra/monitoring/docker-compose.yml up -d
```

- Prometheus: http://localhost:9090
- Alertmanager: http://localhost:9093
- Grafana: http://localhost:3002 (`admin` / `admin`, change on first login)

## Alert thresholds

| Alert | Service | Threshold | Severity | For |
|---|---|---|---|---|
| `ArenaXServerDown` / `ArenaXBackendDown` | both | scrape target down (`up == 0`) | critical | 1m |
| `HighHttpErrorRate` / `BackendHighHttpErrorRate` | both | 5xx ratio > 5% | critical | 5m |
| `HighHttpLatencyP95` / `BackendHighHttpLatencyP95` | both | p95 latency > 1s | warning | 5m |
| `HighProcessMemory` / `BackendHighProcessMemory` | both | RSS > 1.5GB | warning | 10m |
| `ElevatedApplicationErrors` | arenax-server | high/critical app errors > 1/s | warning | 5m |
| `BackendDbPoolNearExhaustion` | arenax-backend | pool >90% active connections | warning | 5m |

Definitions live in `alert.rules.yml` (arenax-server) and
`backend-alert.rules.yml` (arenax-backend). Adjust thresholds there as
real-world baselines are established — treat the numbers above as
starting points, not permanent SLOs.

## Escalation policy

1. **Critical alert fires** → Alertmanager pages the on-call engineer via
   PagerDuty immediately (`group_wait: 10s`, re-notifies every 1h while
   still firing).
2. **No acknowledgement within 15 minutes** → PagerDuty's escalation
   policy (configured in the PagerDuty service, not in this repo) escalates
   to the secondary on-call.
3. **No acknowledgement within 30 minutes** → escalates to the engineering
   lead / team channel.
4. **Warning alert fires** → pages on-call once (`group_wait: 30s`,
   re-notifies every 6h while still firing); no auto-escalation past
   primary on-call. Warnings for a service that's already fully down
   (`*Down` alert active) are suppressed by `inhibit_rules` in
   `alertmanager.yml` so a full outage doesn't also spam latency/memory
   pages for the same root cause.
5. **Acknowledge in PagerDuty** as soon as you start investigating, so the
   escalation timers above reset and the rest of the rotation isn't paged
   for the same incident.

Rotation membership, secondary/lead assignment, and notification channels
(phone/SMS/push) are configured in the PagerDuty service itself, not in
this repo — this file documents the policy Alertmanager's routing enforces
and the thresholds behind it, so anyone touching `alert.rules.yml` /
`backend-alert.rules.yml` / `alertmanager.yml` knows what behavior they're
changing.

## Adding a new alert

1. Add the Prometheus rule to `alert.rules.yml` or `backend-alert.rules.yml`
   with a `severity` label of `critical` or `warning` (Alertmanager's
   routing in `alertmanager.yml` matches on that label — anything else
   falls through to the default `pagerduty-warning` receiver).
2. Add a row to the threshold table above.
3. If it should show up on a dashboard, add a panel to the relevant
   `grafana/dashboards/*.json` file.
