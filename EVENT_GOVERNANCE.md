# ArenaX Event Governance Policy

> Version: 1.0 · Status: Active · Owner: Backend Platform Team

This document defines the rules, conventions, and processes every engineer must follow when producing or consuming Kafka events on the ArenaX platform.

---

## 1. Core Principles

- **Events are immutable facts.** Once published, an event record is never edited. Corrections are published as new events.
- **The event store is the source of truth.** All domain events are persisted to `arenax.event.store` before (or alongside) any database write.
- **Loose coupling.** Producers must not know about consumers. Never call a consumer API from a producer service.
- **At-least-once delivery.** Every event may be delivered more than once. All consumers must be idempotent.

---

## 2. Topic Naming Convention

```
arenax.<domain>.<event-noun>s        # primary topic
arenax.<domain>.<event-noun>s.dlq    # dead-letter topic
arenax.event.store                   # global append-only store
```

| Domain segment | Examples |
|---|---|
| `user` | `arenax.user.events` |
| `match` | `arenax.match.events` |
| `achievement` | `arenax.achievement.events` |
| `wallet` | `arenax.wallet.events` |

**Rules:**
- Lowercase only. Use `.` as separator, never `-` or `_`.
- Every primary topic MUST have a corresponding `.dlq` topic.
- Topics are created with `auto.create.topics.enable=true` in dev; use Terraform/scripts in production with explicit partition counts.

---

## 3. Event Schema Standards

Every event MUST be wrapped in `EventEnvelope<T>`:

```typescript
interface EventEnvelope<T> {
  eventId: string;       // UUID v4 — unique per message
  eventType: string;     // Dot-separated noun e.g. "match.ended"
  version: number;       // Integer, starts at 1
  occurredAt: string;    // ISO-8601 UTC
  source: string;        // Emitting service name
  traceId: string;       // Distributed trace correlation id
  causationId?: string;  // eventId of the event that caused this one
  payload: T;
}
```

### 3.1 Versioning Strategy

| Change type | Action |
|---|---|
| Add optional field | No version bump — backwards-compatible |
| Rename / remove field | **Bump version** (e.g. `version: 2`) |
| Change field type | **Bump version** |
| New event type | New `eventType` string — no version change needed |

- Both `version: 1` and `version: 2` schemas must be handled by consumers during the transition window (minimum 2 sprints).
- Old schema versions are retired only after all consumer groups confirm migration.

### 3.2 Event Type Registry

All `eventType` strings must be registered in `server/src/services/kafka/domain-events.ts` before use. **Unregistered event types are rejected at code review.**

| Event type | Topic | Version | Owner |
|---|---|---|---|
| `user.registered` | `arenax.user.events` | 1 | Auth Service |
| `match.ended` | `arenax.match.events` | 1 | Match Service |
| `achievement.unlocked` | `arenax.achievement.events` | 1 | Achievement Service |
| `wallet.credited` | `arenax.wallet.events` | 1 | Wallet Service |

---

## 4. Producer Rules

1. **Always set a meaningful partition key** — use the aggregate's primary id (e.g. `userId`, `matchId`) to preserve ordering within an aggregate.
2. **Publish to both the domain topic and `arenax.event.store`** via `EventStore.append()`.
3. **Inject `traceId`** from the originating HTTP request (via `eventTracingMiddleware`). Never generate a new one mid-flow.
4. **Use idempotent producer** (`idempotent: true`) — already set in `KafkaClient`.
5. Log the `eventId` and `traceId` at `INFO` level after a successful publish.

---

## 5. Consumer Rules

1. **Consumer group ids** follow the pattern `arenax.<domain>.consumers`. One group per logical consumer (not per instance).
2. **Idempotency is mandatory.** Use the `eventId` as an idempotency key when writing to any database.
3. **Never `throw` from `handle()` without a meaningful log.** The base `EventConsumer` will retry and eventually route to DLQ.
4. **DLQ consumers** must be set up for every primary topic. A DLQ message must trigger a PagerDuty/Slack alert and be reviewed within 24 hours.
5. **Do not block the event loop.** All I/O inside `handle()` must be awaited.

---

## 6. Dead Letter Queue Policy

| Trigger | Action |
|---|---|
| Parse failure (invalid JSON) | Immediately route to DLQ |
| `handle()` throws after `maxRetries` (default 3) | Route to DLQ |
| Unknown event type | Route to DLQ with `reason: unknown_event_type` |

- DLQ messages are retained for **14 days**.
- Engineers are responsible for inspecting and replaying or discarding DLQ messages weekly.
- Use `EventReplay` to re-process a DLQ batch after the underlying bug is fixed.

---

## 7. Event Sourcing & Replay

The `arenax.event.store` topic is the immutable audit log of all domain events.

- **Retention:** infinite (log compaction enabled, no size limit in production).
- **Access control:** read-only for all services except the EventStore writer.
- **Replay:** use `EventReplay.run({ fromTimestamp, toTimestamp, eventTypes, onEvent })` to reconstruct state or backfill a new service.
- Replay runs should use a unique `replayGroupId` (auto-generated if unset) to avoid interfering with live consumer groups.

---

## 8. Observability Requirements

Every service MUST:
- Emit `latencyMs` in the publish log (alert if `>100 ms` P99).
- Emit consumer lag metrics to Prometheus via the `arenax_kafka_consumer_lag` gauge.
- Include `traceId` in every log line related to event processing.
- Set up Grafana dashboards for: publish rate, consumer lag, DLQ message count.

---

## 9. Change Process

1. **Schema change** → open a PR updating `domain-events.ts`, bump version if breaking, update the registry table in this doc.
2. **New topic** → update `TOPICS` constant, provision in staging, update Terraform before merging.
3. **Deprecation** → announce in `#platform-eng`, keep old version supported for 2 sprints, then remove.
4. All changes require review from at least **one Platform team member**.

---

## 10. Security

- Kafka is internal-only (not exposed outside VPC).
- No PII in event payloads beyond user/match IDs. Avoid storing phone numbers, emails, or financial details in event bodies — reference them by ID only.
- mTLS is required in production (`ssl.enabled=true`).
- Secrets (Kafka credentials) are stored in AWS Secrets Manager and injected as environment variables.
