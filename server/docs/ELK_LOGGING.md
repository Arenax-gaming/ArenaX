# Centralized Logging — ELK Stack

Closes #660.

`arenax-server` already logs through winston in structured JSON
(`src/services/logger.service.ts`) — every request carries a
`correlation_id`, and logs are written both to the console and to
rotated files under `LOG_DIR` (`server/logs/` by default) via
`winston-daily-rotate-file`. This change adds the **centralized side**:
shipping those logs to Elasticsearch and making them searchable and
visualizable in Kibana, without changing how the app itself logs.

## Architecture

```
winston (app process)
  -> server/logs/application-*.log, error-*.log   (JSON lines, already existed)
       -> Filebeat (tails the files)
            -> Logstash (parses, enriches, tags log stream)
                 -> Elasticsearch (arenax-server-logs-YYYY.MM.dd indices)
                      -> Kibana (search, dashboards, alerts)
```

The app writes to disk and nothing else — it has **no runtime dependency
on Logstash or Elasticsearch being up**. If the ELK stack is down, logs
simply queue up on disk (subject to the existing `LOG_MAX_FILES`
retention) and Filebeat catches up once it's back, resuming from its
on-disk read offset. This was a deliberate choice over shipping logs
directly from the winston process (e.g. via a TCP/HTTP transport): a log
sink outage should never be able to slow down or block request handling.

## Components

All under `server/infra/elk/`:

- **`docker-compose.yml`** — Elasticsearch, Logstash, Kibana, Filebeat.
  Single-node, security-disabled — local development settings; see
  Production notes below.
- **`filebeat/filebeat.yml`** — tails `application-*.log` and
  `error-*.log` from the bind-mounted `server/logs/` directory. Its
  `ndjson` parser decodes each line's JSON in place, so structured fields
  (`level`, `message`, `correlation_id`, `service`, `environment`, ...)
  arrive at Logstash already parsed rather than as an opaque string.
- **`logstash/pipeline/logstash.conf`** — promotes winston's `timestamp`
  field to Elasticsearch's `@timestamp`, tags each record with which
  rotated file it came from (`log_stream: application|error`), and writes
  to a daily index `arenax-server-logs-YYYY.MM.dd`.
- **`logstash/config/logstash.yml`** — minimal Logstash node config.

## Running locally

```bash
docker compose -f server/infra/elk/docker-compose.yml up -d
npm run dev   # generate some log traffic from server/
open http://localhost:5601
```

In Kibana: **Stack Management → Index Patterns** (or **Data Views** on
newer Kibana), create a pattern for `arenax-server-logs-*` using
`@timestamp` as the time field. **Discover** then shows searchable,
structured logs — filterable by `level`, `correlation_id`, `log_stream`,
etc.

## Log analysis & visualization

With the index pattern in place:

- **Discover** — free-text/KQL search, e.g. `level: error AND
  correlation_id: "<id>"` to pull every log line for one request across
  services.
- **Dashboards** — build panels on `level` (error rate over time),
  `log_stream`, or any field the app logs as metadata (e.g. `route`,
  `userId` if a resolver/controller includes it).

## Alerts

Kibana Alerting (Stack Management → Rules) can watch the
`arenax-server-logs-*` index directly — e.g. an Elasticsearch query rule
firing when `level: error` count exceeds a threshold in a rolling
window. This is configured in the Kibana UI/API rather than checked into
this repo, since alert destinations (Slack/PagerDuty/email) are
environment-specific credentials.

## Retention

Two independent retention layers exist:

- **On disk**: `LOG_MAX_FILES` (default `14d`, see `.env.example`) — the
  existing winston-daily-rotate-file setting, unchanged.
- **In Elasticsearch**: not configured with a default ILM policy in the
  bundled dev compose (a single-node dev cluster doesn't need one). For
  a longer-lived environment, apply an Index Lifecycle Management policy,
  e.g.:

  ```bash
  curl -X PUT "localhost:9200/_ilm/policy/arenax-server-logs-policy" \
    -H 'content-type: application/json' -d '{
      "policy": {
        "phases": {
          "hot":    { "actions": { "rollover": { "max_age": "1d" } } },
          "delete": { "min_age": "14d", "actions": { "delete": {} } }
        }
      }
    }'
  ```

  matched to whatever retention window compliance/ops actually requires.

## Production notes

The bundled compose file is for local development:

- `xpack.security.enabled: "false"` — production Elasticsearch/Kibana
  should run with security enabled (API keys / users, not open access).
- Single-node Elasticsearch has no replica shards and no HA — production
  needs a multi-node cluster or a managed service (Elastic Cloud, AWS
  OpenSearch, etc.).
- Filebeat here reads a bind-mounted host directory, which only works
  because the app process and Filebeat share a filesystem. In a
  containerized/Kubernetes deployment, use the Filebeat Kubernetes
  DaemonSet with `autodiscover`, or have the app log to stdout and let
  the container runtime's log driver forward it (both are standard
  alternatives to the file-tailing setup used here for local dev).
