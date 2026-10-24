//! Per-tournament Redis Pub/Sub fan-out and bounded server-sent event streams.
//!
//! Pub/Sub is ephemeral. Every connection and detected delivery gap requests a
//! REST snapshot; events are invalidations, not a durable event log.

use actix_web::{web::Bytes, Error, HttpResponse};
use chrono::{DateTime, Utc};
use futures_util::{stream, StreamExt};
use redis::{aio::ConnectionManager, AsyncCommands};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, Weak,
    },
    time::Duration,
};
use tokio::{
    sync::{broadcast, OwnedSemaphorePermit, Semaphore},
    task::AbortHandle,
};
use uuid::Uuid;

const CHANNEL_PATTERN: &str = "tournament:*";
const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const HEARTBEAT: Duration = Duration::from_secs(15);
const REDIS_DEADLINE: Duration = Duration::from_secs(5);

pub fn tournament_channel(id: Uuid) -> String {
    format!("tournament:{id}")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdateKind {
    Created,
    StatusChanged,
    MatchResult,
    PrizePoolChanged,
    ParticipantsChanged,
    BracketChanged,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentUpdate {
    pub tournament_id: Uuid,
    pub kind: UpdateKind,
    pub timestamp: DateTime<Utc>,
    pub data: serde_json::Value,
}

impl TournamentUpdate {
    pub fn new(tournament_id: Uuid, kind: UpdateKind, data: serde_json::Value) -> Self {
        Self {
            tournament_id,
            kind,
            timestamp: Utc::now(),
            data,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_clients: usize,
    pub max_clients_per_tournament: usize,
    pub buffer_capacity: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_clients: 5_000,
            max_clients_per_tournament: 1_000,
            buffer_capacity: 256,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum HubError {
    #[error("Redis operation failed: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("Event serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Redis operation timed out")]
    Timeout,
    #[error("Real-time subscription is temporarily unavailable")]
    Unavailable,
    #[error("Real-time connection limit reached")]
    Capacity,
    #[error("Real-time limits must be positive and fit Tokio's capacity bounds")]
    InvalidLimits,
    #[error("Tournament event exceeds the maximum message size")]
    MessageTooLarge,
}

#[derive(Debug, Clone)]
pub enum Delivery {
    Update(Arc<String>),
    Resync,
}

impl Delivery {
    pub fn sse_frame(&self) -> String {
        match self {
            Delivery::Update(payload) => format!("event: tournament_update\ndata: {payload}\n\n"),
            Delivery::Resync => "event: resync\ndata: {}\n\n".to_owned(),
        }
    }
}

struct Room {
    sender: broadcast::Sender<Delivery>,
    clients: usize,
}

struct Inner {
    rooms: Mutex<HashMap<Uuid, Room>>,
    ready: AtomicBool,
    slots: Arc<Semaphore>,
    limits: Limits,
    subscriber_abort: Mutex<Option<AbortHandle>>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        if let Some(handle) = self
            .subscriber_abort
            .lock()
            .expect("subscriber handle")
            .take()
        {
            handle.abort();
        }
    }
}

/// Cloneable application-wide hub: one publisher and one Redis pattern
/// subscription per backend process, irrespective of the number of viewers.
#[derive(Clone)]
pub struct TournamentHub {
    publisher: ConnectionManager,
    inner: Arc<Inner>,
}

impl TournamentHub {
    pub async fn connect(redis_url: &str, limits: Limits) -> Result<Self, HubError> {
        if limits.max_clients == 0
            || limits.max_clients > Semaphore::MAX_PERMITS
            || limits.max_clients_per_tournament == 0
            || limits.buffer_capacity == 0
            || limits.buffer_capacity > usize::MAX >> 1
        {
            return Err(HubError::InvalidLimits);
        }

        let client = redis::Client::open(redis_url)?;
        let publisher =
            tokio::time::timeout(REDIS_DEADLINE, ConnectionManager::new(client.clone()))
                .await
                .map_err(|_| HubError::Timeout)??;
        let mut pubsub = tokio::time::timeout(REDIS_DEADLINE, client.get_async_pubsub())
            .await
            .map_err(|_| HubError::Timeout)??;
        tokio::time::timeout(REDIS_DEADLINE, pubsub.psubscribe(CHANNEL_PATTERN))
            .await
            .map_err(|_| HubError::Timeout)??;

        let inner = Arc::new(Inner {
            rooms: Mutex::new(HashMap::new()),
            ready: AtomicBool::new(true),
            slots: Arc::new(Semaphore::new(limits.max_clients)),
            limits,
            subscriber_abort: Mutex::new(None),
        });
        let weak = Arc::downgrade(&inner);
        let handle = tokio::spawn(subscribe_loop(client, pubsub, weak));
        *inner.subscriber_abort.lock().expect("subscriber handle") = Some(handle.abort_handle());
        Ok(Self { publisher, inner })
    }

    pub fn is_ready(&self) -> bool {
        self.inner.ready.load(Ordering::Acquire)
    }

    pub fn active_clients(&self) -> usize {
        self.inner.limits.max_clients - self.inner.slots.available_permits()
    }

    pub fn active_tournaments(&self) -> usize {
        self.inner.rooms.lock().expect("tournament rooms").len()
    }

    pub fn subscribe(&self, tournament_id: Uuid) -> Result<Subscription, HubError> {
        if !self.is_ready() {
            return Err(HubError::Unavailable);
        }
        let permit = self
            .inner
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| HubError::Capacity)?;
        let mut rooms = self.inner.rooms.lock().expect("tournament rooms");
        let room = rooms.entry(tournament_id).or_insert_with(|| Room {
            sender: broadcast::channel(self.inner.limits.buffer_capacity).0,
            clients: 0,
        });
        if room.clients >= self.inner.limits.max_clients_per_tournament {
            return Err(HubError::Capacity);
        }
        room.clients += 1;
        Ok(Subscription {
            receiver: room.sender.subscribe(),
            inner: self.inner.clone(),
            tournament_id,
            _permit: permit,
            initial: true,
        })
    }

    /// Publish after a database mutation has committed. Callers treat a failure
    /// as a delivery failure, without changing the successful mutation result.
    pub async fn publish(&self, update: &TournamentUpdate) -> Result<(), HubError> {
        let payload = serde_json::to_string(update)?;
        if payload.len() > MAX_MESSAGE_BYTES {
            return Err(HubError::MessageTooLarge);
        }
        let mut connection = self.publisher.clone();
        tokio::time::timeout(
            REDIS_DEADLINE,
            connection.publish::<_, _, usize>(tournament_channel(update.tournament_id), payload),
        )
        .await
        .map_err(|_| HubError::Timeout)??;
        Ok(())
    }
}

fn resync_all(inner: &Inner) {
    let senders: Vec<_> = inner
        .rooms
        .lock()
        .expect("tournament rooms")
        .values()
        .map(|room| room.sender.clone())
        .collect();
    for sender in senders {
        let _ = sender.send(Delivery::Resync);
    }
}

fn dispatch(inner: &Inner, channel: &str, payload: String) {
    if payload.len() > MAX_MESSAGE_BYTES {
        return;
    }
    let Ok(update) = serde_json::from_str::<TournamentUpdate>(&payload) else {
        return;
    };
    if tournament_channel(update.tournament_id) != channel {
        return;
    }
    let sender = inner
        .rooms
        .lock()
        .expect("tournament rooms")
        .get(&update.tournament_id)
        .map(|room| room.sender.clone());
    if let Some(sender) = sender {
        let _ = sender.send(Delivery::Update(Arc::new(payload)));
    }
}

async fn subscribe_loop(client: redis::Client, mut pubsub: redis::aio::PubSub, weak: Weak<Inner>) {
    let mut retry = Duration::from_millis(250);
    loop {
        let mut messages = pubsub.on_message();
        while let Some(message) = messages.next().await {
            let Some(inner) = weak.upgrade() else {
                return;
            };
            if let (Ok(channel), Ok(payload)) = (
                message.get_channel::<String>(),
                message.get_payload::<String>(),
            ) {
                dispatch(&inner, &channel, payload);
            }
        }
        drop(messages);
        let Some(inner) = weak.upgrade() else {
            return;
        };
        inner.ready.store(false, Ordering::Release);
        resync_all(&inner);
        drop(inner);
        tracing::warn!("Tournament Redis subscriber disconnected; retrying");

        loop {
            tokio::time::sleep(retry).await;
            if weak.strong_count() == 0 {
                return;
            }
            let attempt = async {
                let mut connection = client.get_async_pubsub().await?;
                connection.psubscribe(CHANNEL_PATTERN).await?;
                Ok::<_, redis::RedisError>(connection)
            };
            if let Ok(Ok(connection)) = tokio::time::timeout(REDIS_DEADLINE, attempt).await {
                pubsub = connection;
                retry = Duration::from_millis(250);
                if let Some(inner) = weak.upgrade() {
                    inner.ready.store(true, Ordering::Release);
                    resync_all(&inner);
                } else {
                    return;
                }
                break;
            }
            retry = (retry * 2).min(Duration::from_secs(5));
        }
    }
}

/// Owned connection guard. Dropping an HTTP body releases its slot and removes
/// an empty tournament room immediately, including aborted/slow clients.
pub struct Subscription {
    receiver: broadcast::Receiver<Delivery>,
    inner: Arc<Inner>,
    tournament_id: Uuid,
    _permit: OwnedSemaphorePermit,
    initial: bool,
}

impl Subscription {
    pub async fn recv(&mut self) -> Option<Delivery> {
        if std::mem::replace(&mut self.initial, false) {
            return Some(Delivery::Resync);
        }
        match self.receiver.recv().await {
            Ok(delivery) => Some(delivery),
            Err(broadcast::error::RecvError::Lagged(_)) => Some(Delivery::Resync),
            Err(broadcast::error::RecvError::Closed) => None,
        }
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        let mut rooms = self.inner.rooms.lock().expect("tournament rooms");
        if let Some(room) = rooms.get_mut(&self.tournament_id) {
            room.clients -= 1;
            if room.clients == 0 {
                rooms.remove(&self.tournament_id);
            }
        }
    }
}

pub fn sse_response(subscription: Subscription) -> HttpResponse {
    let heartbeat = tokio::time::interval_at(tokio::time::Instant::now() + HEARTBEAT, HEARTBEAT);
    let body = stream::unfold(
        (subscription, heartbeat),
        |(mut subscription, mut heartbeat)| async move {
            let frame = tokio::select! {
                delivery = subscription.recv() => delivery.map(|event| event.sse_frame()),
                _ = heartbeat.tick() => Some(": keep-alive\n\n".to_owned()),
            };
            frame.map(|frame| {
                (
                    Ok::<_, Error>(Bytes::from(frame)),
                    (subscription, heartbeat),
                )
            })
        },
    );
    HttpResponse::Ok()
        .insert_header(("Content-Type", "text/event-stream"))
        .insert_header(("Cache-Control", "no-cache, no-transform"))
        .insert_header(("X-Accel-Buffering", "no"))
        .streaming(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_use_distinct_tournament_channels() {
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        assert_ne!(tournament_channel(first), tournament_channel(second));
        assert_eq!(tournament_channel(first), format!("tournament:{first}"));
    }

    #[test]
    fn event_payload_cannot_inject_an_sse_frame() {
        let event = TournamentUpdate::new(
            Uuid::new_v4(),
            UpdateKind::StatusChanged,
            serde_json::json!({"status": "completed\n\nevent: forged"}),
        );
        let payload = serde_json::to_string(&event).unwrap();
        let frame = Delivery::Update(Arc::new(payload)).sse_frame();
        assert_eq!(frame.lines().count(), 3);
        assert!(!frame.contains("\nevent: forged"));
        assert!(frame.contains("\"kind\":\"status_changed\""));
    }

    #[tokio::test]
    async fn zero_capacity_is_rejected_before_connecting() {
        let result = TournamentHub::connect(
            "redis://127.0.0.1:1",
            Limits {
                max_clients: 0,
                ..Limits::default()
            },
        )
        .await;
        assert!(matches!(result, Err(HubError::InvalidLimits)));
    }

    #[tokio::test]
    async fn oversized_limits_return_an_error_instead_of_panicking() {
        for limits in [
            Limits {
                max_clients: Semaphore::MAX_PERMITS + 1,
                ..Limits::default()
            },
            Limits {
                buffer_capacity: usize::MAX,
                ..Limits::default()
            },
        ] {
            let result = TournamentHub::connect("redis://127.0.0.1:1", limits).await;
            assert!(matches!(result, Err(HubError::InvalidLimits)));
        }
    }
}
