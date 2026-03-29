use crate::auth::jwt_service::{Claims, JwtService};
use crate::realtime::auth::RealtimeAuth;
use crate::realtime::events::{channels, ClientMessage, DeliverEvent, WsEnvelope};
use crate::realtime::session_registry::SessionRegistry;
use actix::{Actor, ActorContext, AsyncContext, Handler, StreamHandler, ActorFutureExt};
use actix_web::{web, Error, HttpRequest, HttpResponse};
use actix_web_actors::ws;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
const CLIENT_TIMEOUT: Duration = Duration::from_secs(10);

/// Per-user WebSocket actor with heartbeat management and event delivery.
pub struct UserWebSocket {
    session_id: Uuid,
    user_id: Uuid,
    claims: Claims,
    hb: Instant,
    registry: Arc<SessionRegistry>,
    auth: Arc<RealtimeAuth>,
}

impl UserWebSocket {
    pub fn new(
        user_id: Uuid,
        claims: Claims,
        registry: Arc<SessionRegistry>,
        auth: Arc<RealtimeAuth>,
    ) -> Self {
        Self {
            session_id: Uuid::new_v4(),
            user_id,
            claims,
            hb: Instant::now(),
            registry,
            auth,
        }
    }

    /// Starts a heartbeat that pings the client every HEARTBEAT_INTERVAL
    /// and disconnects if no response is received within CLIENT_TIMEOUT.
    fn start_heartbeat(&self, ctx: &mut <Self as Actor>::Context) {
        ctx.run_interval(HEARTBEAT_INTERVAL, |act, ctx| {
            if Instant::now().duration_since(act.hb) > CLIENT_TIMEOUT {
                warn!(
                    user_id = %act.user_id,
                    session_id = %act.session_id,
                    "Client heartbeat timeout, disconnecting"
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
            "WebSocket session started"
        );
        self.registry.register(self.user_id, self.session_id);

        // Automatically subscribe to own user channel
        let user_channel = channels::user_channel(self.user_id);
        self.registry.subscribe(self.session_id, user_channel);

        self.start_heartbeat(ctx);
    }

    fn stopped(&mut self, _ctx: &mut Self::Context) {
        info!(
            user_id = %self.user_id,
            session_id = %self.session_id,
            "WebSocket session stopped"
        );
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
                ctx.pong(&data);
            }
            ws::Message::Pong(_) => {
                self.hb = Instant::now();
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
                        let pong = serde_json::json!({"type": "pong"});
                        ctx.text(pong.to_string());
                    }
                    Ok(ClientMessage::Pong) => {
                        self.hb = Instant::now();
                    }
                    Ok(ClientMessage::Subscribe { channel }) => {
                        let auth = self.auth.clone();
                        let claims = self.claims.clone();
                        let session_id = self.session_id;
                        let registry = self.registry.clone();

                        let fut = async move {
                            auth.authorize_subscription(&claims, &channel).await
                        };

                        ctx.wait(actix::fut::wrap_future(fut).then(
                            move |res, _act, ctx| {
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

    info!(user_id = %user_id, "WebSocket upgrade request approved via JWT");
    
    let ws_actor = UserWebSocket::new(
        user_id, 
        claims,
        registry.get_ref().clone(), 
        auth_guard.get_ref().clone()
    );

    ws::start(ws_actor, &req, stream)
}

/// Configures the WebSocket route for the application.
pub fn configure_ws_route(cfg: &mut web::ServiceConfig) {
    cfg.route("/ws", web::get().to(ws_handler));
}
