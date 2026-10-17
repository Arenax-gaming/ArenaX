//! Redis Streams for event-driven match updates (Issue #1254).
//!
//! Match state changes are appended to one stream. Consumer groups hand each
//! entry to a single worker so instances can process in parallel, and entries
//! that fail too many times are copied to a dead-letter stream.
//!
//! # Event schema (`MatchStateEvent`, version 1)
//!
//! | Field | Type | Meaning |
//! | --- | --- | --- |
//! | `schema_version` | number | Always `1` for this document |
//! | `event_id` | uuid | Unique id of this transition |
//! | `match_id` | uuid | Match whose state changed |
//! | `from_status` | string | Previous status (`pending`, `started`, `CREATED`, …) |
//! | `to_status` | string | Status after the transition |
//! | `occurred_at` | string | RFC3339 timestamp |
//!
//! Stream key: `match:state`. Dead-letter key: `match:state:dlq`.
//! The payload is one JSON object stored in the `payload` field.
//! Redis commands used: `XADD`, `XGROUP CREATE`, `XREADGROUP`, `XACK`.

use chrono::Utc;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub const MATCH_STATE_STREAM: &str = "match:state";
pub const MATCH_STATE_SCHEMA_VERSION: u32 = 1;

/// Human-readable schema kept next to the type that produces the payload.
pub const MATCH_STATE_EVENT_SCHEMA: &str = "\
MatchStateEvent schema_version=1
fields: schema_version:u32, event_id:uuid, match_id:uuid, \
from_status:string, to_status:string, occurred_at:rfc3339
stream: match:state
dlq: match:state:dlq
redis: XADD, XGROUP CREATE, XREADGROUP, XACK
";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MatchStateEvent {
    pub schema_version: u32,
    pub event_id: Uuid,
    pub match_id: Uuid,
    pub from_status: String,
    pub to_status: String,
    pub occurred_at: String,
}

impl MatchStateEvent {
    pub fn new(match_id: Uuid, from_status: impl Into<String>, to_status: impl Into<String>) -> Self {
        Self {
            schema_version: MATCH_STATE_SCHEMA_VERSION,
            event_id: Uuid::new_v4(),
            match_id,
            from_status: from_status.into(),
            to_status: to_status.into(),
            occurred_at: Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Delivery {
    pub id: String,
    pub payload: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NackOutcome {
    Retry { deliveries: u32 },
    DeadLettered { deliveries: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeadLetter {
    pub id: String,
    pub payload: String,
    pub group: String,
    pub deliveries: u32,
    pub reason: String,
}

#[derive(Clone)]
struct Pending {
    deliveries: u32,
    payload: String,
}

struct GroupState {
    /// Index of the next entry this group has not delivered.
    cursor: usize,
    pending: HashMap<String, Pending>,
}

struct MemoryLog {
    seq: u64,
    entries: Vec<Delivery>,
    groups: HashMap<String, GroupState>,
    dlq: Vec<DeadLetter>,
    max_deliveries: u32,
}

impl MemoryLog {
    fn publish(&mut self, payload: String) -> String {
        self.seq += 1;
        let id = format!("1-{}", self.seq);
        self.entries.push(Delivery { id: id.clone(), payload });
        id
    }

    fn read(&mut self, group: &str, count: usize) -> Vec<Delivery> {
        let entry_count = self.entries.len();
        let start = self.groups.get(group).map(|g| g.cursor).unwrap_or(0);
        let end = (start + count).min(entry_count);
        let batch = self.entries[start..end].to_vec();
        let state = self.groups.entry(group.to_string()).or_insert(GroupState {
            cursor: 0,
            pending: HashMap::new(),
        });
        state.cursor = end;
        for delivery in &batch {
            state.pending.insert(
                delivery.id.clone(),
                Pending {
                    deliveries: 1,
                    payload: delivery.payload.clone(),
                },
            );
        }
        batch
    }

    fn ack(&mut self, group: &str, id: &str) -> bool {
        self.groups
            .get_mut(group)
            .and_then(|g| g.pending.remove(id))
            .is_some()
    }

    fn nack(&mut self, group: &str, id: &str) -> Result<NackOutcome, String> {
        let max = self.max_deliveries;
        let dead = {
            let state = self
                .groups
                .get_mut(group)
                .ok_or_else(|| format!("unknown consumer group {group}"))?;
            let pending = state
                .pending
                .get_mut(id)
                .ok_or_else(|| format!("id {id} is not pending in {group}"))?;
            pending.deliveries += 1;
            if pending.deliveries >= max {
                let pending = state.pending.remove(id).expect("pending entry");
                Some((pending.deliveries, pending.payload))
            } else {
                return Ok(NackOutcome::Retry {
                    deliveries: pending.deliveries,
                });
            }
        };
        let (deliveries, payload) = dead.expect("dead letter");
        self.dlq.push(DeadLetter {
            id: id.to_string(),
            payload,
            group: group.to_string(),
            deliveries,
            reason: format!("exceeded {max} deliveries"),
        });
        Ok(NackOutcome::DeadLettered { deliveries })
    }
}

#[derive(Clone)]
struct RedisLog {
    conn: ConnectionManager,
    stream_key: String,
    dlq_key: String,
    max_deliveries: u32,
}

#[derive(Clone)]
enum EventStreamInner {
    Memory(Arc<Mutex<MemoryLog>>),
    Redis(RedisLog),
}

/// Append-only event log with Redis Streams semantics.
#[derive(Clone)]
pub struct EventStream {
    inner: EventStreamInner,
}

impl EventStream {
    pub fn memory(max_deliveries: u32) -> Self {
        Self {
            inner: EventStreamInner::Memory(Arc::new(Mutex::new(MemoryLog {
                seq: 0,
                entries: Vec::new(),
                groups: HashMap::new(),
                dlq: Vec::new(),
                max_deliveries: max_deliveries.max(1),
            }))),
        }
    }

    pub fn redis(conn: ConnectionManager, stream_key: impl Into<String>, max_deliveries: u32) -> Self {
        let stream_key = stream_key.into();
        let dlq_key = format!("{stream_key}:dlq");
        Self {
            inner: EventStreamInner::Redis(RedisLog {
                conn,
                stream_key,
                dlq_key,
                max_deliveries: max_deliveries.max(1),
            }),
        }
    }

    pub async fn publish(&self, payload: &str) -> Result<String, String> {
        match &self.inner {
            EventStreamInner::Memory(log) => Ok(log.lock().expect("event log").publish(payload.to_string())),
            EventStreamInner::Redis(log) => {
                let mut conn = log.conn.clone();
                redis::cmd("XADD")
                    .arg(&log.stream_key)
                    .arg("*")
                    .arg("payload")
                    .arg(payload)
                    .query_async::<String>(&mut conn)
                    .await
                    .map_err(|e| e.to_string())
            }
        }
    }

    pub async fn publish_match_state(&self, event: &MatchStateEvent) -> Result<String, String> {
        let payload = serde_json::to_string(event).map_err(|e| e.to_string())?;
        self.publish(&payload).await
    }

    /// Read new entries for one consumer in a group.
    ///
    /// Each entry is delivered to only one consumer of the group. A second
    /// group has its own cursor and therefore sees the same entries.
    pub async fn read_group(
        &self,
        group: &str,
        consumer: &str,
        count: usize,
    ) -> Result<Vec<Delivery>, String> {
        if group.is_empty() || consumer.is_empty() {
            return Err("group and consumer are required".into());
        }
        match &self.inner {
            EventStreamInner::Memory(log) => Ok(log.lock().expect("event log").read(group, count)),
            EventStreamInner::Redis(log) => {
                let mut conn = log.conn.clone();
                ensure_group(&mut conn, &log.stream_key, group).await?;
                let value: redis::Value = redis::cmd("XREADGROUP")
                    .arg("GROUP")
                    .arg(group)
                    .arg(consumer)
                    .arg("COUNT")
                    .arg(count)
                    .arg("STREAMS")
                    .arg(&log.stream_key)
                    .arg(">")
                    .query_async(&mut conn)
                    .await
                    .map_err(|e| e.to_string())?;
                let parsed = parse_stream_read(&value);
                let payload_key = format!("{}:payload:{group}", log.stream_key);
                for delivery in &parsed {
                    let _: i64 = redis::cmd("HSET")
                        .arg(&payload_key)
                        .arg(&delivery.id)
                        .arg(&delivery.payload)
                        .query_async(&mut conn)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                Ok(parsed)
            }
        }
    }

    pub async fn ack(&self, group: &str, id: &str) -> Result<bool, String> {
        match &self.inner {
            EventStreamInner::Memory(log) => Ok(log.lock().expect("event log").ack(group, id)),
            EventStreamInner::Redis(log) => {
                let mut conn = log.conn.clone();
                let n: i64 = redis::cmd("XACK")
                    .arg(&log.stream_key)
                    .arg(group)
                    .arg(id)
                    .query_async(&mut conn)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(n > 0)
            }
        }
    }

    pub async fn nack(&self, group: &str, id: &str) -> Result<NackOutcome, String> {
        match &self.inner {
            EventStreamInner::Memory(log) => log.lock().expect("event log").nack(group, id),
            EventStreamInner::Redis(log) => {
                let mut conn = log.conn.clone();
                let key = format!("{}:deliveries:{group}", log.stream_key);
                let deliveries: u32 = redis::cmd("HINCRBY")
                    .arg(&key)
                    .arg(id)
                    .arg(1_i64)
                    .query_async(&mut conn)
                    .await
                    .map_err(|e| e.to_string())?;
                // The first XREADGROUP delivery is not counted in this hash,
                // so add one to compare against the same max the memory log uses.
                let seen = deliveries + 1;
                if seen >= log.max_deliveries {
                    let payload: Option<String> = redis::cmd("HGET")
                        .arg(format!("{}:payload:{group}", log.stream_key))
                        .arg(id)
                        .query_async(&mut conn)
                        .await
                        .unwrap_or(None);
                    let body = payload.unwrap_or_default();
                    let _: String = redis::cmd("XADD")
                        .arg(&log.dlq_key)
                        .arg("*")
                        .arg("id")
                        .arg(id)
                        .arg("payload")
                        .arg(&body)
                        .arg("group")
                        .arg(group)
                        .arg("reason")
                        .arg("exceeded max deliveries")
                        .query_async(&mut conn)
                        .await
                        .map_err(|e| e.to_string())?;
                    let _: i64 = redis::cmd("XACK")
                        .arg(&log.stream_key)
                        .arg(group)
                        .arg(id)
                        .query_async(&mut conn)
                        .await
                        .map_err(|e| e.to_string())?;
                    Ok(NackOutcome::DeadLettered { deliveries: seen })
                } else {
                    Ok(NackOutcome::Retry { deliveries: seen })
                }
            }
        }
    }

    pub fn dead_letters(&self) -> Vec<DeadLetter> {
        match &self.inner {
            EventStreamInner::Memory(log) => log.lock().expect("event log").dlq.clone(),
            EventStreamInner::Redis(_) => Vec::new(),
        }
    }
}

async fn ensure_group(conn: &mut ConnectionManager, stream_key: &str, group: &str) -> Result<(), String> {
    match redis::cmd("XGROUP")
        .arg("CREATE")
        .arg(stream_key)
        .arg(group)
        .arg("0")
        .arg("MKSTREAM")
        .query_async::<String>(&mut *conn)
        .await
    {
        Ok(_) => Ok(()),
        Err(e) if e.to_string().contains("BUSYGROUP") => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn value_str(value: &redis::Value) -> Option<String> {
    match value {
        redis::Value::BulkString(bytes) => String::from_utf8(bytes.clone()).ok(),
        redis::Value::SimpleString(s) => Some(s.clone()),
        redis::Value::VerbatimString { text, .. } => Some(text.clone()),
        _ => None,
    }
}

/// Parses an `XREADGROUP` reply into `(id, payload)` deliveries.
pub fn parse_stream_read(value: &redis::Value) -> Vec<Delivery> {
    let redis::Value::Array(streams) = value else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for stream in streams {
        let redis::Value::Array(parts) = stream else {
            continue;
        };
        let entries = parts.get(1).and_then(|v| match v {
            redis::Value::Array(items) => Some(items),
            _ => None,
        });
        let Some(entries) = entries else {
            continue;
        };
        for entry in entries {
            let redis::Value::Array(fields) = entry else {
                continue;
            };
            let Some(id) = fields.first().and_then(value_str) else {
                continue;
            };
            let payload = match fields.get(1) {
                Some(redis::Value::Array(pairs)) => pairs
                    .chunks(2)
                    .find_map(|chunk| {
                        let name = value_str(chunk.first()?)?;
                        if name == "payload" {
                            value_str(chunk.get(1)?)
                        } else {
                            None
                        }
                    })
                    .unwrap_or_default(),
                _ => String::new(),
            };
            out.push(Delivery { id, payload });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream() -> EventStream {
        EventStream::memory(3)
    }

    #[tokio::test]
    async fn match_events_round_trip_through_a_consumer_group() {
        let stream = stream();
        let event = MatchStateEvent::new(Uuid::new_v4(), "pending", "in_progress");
        stream.publish_match_state(&event).await.unwrap();

        let got = stream.read_group("workers", "w1", 10).await.unwrap();
        assert_eq!(got.len(), 1);
        let decoded: MatchStateEvent = serde_json::from_str(&got[0].payload).unwrap();
        assert_eq!(decoded.from_status, "pending");
        assert_eq!(decoded.to_status, "in_progress");
        assert_eq!(decoded.schema_version, 1);
        assert!(stream.ack("workers", &got[0].id).await.unwrap());
    }

    #[tokio::test]
    async fn a_group_splits_work_and_a_second_group_sees_every_event() {
        let stream = stream();
        for status in ["started", "completed", "disputed", "finalized"] {
            stream
                .publish_match_state(&MatchStateEvent::new(Uuid::new_v4(), "previous", status))
                .await
                .unwrap();
        }

        let a = stream.read_group("workers", "a", 2).await.unwrap();
        let b = stream.read_group("workers", "b", 2).await.unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!(b.len(), 2);
        let mut ids: Vec<_> = a.iter().chain(b.iter()).map(|d| d.id.clone()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 4, "consumers in one group must not share an entry");

        let other = stream.read_group("analytics", "c", 10).await.unwrap();
        assert_eq!(other.len(), 4, "each consumer group reads the full stream");
    }

    #[tokio::test]
    async fn repeated_failure_lands_in_the_dead_letter_queue() {
        let stream = EventStream::memory(3);
        let id = stream.publish(r#"{"to_status":"completed"}"#).await.unwrap();
        let delivery = stream.read_group("workers", "w1", 1).await.unwrap();
        assert_eq!(delivery[0].id, id);

        assert!(matches!(
            stream.nack("workers", &id).await.unwrap(),
            NackOutcome::Retry { deliveries: 2 }
        ));
        assert!(matches!(
            stream.nack("workers", &id).await.unwrap(),
            NackOutcome::DeadLettered { deliveries: 3 }
        ));

        let dlq = stream.dead_letters();
        assert_eq!(dlq.len(), 1);
        assert_eq!(dlq[0].id, id);
        assert!(dlq[0].payload.contains("completed"));
        assert!(!stream.ack("workers", &id).await.unwrap());
    }

    #[test]
    fn schema_document_names_the_match_state_fields() {
        assert!(MATCH_STATE_EVENT_SCHEMA.contains("schema_version"));
        assert!(MATCH_STATE_EVENT_SCHEMA.contains("match_id"));
        assert!(MATCH_STATE_EVENT_SCHEMA.contains("from_status"));
        assert!(MATCH_STATE_EVENT_SCHEMA.contains("to_status"));
        assert!(MATCH_STATE_EVENT_SCHEMA.contains("match:state:dlq"));
    }

    #[test]
    fn parser_reads_xreadgroup_payloads_and_ignores_nil() {
        assert!(parse_stream_read(&redis::Value::Nil).is_empty());
        let value = redis::Value::Array(vec![redis::Value::Array(vec![
            redis::Value::BulkString(b"match:state".to_vec()),
            redis::Value::Array(vec![redis::Value::Array(vec![
                redis::Value::BulkString(b"9-0".to_vec()),
                redis::Value::Array(vec![
                    redis::Value::BulkString(b"payload".to_vec()),
                    redis::Value::BulkString(br#"{"to_status":"started"}"#.to_vec()),
                ]),
            ])]),
        ])]);
        let parsed = parse_stream_read(&value);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "9-0");
        assert!(parsed[0].payload.contains("started"));
    }
}
