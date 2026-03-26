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

/// Per-user WebSocket actor with heartbeat management and event delivery.
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
///
/// Extracts user identity from query parameters. In a future task, this will
/// be replaced with proper JWT validation via JwtService.
pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    registry: web::Data<Arc<SessionRegistry>>,
) -> Result<HttpResponse, Error> {
    let query_string = req.query_string();

    // Extract token from query string (reserved for future JWT validation)
    let _token = query_string.split('&').find_map(|pair| {
        let mut parts = pair.splitn(2, '=');
        match (parts.next(), parts.next()) {
            (Some("token"), Some(value)) => Some(value.to_string()),
            _ => None,
        }
    });

    // TODO: In Task 6, we'll add JwtService validation here.
    // For now, extract user_id from a simple "user_id" query param for testing.
    let user_id_str = query_string
        .split('&')
        .find_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            match (parts.next(), parts.next()) {
                (Some("user_id"), Some(value)) => Some(value.to_string()),
                _ => None,
            }
        })
        .ok_or_else(|| actix_web::error::ErrorUnauthorized("Missing user_id parameter"))?;

    let user_id = Uuid::parse_str(&user_id_str)
        .map_err(|_| actix_web::error::ErrorUnauthorized("Invalid user_id"))?;

    info!(user_id = %user_id, "WebSocket upgrade request");
    let ws_actor = UserWebSocket::new(user_id, registry.get_ref().clone());
    ws::start(ws_actor, &req, stream)
}

/// Configures the WebSocket route for the application.
pub fn configure_ws_route(cfg: &mut web::ServiceConfig) {
    cfg.route("/ws", web::get().to(ws_handler));
}
