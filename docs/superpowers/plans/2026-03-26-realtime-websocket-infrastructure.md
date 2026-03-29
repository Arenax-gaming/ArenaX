# Real-Time WebSocket Infrastructure & Redis Pub/Sub Bridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a scalable real-time event system that bridges Redis Pub/Sub to WebSocket clients, delivering match updates, balance changes, and notifications with <100ms latency.

**Architecture:** A centralized `EventBus` service publishes domain events to Redis Pub/Sub channels. A `WsBroadcaster` actor subscribes to Redis channels and routes messages to per-user WebSocket sessions. Each user connects via a single authenticated WebSocket (`/ws`) that multiplexes all event types. The existing `MatchWebSocket` actor is replaced by a generic `UserWebSocket` actor that joins user-specific rooms. Horizontal scaling is achieved through Redis Pub/Sub — every server instance subscribes and broadcasts to its local connections.

**Tech Stack:** Rust, Actix-web 4 + actix-web-actors, Redis 0.27 (tokio-comp, connection-manager), existing JWT auth (`JwtService`), SQLx/PostgreSQL.

**Key Design Decision:** The GitHub issue mentions Socket.io, but the backend is Rust/Actix — not Node.js. We build on the existing Actix WebSocket actor infrastructure with Redis Pub/Sub for cross-instance broadcasting, which achieves the same goals natively.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `backend/src/realtime/mod.rs` | Module declarations for realtime subsystem |
| Create | `backend/src/realtime/events.rs` | Standardized event schema (BalanceUpdate, MatchFound, MatchStatusChange, etc.) |
| Create | `backend/src/realtime/event_bus.rs` | Redis Pub/Sub publisher — services call this to emit events |
| Create | `backend/src/realtime/ws_broadcaster.rs` | Redis subscriber actor that routes events to connected WebSocket sessions |
| Create | `backend/src/realtime/user_ws.rs` | Per-user WebSocket actor with JWT auth, heartbeat, room management |
| Create | `backend/src/realtime/session_registry.rs` | Thread-safe registry mapping user_id → set of WebSocket actor addresses |
| Modify | `backend/src/main.rs` | Initialize Redis, EventBus, WsBroadcaster, register `/ws` route |
| Modify | `backend/src/service/wallet_service.rs:562-583` | Replace stub `publish_balance_update` with EventBus call |
| Modify | `backend/src/service/match_service.rs:1408-1421` | Replace stub `publish_match_event` / `publish_global_event` with EventBus calls |
| Modify | `backend/src/service/mod.rs` | Re-export EventBus |
| Modify | `backend/src/http/mod.rs` | Add realtime module, remove old match_ws_handler if replaced |
| Create | `backend/tests/realtime_events_test.rs` | Unit tests for event serialization |
| Create | `backend/tests/session_registry_test.rs` | Unit tests for session registry |

---

## Task 1: Standardized Event Schema

**Files:**
- Create: `backend/src/realtime/mod.rs`
- Create: `backend/src/realtime/events.rs`
- Test: `backend/tests/realtime_events_test.rs`

- [ ] **Step 1: Create the realtime module declaration**

```rust
// backend/src/realtime/mod.rs
pub mod events;
pub mod event_bus;
pub mod ws_broadcaster;
pub mod user_ws;
pub mod session_registry;

pub use events::*;
pub use event_bus::EventBus;
pub use session_registry::SessionRegistry;
```

- [ ] **Step 2: Write the failing test for event serialization**

```rust
// backend/tests/realtime_events_test.rs
use arenax_backend::realtime::events::*;
use uuid::Uuid;

#[test]
fn test_balance_update_serialization() {
    let event = RealtimeEvent::BalanceUpdate {
        user_id: Uuid::new_v4(),
        balance_ngn: 50000,
        balance_arenax_tokens: 100,
        balance_xlm: 0,
        timestamp: "2026-03-26T12:00:00Z".to_string(),
    };
    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("\"type\":\"balance_update\""));
    let deserialized: RealtimeEvent = serde_json::from_str(&json).unwrap();
    match deserialized {
        RealtimeEvent::BalanceUpdate { balance_ngn, .. } => assert_eq!(balance_ngn, 50000),
        _ => panic!("Expected BalanceUpdate"),
    }
}

#[test]
fn test_match_found_serialization() {
    let event = RealtimeEvent::MatchFound {
        match_id: Uuid::new_v4(),
        opponent_id: Uuid::new_v4(),
        opponent_name: "Player2".to_string(),
        game_mode: "ranked".to_string(),
        timestamp: "2026-03-26T12:00:00Z".to_string(),
    };
    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("\"type\":\"match_found\""));
}

#[test]
fn test_match_status_change_serialization() {
    let event = RealtimeEvent::MatchStatusChange {
        match_id: Uuid::new_v4(),
        from_status: "CREATED".to_string(),
        to_status: "STARTED".to_string(),
        timestamp: "2026-03-26T12:00:00Z".to_string(),
    };
    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("\"type\":\"match_status_change\""));
    assert!(json.contains("CREATED"));
    assert!(json.contains("STARTED"));
}

#[test]
fn test_notification_serialization() {
    let event = RealtimeEvent::Notification {
        id: Uuid::new_v4(),
        title: "Match Complete".to_string(),
        body: "You won!".to_string(),
        category: "match".to_string(),
        timestamp: "2026-03-26T12:00:00Z".to_string(),
    };
    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("\"type\":\"notification\""));
}

#[test]
fn test_ws_envelope_serialization() {
    let envelope = WsEnvelope {
        event: RealtimeEvent::MatchStatusChange {
            match_id: Uuid::new_v4(),
            from_status: "STARTED".to_string(),
            to_status: "COMPLETED".to_string(),
            timestamp: "2026-03-26T12:00:00Z".to_string(),
        },
    };
    let json = serde_json::to_string(&envelope).unwrap();
    assert!(json.contains("\"event\""));
    assert!(json.contains("match_status_change"));
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && cargo test --test realtime_events_test 2>&1 | head -20`
Expected: Compilation error — `realtime` module does not exist yet.

- [ ] **Step 4: Register the realtime module in main crate**

Add to `backend/src/main.rs` after the existing `mod` declarations (after line 12):

```rust
pub mod realtime;
```

- [ ] **Step 5: Write the event schema implementation**

```rust
// backend/src/realtime/events.rs
use actix::Message;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// All real-time events that can be sent to clients.
/// Tagged with `type` field for client-side routing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RealtimeEvent {
    /// User's wallet balance changed
    BalanceUpdate {
        user_id: Uuid,
        balance_ngn: i64,
        balance_arenax_tokens: i64,
        balance_xlm: i64,
        timestamp: String,
    },
    /// A match was found for the user (matchmaking complete)
    MatchFound {
        match_id: Uuid,
        opponent_id: Uuid,
        opponent_name: String,
        game_mode: String,
        timestamp: String,
    },
    /// Match state transition
    MatchStatusChange {
        match_id: Uuid,
        from_status: String,
        to_status: String,
        timestamp: String,
    },
    /// Generic notification
    Notification {
        id: Uuid,
        title: String,
        body: String,
        category: String,
        timestamp: String,
    },
    /// Match completed with results
    MatchCompleted {
        match_id: Uuid,
        winner_id: Uuid,
        elo_change: i32,
        timestamp: String,
    },
    /// Match disputed
    MatchDisputed {
        match_id: Uuid,
        reason: String,
        timestamp: String,
    },
}

/// Envelope wrapping events for WebSocket transport
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsEnvelope {
    pub event: RealtimeEvent,
}

/// Client-to-server WebSocket messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Client ping for keepalive
    Ping,
    /// Client pong response
    Pong,
}

/// Actix message for delivering events to a UserWebSocket actor
#[derive(Message, Clone, Debug)]
#[rtype(result = "()")]
pub struct DeliverEvent {
    pub event: RealtimeEvent,
}

/// Redis Pub/Sub channel names
pub mod channels {
    use uuid::Uuid;

    /// Channel for a specific user's events (balance, notifications, match found)
    pub fn user_channel(user_id: Uuid) -> String {
        format!("user:{}", user_id)
    }

    /// Channel for a specific match's events (status changes)
    pub fn match_channel(match_id: Uuid) -> String {
        format!("match:{}", match_id)
    }

    /// Channel pattern to subscribe to all user channels
    pub const USER_CHANNEL_PATTERN: &str = "user:*";

    /// Channel pattern to subscribe to all match channels
    pub const MATCH_CHANNEL_PATTERN: &str = "match:*";
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && cargo test --test realtime_events_test 2>&1`
Expected: All 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/realtime/mod.rs backend/src/realtime/events.rs backend/tests/realtime_events_test.rs backend/src/main.rs
git commit -m "feat(realtime): add standardized event schema with serialization tests"
```

---

## Task 2: Session Registry (User→WebSocket Address Mapping)

**Files:**
- Create: `backend/src/realtime/session_registry.rs`
- Test: `backend/tests/session_registry_test.rs`

- [ ] **Step 1: Write the failing test for session registry**

```rust
// backend/tests/session_registry_test.rs
use arenax_backend::realtime::session_registry::SessionRegistry;
use uuid::Uuid;

#[test]
fn test_register_and_get_sessions() {
    let registry = SessionRegistry::new();
    let user_id = Uuid::new_v4();

    // Initially empty
    assert!(registry.get_sessions(&user_id).is_empty());

    // Register returns true for new session
    let session_id = Uuid::new_v4();
    assert!(registry.register(user_id, session_id));

    // Now has one session
    assert_eq!(registry.get_sessions(&user_id).len(), 1);

    // Duplicate returns false
    assert!(!registry.register(user_id, session_id));
}

#[test]
fn test_unregister_session() {
    let registry = SessionRegistry::new();
    let user_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    registry.register(user_id, session_id);
    assert_eq!(registry.get_sessions(&user_id).len(), 1);

    registry.unregister(user_id, session_id);
    assert!(registry.get_sessions(&user_id).is_empty());
}

#[test]
fn test_multiple_sessions_per_user() {
    let registry = SessionRegistry::new();
    let user_id = Uuid::new_v4();
    let s1 = Uuid::new_v4();
    let s2 = Uuid::new_v4();

    registry.register(user_id, s1);
    registry.register(user_id, s2);
    assert_eq!(registry.get_sessions(&user_id).len(), 2);

    // Remove one, other remains
    registry.unregister(user_id, s1);
    assert_eq!(registry.get_sessions(&user_id).len(), 1);
    assert!(registry.get_sessions(&user_id).contains(&s2));
}

#[test]
fn test_user_count() {
    let registry = SessionRegistry::new();
    let u1 = Uuid::new_v4();
    let u2 = Uuid::new_v4();

    registry.register(u1, Uuid::new_v4());
    registry.register(u2, Uuid::new_v4());

    assert_eq!(registry.connected_user_count(), 2);
}

#[test]
fn test_has_user() {
    let registry = SessionRegistry::new();
    let user_id = Uuid::new_v4();

    assert!(!registry.has_user(&user_id));
    registry.register(user_id, Uuid::new_v4());
    assert!(registry.has_user(&user_id));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && cargo test --test session_registry_test 2>&1 | head -10`
Expected: Compilation error — `session_registry` module is empty.

- [ ] **Step 3: Implement the session registry**

```rust
// backend/src/realtime/session_registry.rs
use std::collections::{HashMap, HashSet};
use std::sync::RwLock;
use uuid::Uuid;

/// Thread-safe registry mapping user IDs to their active WebSocket session IDs.
/// Used by the WsBroadcaster to find which sessions to deliver events to.
pub struct SessionRegistry {
    /// user_id → set of session_ids
    inner: RwLock<HashMap<Uuid, HashSet<Uuid>>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
        }
    }

    /// Register a new session for a user. Returns true if the session was newly added.
    pub fn register(&self, user_id: Uuid, session_id: Uuid) -> bool {
        let mut map = self.inner.write().unwrap();
        map.entry(user_id).or_default().insert(session_id)
    }

    /// Remove a session for a user.
    pub fn unregister(&self, user_id: Uuid, session_id: Uuid) {
        let mut map = self.inner.write().unwrap();
        if let Some(sessions) = map.get_mut(&user_id) {
            sessions.remove(&session_id);
            if sessions.is_empty() {
                map.remove(&user_id);
            }
        }
    }

    /// Get all session IDs for a user.
    pub fn get_sessions(&self, user_id: &Uuid) -> Vec<Uuid> {
        let map = self.inner.read().unwrap();
        map.get(user_id)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Check if a user has any active sessions.
    pub fn has_user(&self, user_id: &Uuid) -> bool {
        let map = self.inner.read().unwrap();
        map.get(user_id).map_or(false, |s| !s.is_empty())
    }

    /// Number of distinct connected users.
    pub fn connected_user_count(&self) -> usize {
        let map = self.inner.read().unwrap();
        map.len()
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && cargo test --test session_registry_test 2>&1`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/realtime/session_registry.rs backend/tests/session_registry_test.rs
git commit -m "feat(realtime): add thread-safe session registry for user-to-ws mapping"
```

---

## Task 3: EventBus (Redis Pub/Sub Publisher)

**Files:**
- Create: `backend/src/realtime/event_bus.rs`

- [ ] **Step 1: Implement the EventBus**

```rust
// backend/src/realtime/event_bus.rs
use crate::realtime::events::{channels, RealtimeEvent};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use tracing::{error, debug};
use uuid::Uuid;

/// Publishes domain events to Redis Pub/Sub channels.
/// Services inject this to emit real-time events.
#[derive(Clone)]
pub struct EventBus {
    redis: ConnectionManager,
}

impl EventBus {
    pub fn new(redis: ConnectionManager) -> Self {
        Self { redis }
    }

    /// Publish an event to a specific user's channel.
    pub async fn publish_to_user(&self, user_id: Uuid, event: &RealtimeEvent) {
        let channel = channels::user_channel(user_id);
        self.publish(&channel, event).await;
    }

    /// Publish an event to a specific match's channel.
    pub async fn publish_to_match(&self, match_id: Uuid, event: &RealtimeEvent) {
        let channel = channels::match_channel(match_id);
        self.publish(&channel, event).await;
    }

    /// Publish a serialized event to a Redis Pub/Sub channel.
    async fn publish(&self, channel: &str, event: &RealtimeEvent) {
        let payload = match serde_json::to_string(event) {
            Ok(json) => json,
            Err(e) => {
                error!(error = %e, "Failed to serialize event for Redis publish");
                return;
            }
        };

        let mut conn = self.redis.clone();
        if let Err(e) = conn.publish::<_, _, ()>(channel, &payload).await {
            error!(channel = %channel, error = %e, "Failed to publish event to Redis");
        } else {
            debug!(channel = %channel, "Event published to Redis");
        }
    }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd backend && cargo check 2>&1 | tail -5`
Expected: Compiles successfully (EventBus has no complex dependencies beyond Redis ConnectionManager).

- [ ] **Step 3: Commit**

```bash
git add backend/src/realtime/event_bus.rs
git commit -m "feat(realtime): add EventBus for publishing events to Redis Pub/Sub"
```

---

## Task 4: UserWebSocket Actor (Authenticated Per-User WebSocket)

**Files:**
- Create: `backend/src/realtime/user_ws.rs`

This replaces the existing `match_ws_handler.rs` single-match WebSocket with a per-user multiplexed WebSocket.

- [ ] **Step 1: Implement the UserWebSocket actor**

```rust
// backend/src/realtime/user_ws.rs
use crate::auth::jwt_service::{Claims, JwtService};
use crate::realtime::events::{ClientMessage, DeliverEvent, RealtimeEvent, WsEnvelope};
use crate::realtime::session_registry::SessionRegistry;
use actix::{Actor, ActorContext, AsyncContext, Handler, StreamHandler};
use actix_web::{web, Error, HttpRequest, HttpResponse};
use actix_web_actors::ws;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
const CLIENT_TIMEOUT: Duration = Duration::from_secs(10);

/// Per-user WebSocket actor. Authenticated via JWT token passed as
/// query parameter `?token=<jwt>` on the upgrade request.
pub struct UserWebSocket {
    session_id: Uuid,
    user_id: Uuid,
    hb: Instant,
    registry: Arc<SessionRegistry>,
}

impl UserWebSocket {
    pub fn new(user_id: Uuid, registry: Arc<SessionRegistry>) -> Self {
        Self {
            session_id: Uuid::new_v4(),
            user_id,
            hb: Instant::now(),
            registry,
        }
    }

    fn start_heartbeat(&self, ctx: &mut ws::WebsocketContext<Self>) {
        ctx.run_interval(HEARTBEAT_INTERVAL, |act, ctx| {
            if Instant::now().duration_since(act.hb) > CLIENT_TIMEOUT {
                warn!(
                    session_id = %act.session_id,
                    user_id = %act.user_id,
                    "WebSocket heartbeat timeout, disconnecting"
                );
                ctx.stop();
                return;
            }
            ctx.ping(b"");
        });
    }
}

impl Actor for UserWebSocket {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.start_heartbeat(ctx);
        self.registry.register(self.user_id, self.session_id);
        info!(
            session_id = %self.session_id,
            user_id = %self.user_id,
            "WebSocket connection established"
        );
    }

    fn stopped(&mut self, _ctx: &mut Self::Context) {
        self.registry.unregister(self.user_id, self.session_id);
        info!(
            session_id = %self.session_id,
            user_id = %self.user_id,
            "WebSocket connection closed"
        );
    }
}

/// Handle incoming WebSocket frames
impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for UserWebSocket {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match msg {
            Ok(ws::Message::Ping(data)) => {
                self.hb = Instant::now();
                ctx.pong(&data);
            }
            Ok(ws::Message::Pong(_)) => {
                self.hb = Instant::now();
            }
            Ok(ws::Message::Text(text)) => {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Ping) => {
                        let pong = serde_json::json!({"type": "pong"});
                        ctx.text(pong.to_string());
                    }
                    Ok(ClientMessage::Pong) => {
                        self.hb = Instant::now();
                    }
                    Err(e) => {
                        debug!(
                            session_id = %self.session_id,
                            error = %e,
                            "Ignoring unrecognized client message"
                        );
                    }
                }
            }
            Ok(ws::Message::Close(reason)) => {
                info!(
                    session_id = %self.session_id,
                    reason = ?reason,
                    "Client initiated close"
                );
                ctx.stop();
            }
            Ok(ws::Message::Binary(_)) => {
                warn!(session_id = %self.session_id, "Binary messages not supported");
            }
            _ => (),
        }
    }
}

/// Handle server-side event delivery
impl Handler<DeliverEvent> for UserWebSocket {
    type Result = ();

    fn handle(&mut self, msg: DeliverEvent, ctx: &mut Self::Context) {
        let envelope = WsEnvelope { event: msg.event };
        match serde_json::to_string(&envelope) {
            Ok(json) => ctx.text(json),
            Err(e) => error!(
                session_id = %self.session_id,
                error = %e,
                "Failed to serialize event for WebSocket delivery"
            ),
        }
    }
}

/// WebSocket upgrade handler.
/// Authenticates via `?token=<jwt>` query parameter.
pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    jwt_service: web::Data<Arc<JwtService>>,
    registry: web::Data<Arc<SessionRegistry>>,
) -> Result<HttpResponse, Error> {
    // Extract token from query string
    let query_string = req.query_string();
    let token = query_string
        .split('&')
        .find_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            match (parts.next(), parts.next()) {
                (Some("token"), Some(value)) => Some(value.to_string()),
                _ => None,
            }
        })
        .ok_or_else(|| {
            warn!("WebSocket connection rejected: missing token parameter");
            actix_web::error::ErrorUnauthorized("Missing token query parameter")
        })?;

    // Validate JWT
    let claims: Claims = jwt_service
        .validate_token(&token)
        .await
        .map_err(|e| {
            warn!(error = %e, "WebSocket connection rejected: invalid token");
            actix_web::error::ErrorUnauthorized(format!("Invalid token: {}", e))
        })?;

    let user_id = uuid::Uuid::parse_str(&claims.sub).map_err(|_| {
        actix_web::error::ErrorUnauthorized("Invalid user ID in token")
    })?;

    info!(user_id = %user_id, "Authenticated WebSocket upgrade");

    let ws_actor = UserWebSocket::new(user_id, registry.get_ref().clone());
    ws::start(ws_actor, &req, stream)
}

/// Configure the WebSocket route
pub fn configure_ws_route(cfg: &mut web::ServiceConfig) {
    cfg.route("/ws", web::get().to(ws_handler));
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd backend && cargo check 2>&1 | tail -5`
Expected: Compiles successfully.

- [ ] **Step 3: Commit**

```bash
git add backend/src/realtime/user_ws.rs
git commit -m "feat(realtime): add JWT-authenticated per-user WebSocket actor"
```

---

## Task 5: WsBroadcaster (Redis Subscriber → WebSocket Delivery)

**Files:**
- Create: `backend/src/realtime/ws_broadcaster.rs`

This is the bridge that listens to Redis Pub/Sub and routes events to connected WebSocket actors.

- [ ] **Step 1: Implement the WsBroadcaster**

```rust
// backend/src/realtime/ws_broadcaster.rs
use crate::realtime::events::{channels, DeliverEvent, RealtimeEvent};
use crate::realtime::session_registry::SessionRegistry;
use crate::realtime::user_ws::UserWebSocket;
use actix::Addr;
use redis::aio::ConnectionManager;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Maps session_id → actor address for message delivery.
/// Separate from SessionRegistry because actor addresses are not Send+Sync
/// across threads in the same way — this lives on the Actix runtime.
pub struct WsAddressBook {
    inner: RwLock<HashMap<Uuid, Addr<UserWebSocket>>>,
}

impl WsAddressBook {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
        }
    }

    pub fn insert(&self, session_id: Uuid, addr: Addr<UserWebSocket>) {
        self.inner.write().unwrap().insert(session_id, addr);
    }

    pub fn remove(&self, session_id: &Uuid) {
        self.inner.write().unwrap().remove(session_id);
    }

    pub fn get(&self, session_id: &Uuid) -> Option<Addr<UserWebSocket>> {
        self.inner.read().unwrap().get(session_id).cloned()
    }
}

/// Subscribes to Redis Pub/Sub channels and delivers events
/// to connected WebSocket actors via the SessionRegistry + AddressBook.
pub struct WsBroadcaster {
    redis: ConnectionManager,
    registry: Arc<SessionRegistry>,
    address_book: Arc<WsAddressBook>,
}

impl WsBroadcaster {
    pub fn new(
        redis: ConnectionManager,
        registry: Arc<SessionRegistry>,
        address_book: Arc<WsAddressBook>,
    ) -> Self {
        Self {
            redis,
            registry,
            address_book,
        }
    }

    /// Start listening to Redis Pub/Sub in background tasks.
    /// Returns join handles so the caller can manage shutdown.
    pub fn start(self) -> Vec<JoinHandle<()>> {
        let mut handles = Vec::new();

        // Spawn user channel subscriber
        let registry = self.registry.clone();
        let address_book = self.address_book.clone();
        let redis = self.redis.clone();
        handles.push(tokio::spawn(async move {
            Self::subscribe_pattern(
                redis,
                channels::USER_CHANNEL_PATTERN,
                registry,
                address_book,
                Self::route_user_event,
            )
            .await;
        }));

        // Spawn match channel subscriber
        let registry = self.registry.clone();
        let address_book = self.address_book.clone();
        let redis = self.redis.clone();
        handles.push(tokio::spawn(async move {
            Self::subscribe_pattern(
                redis,
                channels::MATCH_CHANNEL_PATTERN,
                registry,
                address_book,
                Self::route_match_event,
            )
            .await;
        }));

        info!("WsBroadcaster started — listening to Redis Pub/Sub");
        handles
    }

    async fn subscribe_pattern<F>(
        redis: ConnectionManager,
        pattern: &str,
        registry: Arc<SessionRegistry>,
        address_book: Arc<WsAddressBook>,
        route_fn: F,
    ) where
        F: Fn(&str, &RealtimeEvent, &Arc<SessionRegistry>, &Arc<WsAddressBook>) + Send + 'static,
    {
        // Create a new connection for pub/sub (pub/sub requires dedicated connection)
        let client = redis::Client::open(
            redis.get_connection_info().addr.to_string(),
        );

        let client = match client {
            Ok(c) => c,
            Err(e) => {
                error!(error = %e, "Failed to create Redis client for Pub/Sub");
                return;
            }
        };

        let mut pubsub = match client.get_async_pubsub().await {
            Ok(ps) => ps,
            Err(e) => {
                error!(pattern = %pattern, error = %e, "Failed to create Redis Pub/Sub connection");
                return;
            }
        };

        if let Err(e) = pubsub.psubscribe(pattern).await {
            error!(pattern = %pattern, error = %e, "Failed to subscribe to Redis pattern");
            return;
        }

        info!(pattern = %pattern, "Subscribed to Redis Pub/Sub pattern");

        use futures::StreamExt;
        let mut stream = pubsub.on_message();

        while let Some(msg) = stream.next().await {
            let channel: String = match msg.get_channel() {
                Ok(c) => c,
                Err(_) => continue,
            };
            let payload: String = match msg.get_payload() {
                Ok(p) => p,
                Err(_) => continue,
            };

            match serde_json::from_str::<RealtimeEvent>(&payload) {
                Ok(event) => {
                    route_fn(&channel, &event, &registry, &address_book);
                }
                Err(e) => {
                    warn!(
                        channel = %channel,
                        error = %e,
                        "Failed to deserialize Redis Pub/Sub message"
                    );
                }
            }
        }
    }

    /// Route a user-channel event: extract user_id from channel name,
    /// find their sessions, deliver to each.
    fn route_user_event(
        channel: &str,
        event: &RealtimeEvent,
        registry: &Arc<SessionRegistry>,
        address_book: &Arc<WsAddressBook>,
    ) {
        // Channel format: "user:<uuid>"
        let user_id_str = match channel.strip_prefix("user:") {
            Some(id) => id,
            None => return,
        };
        let user_id = match Uuid::parse_str(user_id_str) {
            Ok(id) => id,
            Err(_) => return,
        };

        let sessions = registry.get_sessions(&user_id);
        for session_id in sessions {
            if let Some(addr) = address_book.get(&session_id) {
                addr.do_send(DeliverEvent {
                    event: event.clone(),
                });
            }
        }
        debug!(user_id = %user_id, "Routed event to user sessions");
    }

    /// Route a match-channel event: deliver to all users subscribed
    /// to that match. For now, we publish match events to participant
    /// user channels from the EventBus side, so this is a fallback
    /// for global match observers.
    fn route_match_event(
        _channel: &str,
        _event: &RealtimeEvent,
        _registry: &Arc<SessionRegistry>,
        _address_book: &Arc<WsAddressBook>,
    ) {
        // Match events are primarily routed via user channels.
        // This handler is reserved for future spectator/admin features.
        debug!("Match channel event received (spectator routing not yet implemented)");
    }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd backend && cargo check 2>&1 | tail -5`
Expected: Compiles. May need `futures` added to Cargo.toml — check and add if missing.

- [ ] **Step 3: Add `futures` dependency if needed**

Check if `futures` is already in Cargo.toml. If not, add:

```toml
futures = "0.3"
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/realtime/ws_broadcaster.rs backend/Cargo.toml
git commit -m "feat(realtime): add WsBroadcaster Redis-to-WebSocket bridge"
```

---

## Task 6: Wire Everything in main.rs

**Files:**
- Modify: `backend/src/main.rs`

- [ ] **Step 1: Update main.rs to initialize Redis, EventBus, SessionRegistry, WsBroadcaster, and register the /ws route**

Replace the full content of `main.rs` with:

```rust
use actix_web::{web, App, HttpServer};
use std::io;
use std::sync::Arc;
use tokio::signal;

mod config;
mod db;
mod api_error;
mod telemetry;
mod middleware;
mod auth;
mod http;
mod service;
pub mod realtime;

use crate::config::Config;
use crate::db::create_pool;
use crate::telemetry::init_telemetry;
use crate::middleware::cors_middleware;
use crate::realtime::event_bus::EventBus;
use crate::realtime::session_registry::SessionRegistry;
use crate::realtime::ws_broadcaster::{WsAddressBook, WsBroadcaster};

#[tokio::main]
async fn main() -> io::Result<()> {
    // Load configuration
    let config = Config::from_env().expect("Failed to load configuration");

    // Initialize telemetry
    init_telemetry();

    // Create database pool
    let db_pool = create_pool(&config)
        .await
        .expect("Failed to create database pool");

    // Create Redis connection manager
    let redis_client = redis::Client::open(config.redis.url.clone())
        .expect("Failed to create Redis client");
    let redis_conn = redis::aio::ConnectionManager::new(redis_client.clone())
        .await
        .expect("Failed to create Redis connection manager");

    // Initialize real-time infrastructure
    let event_bus = EventBus::new(redis_conn.clone());
    let session_registry = Arc::new(SessionRegistry::new());
    let address_book = Arc::new(WsAddressBook::new());

    // Start Redis Pub/Sub subscriber (broadcasts to local WebSocket actors)
    let broadcaster = WsBroadcaster::new(
        redis_conn.clone(),
        session_registry.clone(),
        address_book.clone(),
    );
    let _broadcaster_handles = broadcaster.start();

    tracing::info!("Starting ArenaX backend server on {}:{}", config.server.host, config.server.port);

    let server = HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(db_pool.clone()))
            .app_data(web::Data::new(event_bus.clone()))
            .app_data(web::Data::new(session_registry.clone()))
            .app_data(web::Data::new(address_book.clone()))
            .wrap(cors_middleware())
            .wrap(actix_web::middleware::Logger::default())
            .service(
                web::scope("/api")
                    .route("/health", web::get().to(crate::http::health::health_check))
            )
            .configure(crate::realtime::user_ws::configure_ws_route)
    })
    .bind((config.server.host.clone(), config.server.port))?
    .run();

    // Graceful shutdown
    let server_handle = server.handle();
    tokio::spawn(async move {
        signal::ctrl_c().await.expect("Failed to listen for shutdown signal");
        tracing::info!("Shutdown signal received, stopping server...");
        server_handle.stop(true).await;
    });

    server.await
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd backend && cargo check 2>&1 | tail -10`
Expected: Compiles. Fix any import issues.

- [ ] **Step 3: Commit**

```bash
git add backend/src/main.rs
git commit -m "feat(realtime): wire Redis, EventBus, SessionRegistry, and /ws route in main.rs"
```

---

## Task 7: Connect WalletService to EventBus

**Files:**
- Modify: `backend/src/service/wallet_service.rs`

- [ ] **Step 1: Update WalletService to use EventBus instead of raw Redis**

Replace the `WalletService` struct definition and `new` constructor (lines 34-46) with:

```rust
#[derive(Clone)]
pub struct WalletService {
    db_pool: DbPool,
    event_bus: Option<crate::realtime::event_bus::EventBus>,
}

impl WalletService {
    pub fn new(db_pool: DbPool, event_bus: Option<crate::realtime::event_bus::EventBus>) -> Self {
        Self {
            db_pool,
            event_bus,
        }
    }
```

- [ ] **Step 2: Replace the `publish_balance_update` method (lines 562-583) with EventBus-based publishing**

```rust
    async fn publish_balance_update(&self, user_id: Uuid) {
        if let Some(ref event_bus) = self.event_bus {
            // Fetch current balances to include in the event
            match self.get_wallet(user_id).await {
                Ok(wallet) => {
                    let event = crate::realtime::events::RealtimeEvent::BalanceUpdate {
                        user_id,
                        balance_ngn: wallet.balance_ngn.unwrap_or(0),
                        balance_arenax_tokens: wallet.balance_arenax_tokens.unwrap_or(0),
                        balance_xlm: wallet.balance_xlm.unwrap_or(0),
                        timestamp: chrono::Utc::now().to_rfc3339(),
                    };
                    event_bus.publish_to_user(user_id, &event).await;
                }
                Err(e) => {
                    tracing::error!(
                        user_id = %user_id,
                        error = %e,
                        "Failed to fetch wallet for balance update event"
                    );
                }
            }
        }
    }
```

- [ ] **Step 3: Remove the `redis::Client` import and `redis_client` field references**

Remove `use redis::Client as RedisClient;` from the imports (line 7). The `RedisError` variant in `WalletError` can remain for future use.

- [ ] **Step 4: Verify compilation**

Run: `cd backend && cargo check 2>&1 | tail -10`
Expected: Compiles. Callers of `WalletService::new()` may need updating if they pass a redis client — check and fix.

- [ ] **Step 5: Commit**

```bash
git add backend/src/service/wallet_service.rs
git commit -m "feat(realtime): connect WalletService balance updates to EventBus"
```

---

## Task 8: Connect MatchService to EventBus

**Files:**
- Modify: `backend/src/service/match_service.rs`

- [ ] **Step 1: Add EventBus to MatchService struct**

Update the `MatchService` struct and constructor to accept an optional `EventBus`:

```rust
pub struct MatchService {
    db_pool: DbPool,
    event_bus: Option<crate::realtime::event_bus::EventBus>,
}

impl MatchService {
    pub fn new(db_pool: DbPool) -> Self {
        Self {
            db_pool,
            event_bus: None,
        }
    }

    pub fn with_event_bus(mut self, event_bus: crate::realtime::event_bus::EventBus) -> Self {
        self.event_bus = Some(event_bus);
        self
    }
```

- [ ] **Step 2: Replace the `publish_match_event` and `publish_global_event` stubs (lines 1408-1421)**

```rust
impl MatchService {
    async fn publish_match_event(&self, event_data: serde_json::Value) -> Result<(), ApiError> {
        if let Some(ref event_bus) = self.event_bus {
            // Extract match_id and relevant user IDs from event data
            if let (Some(match_id_str), Some(event_type)) = (
                event_data.get("match_id").and_then(|v| v.as_str()),
                event_data.get("event").and_then(|v| v.as_str()),
            ) {
                let match_id = Uuid::parse_str(match_id_str).unwrap_or_default();
                let timestamp = chrono::Utc::now().to_rfc3339();

                let event = crate::realtime::events::RealtimeEvent::MatchStatusChange {
                    match_id,
                    from_status: event_data
                        .get("from_status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    to_status: event_type.to_string(),
                    timestamp,
                };

                // Publish to match channel
                event_bus.publish_to_match(match_id, &event).await;

                // Also publish to participant user channels
                for key in ["player1_id", "player2_id", "user_id"] {
                    if let Some(uid_str) = event_data.get(key).and_then(|v| v.as_str()) {
                        if let Ok(uid) = Uuid::parse_str(uid_str) {
                            event_bus.publish_to_user(uid, &event).await;
                        }
                    }
                }
            }
        }
        Ok(())
    }

    async fn publish_global_event(&self, _event_data: serde_json::Value) -> Result<(), ApiError> {
        // Global events (e.g., tournament announcements) would be published
        // to a global channel. For now, this is a no-op until we add
        // a global subscription mechanism.
        Ok(())
    }
}
```

- [ ] **Step 3: Remove the old `with_redis` method and `redis_client` field**

Remove the `redis_client` field and the `with_redis` method, replacing with the `event_bus` field added in Step 1. Remove `use redis::Client as RedisClient;` from imports.

- [ ] **Step 4: Verify compilation**

Run: `cd backend && cargo check 2>&1 | tail -10`
Expected: Compiles.

- [ ] **Step 5: Commit**

```bash
git add backend/src/service/match_service.rs
git commit -m "feat(realtime): connect MatchService event publishing to EventBus"
```

---

## Task 9: Update Module Exports and Clean Up Old WebSocket Handler

**Files:**
- Modify: `backend/src/http/mod.rs`
- Modify: `backend/src/service/mod.rs`

- [ ] **Step 1: Update http/mod.rs — keep match_ws_handler for backwards compatibility but mark deprecated**

```rust
// backend/src/http/mod.rs
pub mod health;
pub mod match_authority_handler;
#[deprecated(note = "Use realtime::user_ws instead for authenticated WebSocket connections")]
pub mod match_ws_handler;
```

- [ ] **Step 2: Update service/mod.rs to re-export EventBus**

Add after the existing `pub use` lines:

```rust
pub use crate::realtime::event_bus::EventBus;
```

- [ ] **Step 3: Verify full compilation and existing tests still pass**

Run: `cd backend && cargo test 2>&1 | tail -20`
Expected: All existing tests pass, plus the new realtime tests.

- [ ] **Step 4: Commit**

```bash
git add backend/src/http/mod.rs backend/src/service/mod.rs
git commit -m "feat(realtime): update module exports, deprecate old WS handler"
```

---

## Task 10: Integration Smoke Test

**Files:**
- Create: `backend/tests/realtime_integration_test.rs`

- [ ] **Step 1: Write a basic integration test that verifies the event pipeline compiles and serializes correctly end-to-end**

```rust
// backend/tests/realtime_integration_test.rs
use arenax_backend::realtime::events::*;
use uuid::Uuid;

#[test]
fn test_event_pipeline_serialization_roundtrip() {
    // Simulate what EventBus does: serialize event to JSON
    let user_id = Uuid::new_v4();
    let event = RealtimeEvent::BalanceUpdate {
        user_id,
        balance_ngn: 100000,
        balance_arenax_tokens: 500,
        balance_xlm: 1000000,
        timestamp: "2026-03-26T12:00:00Z".to_string(),
    };

    // EventBus serializes
    let payload = serde_json::to_string(&event).unwrap();

    // WsBroadcaster deserializes
    let received: RealtimeEvent = serde_json::from_str(&payload).unwrap();

    // UserWebSocket wraps in envelope and sends
    let envelope = WsEnvelope { event: received };
    let ws_payload = serde_json::to_string(&envelope).unwrap();

    // Client receives and can parse
    let parsed: serde_json::Value = serde_json::from_str(&ws_payload).unwrap();
    assert_eq!(parsed["event"]["type"], "balance_update");
    assert_eq!(parsed["event"]["user_id"], user_id.to_string());
    assert_eq!(parsed["event"]["balance_ngn"], 100000);
}

#[test]
fn test_channel_naming() {
    let user_id = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    let match_id = Uuid::parse_str("660e8400-e29b-41d4-a716-446655440000").unwrap();

    assert_eq!(
        channels::user_channel(user_id),
        "user:550e8400-e29b-41d4-a716-446655440000"
    );
    assert_eq!(
        channels::match_channel(match_id),
        "match:660e8400-e29b-41d4-a716-446655440000"
    );
}

#[test]
fn test_all_event_types_serializable() {
    let events = vec![
        RealtimeEvent::BalanceUpdate {
            user_id: Uuid::new_v4(),
            balance_ngn: 0,
            balance_arenax_tokens: 0,
            balance_xlm: 0,
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        },
        RealtimeEvent::MatchFound {
            match_id: Uuid::new_v4(),
            opponent_id: Uuid::new_v4(),
            opponent_name: "TestPlayer".to_string(),
            game_mode: "casual".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        },
        RealtimeEvent::MatchStatusChange {
            match_id: Uuid::new_v4(),
            from_status: "CREATED".to_string(),
            to_status: "STARTED".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        },
        RealtimeEvent::Notification {
            id: Uuid::new_v4(),
            title: "Test".to_string(),
            body: "Body".to_string(),
            category: "system".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        },
        RealtimeEvent::MatchCompleted {
            match_id: Uuid::new_v4(),
            winner_id: Uuid::new_v4(),
            elo_change: 25,
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        },
        RealtimeEvent::MatchDisputed {
            match_id: Uuid::new_v4(),
            reason: "Cheating".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        },
    ];

    for event in events {
        let json = serde_json::to_string(&event).unwrap();
        let _roundtrip: RealtimeEvent = serde_json::from_str(&json).unwrap();
    }
}
```

- [ ] **Step 2: Run all tests**

Run: `cd backend && cargo test 2>&1`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/realtime_integration_test.rs
git commit -m "test(realtime): add integration smoke tests for event pipeline"
```

---

## Summary of Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ WalletService│     │ MatchService │     │TournamentSvc │
│              │     │              │     │              │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                     ┌──────▼──────┐
                     │  EventBus   │  (Redis PUBLISH)
                     └──────┬──────┘
                            │
                     ┌──────▼──────┐
                     │ Redis PubSub│  (channel: user:<id>, match:<id>)
                     └──────┬──────┘
                            │
                     ┌──────▼──────────┐
                     │ WsBroadcaster   │  (Redis PSUBSCRIBE → route)
                     │                 │
                     │ SessionRegistry │  (user_id → session_ids)
                     │ WsAddressBook   │  (session_id → Addr<UserWS>)
                     └──────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
        ┌─────▼────┐ ┌─────▼────┐ ┌─────▼────┐
        │UserWS #1 │ │UserWS #2 │ │UserWS #3 │
        │(user A)  │ │(user A)  │ │(user B)  │
        └──────────┘ └──────────┘ └──────────┘
```

**Horizontal Scaling:** Each server instance runs its own WsBroadcaster + set of UserWebSocket actors. Redis Pub/Sub ensures events published on any instance are received by all instances. Each instance only delivers to its locally connected clients.

**Auth Security:** WebSocket connections require a valid JWT token as a query parameter. The token is validated against the same JwtService used for HTTP routes. Users can only receive events addressed to their user_id — the server controls routing, clients cannot subscribe to other users' channels.
