use crate::realtime::events::{channels, DeliverEvent, RealtimeEvent};
use crate::realtime::session_registry::SessionRegistry;
use crate::realtime::user_ws::UserWebSocket;
use actix::Addr;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Maps session_id to the Actix actor address for WebSocket message delivery.
///
/// Separate from SessionRegistry because it holds `Addr<UserWebSocket>` which
/// is Actix-specific, while SessionRegistry only tracks user→session mappings.
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

/// Subscribes to Redis Pub/Sub patterns and delivers events to connected
/// WebSocket actors via the WsAddressBook.
pub struct WsBroadcaster {
    redis_url: String,
    registry: Arc<SessionRegistry>,
    address_book: Arc<WsAddressBook>,
}

impl WsBroadcaster {
    pub fn new(
        redis_url: String,
        registry: Arc<SessionRegistry>,
        address_book: Arc<WsAddressBook>,
    ) -> Self {
        Self {
            redis_url,
            registry,
            address_book,
        }
    }

    /// Start listening to Redis Pub/Sub in background tasks.
    pub fn start(self) -> Vec<JoinHandle<()>> {
        let mut handles = Vec::new();

        // Spawn user channel subscriber
        let redis_url = self.redis_url.clone();
        let registry = self.registry.clone();
        let address_book = self.address_book.clone();
        handles.push(tokio::spawn(async move {
            Self::subscribe_loop(
                &redis_url,
                channels::USER_CHANNEL_PATTERN,
                &registry,
                &address_book,
                Self::route_user_event,
            )
            .await;
        }));

        // Spawn match channel subscriber (for future spectator features)
        let redis_url = self.redis_url.clone();
        let registry = self.registry.clone();
        let address_book = self.address_book.clone();
        handles.push(tokio::spawn(async move {
            Self::subscribe_loop(
                &redis_url,
                channels::MATCH_CHANNEL_PATTERN,
                &registry,
                &address_book,
                Self::route_match_event,
            )
            .await;
        }));

        info!("WsBroadcaster started — listening to Redis Pub/Sub");
        handles
    }

    async fn subscribe_loop(
        redis_url: &str,
        pattern: &str,
        registry: &Arc<SessionRegistry>,
        address_book: &Arc<WsAddressBook>,
        route_fn: fn(&str, &RealtimeEvent, &Arc<SessionRegistry>, &Arc<WsAddressBook>),
    ) {
        // Create a dedicated Redis connection for pub/sub
        let client = match redis::Client::open(redis_url) {
            Ok(c) => c,
            Err(e) => {
                error!(error = %e, "Failed to create Redis client for Pub/Sub");
                return;
            }
        };

        let mut pubsub = match client.get_async_pubsub().await {
            Ok(ps) => ps,
            Err(e) => {
                error!(pattern = %pattern, error = %e, "Failed to connect Redis Pub/Sub");
                return;
            }
        };

        if let Err(e) = pubsub.psubscribe(pattern).await {
            error!(pattern = %pattern, error = %e, "Failed to psubscribe");
            return;
        }

        info!(pattern = %pattern, "Subscribed to Redis Pub/Sub pattern");

        use futures_util::StreamExt;
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
                Ok(event) => route_fn(&channel, &event, registry, address_book),
                Err(e) => {
                    warn!(channel = %channel, error = %e, "Failed to deserialize Pub/Sub message");
                }
            }
        }
    }

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
                addr.do_send(DeliverEvent(event.clone()));
            }
        }
        debug!(user_id = %user_id, "Routed event to user sessions");
    }

    fn route_match_event(
        channel: &str,
        event: &RealtimeEvent,
        registry: &Arc<SessionRegistry>,
        address_book: &Arc<WsAddressBook>,
    ) {
        // Channel format: "match:<uuid>"
        let subscribers = registry.get_subscribers(channel);
        
        for session_id in subscribers {
            if let Some(addr) = address_book.get(&session_id) {
                addr.do_send(DeliverEvent(event.clone()));
            }
        }
        
        debug!(channel = %channel, subscriber_count = %registry.get_subscribers(channel).len(), "Routed event to match subscribers");
    }
}
