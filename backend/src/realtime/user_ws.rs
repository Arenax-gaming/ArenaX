use crate::auth::jwt_service::{Claims, JwtService};
use crate::realtime::auth::RealtimeAuth;
use crate::realtime::events::{channels, ClientMessage, DeliverEvent, WsEnvelope};
use crate::realtime::session_registry::SessionRegistry;
use crate::realtime::ws_broadcaster::WsAddressBook;
use actix::{Actor, ActorContext, AsyncContext, Handler, StreamHandler, ActorFutureExt};
use actix_web::{web, Error, HttpRequest, HttpResponse};
use actix_web_actors::ws;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Heartbeat interval (30 seconds).
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

/// Timeout after 3 missed heartbeats (90 seconds = 3 * 30s).
const CLIENT_TIMEOUT: Duration = Duration::from_secs(90);

/// Per-user WebSocket actor with heartbeat management, reconnect state restoration,
/// connection limit enforcement, and event delivery.
pub struct UserWebSocket {
    session_id: Uuid,
    user_id: Uuid,
    claims: Claims,
    hb: Instant,
    registry: Arc<SessionRegistry>,
    /// Address book used to route inbound Redis Pub/Sub events to this actor.
    /// The actor registers itself on start and removes itself on stop so the
    /// broadcaster never holds a dangling `Addr` after disconnect.
    address_book: Arc<WsAddressBook>,
    auth: Arc<RealtimeAuth>,
    reconnect_session_id: Option<Uuid>,
}

impl UserWebSocket {
    pub fn new(
        user_id: Uuid,
        claims: Claims,
        registry: Arc<SessionRegistry>,
        address_book: Arc<WsAddressBook>,
        auth: Arc<RealtimeAuth>,
    ) -> Self {
        Self::with_reconnect(user_id, claims, registry, address_book, auth, None)
    }

    pub fn with_reconnect(
        user_id: Uuid,
        claims: Claims,
        registry: Arc<SessionRegistry>,
        address_book: Arc<WsAddressBook>,
        auth: Arc<RealtimeAuth>,
        reconnect_session_id: Option<Uuid>,
    ) -> Self {
        Self {
            session_id: Uuid::new_v4(),
            user_id,
            claims,
            hb: Instant::now(),
            registry,
            address_book,
            auth,
            reconnect_session_id,
        }
    }

    /// Starts a heartbeat that pings the client every HEARTBEAT_INTERVAL (30s)
    /// and disconnects if no response is received within CLIENT_TIMEOUT (90s = 3 missed beats).
    fn start_heartbeat(&self, ctx: &mut <Self as Actor>::Context) {
        ctx.run_interval(HEARTBEAT_INTERVAL, |act, ctx| {
            if Instant::now().duration_since(act.hb) > CLIENT_TIMEOUT {
                warn!(
                    user_id = %act.user_id,
                    session_id = %act.session_id,
                    "Client heartbeat timeout (3 missed beats), disconnecting"
                );
                ctx.stop();
                return;
            }
            ctx.ping(b"");
        });
    }

    fn send_error(&self, ctx: &mut <Self as Actor>::Context, message: &str) {
        let error_msg = serde_json::json!({
            "type": "error",
            "message": message
        });
        ctx.text(error_msg.to_string());
    }
}

impl Actor for UserWebSocket {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        info!(
            user_id = %self.user_id,
            session_id = %self.session_id,
            "WebSocket session starting"
        );

        let is_reconnected = if let Some(old_id) = self.reconnect_session_id {
            if let Some(channels) = self.registry.reconnect(self.user_id, old_id, self.session_id) {
                info!(
                    user_id = %self.user_id,
                    old_session_id = %old_id,
                    new_session_id = %self.session_id,
                    channels_count = channels.len(),
                    "WebSocket session successfully reconnected with restored channels"
                );
                true
            } else {
                warn!(
                    user_id = %self.user_id,
                    old_session_id = %old_id,
                    "Reconnect session invalid or expired, falling back to fresh registration"
                );
                if !self.registry.register(self.user_id, self.session_id) {
                    warn!(user_id = %self.user_id, "Max WebSocket connections reached (5)");
                    self.send_error(ctx, "Maximum concurrent connections (5) exceeded");
                    ctx.stop();
                    return;
                }
                false
            }
        } else {
            if !self.registry.register(self.user_id, self.session_id) {
                warn!(user_id = %self.user_id, "Max WebSocket connections reached (5)");
                self.send_error(ctx, "Maximum concurrent connections (5) exceeded");
                ctx.stop();
                return;
            }
            false
        };

        // Register this actor's address so the broadcaster can deliver events.
        self.address_book.insert(self.session_id, ctx.address());

        // Automatically subscribe to own user channel
        let user_channel = channels::user_channel(self.user_id);
        self.registry.subscribe(self.session_id, user_channel);

        if is_reconnected {
            let reconnected_msg = serde_json::json!({
                "type": "reconnected",
                "session_id": self.session_id.to_string()
            });
            ctx.text(reconnected_msg.to_string());
        }

        self.start_heartbeat(ctx);
    }

    fn stopped(&mut self, _ctx: &mut Self::Context) {
        info!(
            user_id = %self.user_id,
            session_id = %self.session_id,
            "WebSocket session stopped"
        );
        // Remove from the address book first so the broadcaster stops routing
        // events to this actor address immediately.
        self.address_book.remove(&self.session_id);

        // Unregister from the session registry, which preserves channels for 60s
        // in case the client reconnects.
        self.registry.unregister(self.user_id, self.session_id);
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for UserWebSocket {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        let msg = match msg {
            Ok(msg) => msg,
            Err(e) => {
                error!(
                    user_id = %self.user_id,
                    session_id = %self.session_id,
                    error = %e,
                    "WebSocket protocol error"
                );
                ctx.stop();
                return;
            }
        };

        match msg {
            ws::Message::Ping(data) => {
                self.hb = Instant::now();
                self.registry.record_heartbeat(&self.session_id);
                ctx.pong(&data);
            }
            ws::Message::Pong(_) => {
                self.hb = Instant::now();
                self.registry.record_heartbeat(&self.session_id);
            }
            ws::Message::Text(text) => {
                debug!(
                    user_id = %self.user_id,
                    session_id = %self.session_id,
                    text = %text,
                    "Received text message"
                );
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Ping) => {
                        self.hb = Instant::now();
                        self.registry.record_heartbeat(&self.session_id);
                        let pong = serde_json::json!({"type": "pong"});
                        ctx.text(pong.to_string());
                    }
                    Ok(ClientMessage::Pong) => {
                        self.hb = Instant::now();
                        self.registry.record_heartbeat(&self.session_id);
                    }
                    Ok(ClientMessage::Subscribe { channel }) => {
                        let auth = self.auth.clone();
                        let claims = self.claims.clone();
                        let session_id = self.session_id;
                        let registry = self.registry.clone();
                        let target_channel = channel.clone();

                        let fut = async move {
                            auth.authorize_subscription(&claims, &target_channel).await
                        };

                        ctx.wait(actix::fut::wrap_future(fut).then(
                            move |res, _act, ctx: &mut actix_web_actors::ws::WebsocketContext<UserWebSocket>| {
                                match res {
                                    Ok(_) => {
                                        registry.subscribe(session_id, channel.clone());
                                        info!(session_id = %session_id, channel = %channel, "Subscribed to channel");
                                        let success = serde_json::json!({
                                            "type": "subscribed",
                                            "channel": channel
                                        });
                                        ctx.text(success.to_string());
                                    }
                                    Err(e) => {
                                        warn!(session_id = %session_id, channel = %channel, error = %e, "Subscription denied");
                                        let error_msg = serde_json::json!({
                                            "type": "subscription_error",
                                            "channel": channel,
                                            "reason": e.to_string()
                                        });
                                        ctx.text(error_msg.to_string());
                                    }
                                }
                                actix::fut::ready(())
                            },
                        ));
                    }
                    Ok(ClientMessage::Unsubscribe { channel }) => {
                        self.registry.unsubscribe(self.session_id, &channel);
                        info!(session_id = %self.session_id, channel = %channel, "Unsubscribed from channel");
                    }
                    Ok(ClientMessage::Publish { channel, .. }) => {
                        // All publish attempts are currently rejected in our guard
                        let auth = self.auth.clone();
                        let claims = self.claims.clone();
                        let fut = async move {
                            auth.authorize_publish(&claims, &channel).await
                        };
                        ctx.wait(actix::fut::wrap_future(fut).then(|res, act: &mut Self, ctx| {
                           if let Err(e) = res {
                               act.send_error(ctx, &e.to_string());
                           }
                           actix::fut::ready(())
                        }));
                    }
                    Err(_) => {
                        debug!(
                            user_id = %self.user_id,
                            session_id = %self.session_id,
                            "Unrecognized client message, ignoring"
                        );
                    }
                }
            }
            ws::Message::Binary(_) => {
                warn!(
                    user_id = %self.user_id,
                    session_id = %self.session_id,
                    "Binary messages are not supported"
                );
            }
            ws::Message::Close(reason) => {
                info!(
                    user_id = %self.user_id,
                    session_id = %self.session_id,
                    "Client requested close"
                );
                ctx.close(reason);
                ctx.stop();
            }
            _ => {}
        }
    }
}

impl Handler<DeliverEvent> for UserWebSocket {
    type Result = ();

    fn handle(&mut self, msg: DeliverEvent, ctx: &mut Self::Context) {
        let envelope = WsEnvelope { event: msg.0 };
        match serde_json::to_string(&envelope) {
            Ok(json) => {
                debug!(
                    user_id = %self.user_id,
                    session_id = %self.session_id,
                    "Delivering event to client"
                );
                ctx.text(json);
            }
            Err(e) => {
                error!(
                    user_id = %self.user_id,
                    session_id = %self.session_id,
                    error = %e,
                    "Failed to serialize event"
                );
            }
        }
    }
}

/// HTTP upgrade endpoint for WebSocket connections.
pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    registry: web::Data<Arc<SessionRegistry>>,
    address_book: web::Data<Arc<WsAddressBook>>,
    jwt_service: web::Data<Arc<JwtService>>,
    auth_guard: web::Data<Arc<RealtimeAuth>>,
) -> Result<HttpResponse, Error> {
    let query_string = req.query_string();

    // Extract token from query string
    let token = query_string.split('&').find_map(|pair| {
        let mut parts = pair.splitn(2, '=');
        match (parts.next(), parts.next()) {
            (Some("token"), Some(value)) => Some(value.to_string()),
            _ => None,
        }
    }).ok_or_else(|| actix_web::error::ErrorUnauthorized("Missing token parameter"))?;

    // Validate token
    let claims = jwt_service.validate_token(&token).await.map_err(|e| {
        warn!(error = %e, "WebSocket connection rejected: invalid token");
        actix_web::error::ErrorUnauthorized(format!("Invalid token: {}", e))
    })?;

    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| {
        actix_web::error::ErrorUnauthorized("Invalid user ID in token")
    })?;

    // Extract optional reconnect_session_id parameter
    let reconnect_session_id = query_string.split('&').find_map(|pair| {
        let mut parts = pair.splitn(2, '=');
        match (parts.next(), parts.next()) {
            (Some("reconnect_session_id") | Some("session_id"), Some(value)) => {
                Uuid::parse_str(value).ok()
            }
            _ => None,
        }
    });

    info!(
        user_id = %user_id,
        is_reconnect = reconnect_session_id.is_some(),
        "WebSocket upgrade request approved via JWT"
    );
    
    let ws_actor = UserWebSocket::with_reconnect(
        user_id, 
        claims,
        registry.get_ref().clone(),
        address_book.get_ref().clone(),
        auth_guard.get_ref().clone(),
        reconnect_session_id,
    );

    ws::start(ws_actor, &req, stream)
}

/// Configures the WebSocket route for the application.
pub fn configure_ws_route(cfg: &mut web::ServiceConfig) {
    cfg.route("/ws", web::get().to(ws_handler));
}
