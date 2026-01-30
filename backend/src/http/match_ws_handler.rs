use actix::{Actor, ActorContext, AsyncContext, Handler, Message, StreamHandler};
use actix_web::{web, Error, HttpRequest, HttpResponse};
use actix_web_actors::ws;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// WebSocket message types
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsMessage {
    /// Subscribe to match updates
    Subscribe { match_id: Uuid },
    /// Unsubscribe from match updates
    Unsubscribe { match_id: Uuid },
    /// Match state changed
    MatchStateChanged {
        match_id: Uuid,
        from_state: String,
        to_state: String,
        timestamp: String,
    },
    /// Match created
    MatchCreated {
        match_id: Uuid,
        on_chain_match_id: String,
        player_a: String,
        player_b: String,
    },
    /// Match started
    MatchStarted {
        match_id: Uuid,
        started_at: String,
    },
    /// Match completed
    MatchCompleted {
        match_id: Uuid,
        winner: String,
        completed_at: String,
    },
    /// Match disputed
    MatchDisputed {
        match_id: Uuid,
        actor: String,
        reason: String,
    },
    /// Match finalized
    MatchFinalized {
        match_id: Uuid,
        finalized_at: String,
    },
    /// Error message
    Error { message: String },
    /// Ping/Pong for keepalive
    Ping,
    Pong,
}

/// WebSocket actor for match updates
pub struct MatchWebSocket {
    /// Unique session ID
    id: Uuid,
    /// Last heartbeat time
    hb: Instant,
    /// Subscribed match IDs
    subscriptions: Vec<Uuid>,
}

impl MatchWebSocket {
    pub fn new() -> Self {
        Self {
            id: Uuid::new_v4(),
            hb: Instant::now(),
            subscriptions: Vec::new(),
        }
    }

    /// Send heartbeat to client
    fn hb(&self, ctx: &mut <Self as Actor>::Context) {
        ctx.run_interval(Duration::from_secs(5), |act, ctx| {
            // Check if client is still connected
            if Instant::now().duration_since(act.hb) > Duration::from_secs(10) {
                warn!(session_id = %act.id, "WebSocket heartbeat timeout, disconnecting");
                ctx.stop();
                return;
            }

            let ping = serde_json::to_string(&WsMessage::Ping).unwrap();
            ctx.text(ping);
        });
    }

    /// Handle subscription request
    fn handle_subscribe(&mut self, match_id: Uuid, ctx: &mut <Self as Actor>::Context) {
        if !self.subscriptions.contains(&match_id) {
            self.subscriptions.push(match_id);
            info!(
                session_id = %self.id,
                match_id = %match_id,
                "Subscribed to match updates"
            );
        }
    }

    /// Handle unsubscription request
    fn handle_unsubscribe(&mut self, match_id: Uuid) {
        self.subscriptions.retain(|id| id != &match_id);
        info!(
            session_id = %self.id,
            match_id = %match_id,
            "Unsubscribed from match updates"
        );
    }

    /// Handle incoming WebSocket message
    fn handle_message(&mut self, msg: &str, ctx: &mut <Self as Actor>::Context) {
        match serde_json::from_str::<WsMessage>(msg) {
            Ok(ws_msg) => match ws_msg {
                WsMessage::Subscribe { match_id } => {
                    self.handle_subscribe(match_id, ctx);
                }
                WsMessage::Unsubscribe { match_id } => {
                    self.handle_unsubscribe(match_id);
                }
                WsMessage::Ping => {
                    let pong = serde_json::to_string(&WsMessage::Pong).unwrap();
                    ctx.text(pong);
                }
                WsMessage::Pong => {
                    self.hb = Instant::now();
                }
                _ => {
                    warn!(
                        session_id = %self.id,
                        "Received unexpected message type"
                    );
                }
            },
            Err(e) => {
                error!(
                    session_id = %self.id,
                    error = %e,
                    "Failed to parse WebSocket message"
                );
                let error_msg = WsMessage::Error {
                    message: "Invalid message format".to_string(),
                };
                ctx.text(serde_json::to_string(&error_msg).unwrap());
            }
        }
    }

    /// Broadcast message to this session if subscribed to match
    pub fn broadcast_if_subscribed(&self, match_id: Uuid, message: &WsMessage, ctx: &mut <Self as Actor>::Context) {
        if self.subscriptions.contains(&match_id) {
            debug!(
                session_id = %self.id,
                match_id = %match_id,
                "Broadcasting message to subscribed client"
            );
            if let Ok(json) = serde_json::to_string(message) {
                ctx.text(json);
            }
        }
    }
}

impl Actor for MatchWebSocket {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        info!(session_id = %self.id, "WebSocket connection established");
        self.hb(ctx);
    }

    fn stopped(&mut self, _ctx: &mut Self::Context) {
        info!(
            session_id = %self.id,
            "WebSocket connection closed"
        );
    }
}

/// Handle incoming WebSocket messages (text)
impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for MatchWebSocket {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match msg {
            Ok(ws::Message::Ping(msg)) => {
                self.hb = Instant::now();
                ctx.pong(&msg);
            }
            Ok(ws::Message::Pong(_)) => {
                self.hb = Instant::now();
            }
            Ok(ws::Message::Text(text)) => {
                self.handle_message(&text, ctx);
            }
            Ok(ws::Message::Binary(_)) => {
                warn!(session_id = %self.id, "Binary messages not supported");
            }
            Ok(ws::Message::Close(reason)) => {
                info!(
                    session_id = %self.id,
                    reason = ?reason,
                    "Client initiated close"
                );
                ctx.stop();
            }
            _ => (),
        }
    }
}

/// Actix message for broadcasting to all sessions
#[derive(Message, Clone)]
#[rtype(result = "()")]
pub struct BroadcastMessage {
    pub match_id: Uuid,
    pub message: WsMessage,
}

impl Handler<BroadcastMessage> for MatchWebSocket {
    type Result = ();

    fn handle(&mut self, msg: BroadcastMessage, ctx: &mut Self::Context) {
        self.broadcast_if_subscribed(msg.match_id, &msg.message, ctx);
    }
}

/// WebSocket endpoint handler
/// WS /ws/matches/:id
pub async fn match_websocket(
    req: HttpRequest,
    stream: web::Payload,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, Error> {
    let match_id = path.into_inner();

    info!(match_id = %match_id, "New WebSocket connection request");

    let ws = MatchWebSocket::new();

    let resp = ws::start(ws, &req, stream)?;

    Ok(resp)
}

/// Configure WebSocket routes
pub fn configure_ws_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/ws/matches/{id}", web::get().to(match_websocket));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ws_message_serialization() {
        let msg = WsMessage::Subscribe {
            match_id: Uuid::new_v4(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("subscribe"));

        let deserialized: WsMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            WsMessage::Subscribe { .. } => {}
            _ => panic!("Expected Subscribe message"),
        }
    }

    #[test]
    fn test_match_state_changed_serialization() {
        let msg = WsMessage::MatchStateChanged {
            match_id: Uuid::new_v4(),
            from_state: "CREATED".to_string(),
            to_state: "STARTED".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("match_state_changed"));
        assert!(json.contains("CREATED"));
        assert!(json.contains("STARTED"));
    }

    #[test]
    fn test_error_message() {
        let msg = WsMessage::Error {
            message: "Test error".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("error"));
        assert!(json.contains("Test error"));
    }
}
