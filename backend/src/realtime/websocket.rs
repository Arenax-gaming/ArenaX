use actix::{Actor, Context, Handler, Message, Recipient};
use actix_web::{web, Error, HttpRequest, HttpResponse};
use actix_web_actors::ws;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;
use crate::realtime::events::*;

/// WebSocket connection actor
pub struct WebSocketConnection {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub subscriptions: HashMap<String, bool>, // channel -> subscribed
}

impl Actor for WebSocketConnection {
    type Context = ws::WebsocketContext<Self>;
}

/// Message for sending data to WebSocket
#[derive(Message)]
#[rtype(result = "()")]
pub struct WsMessage(pub String);

/// Message for subscribing to a channel
#[derive(Message)]
#[rtype(result = "()")]
pub struct Subscribe {
    pub channel: String,
}

/// Message for unsubscribing from a channel
#[derive(Message)]
#[rtype(result = "()")]
pub struct Unsubscribe {
    pub channel: String,
}

/// WebSocket server actor that manages all connections
pub struct WebSocketServer {
    pub sessions: HashMap<Uuid, Recipient<WsMessage>>,
}

impl Actor for WebSocketServer {
    type Context = Context<Self>;
}

impl WebSocketServer {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn send_to_user(&self, user_id: Uuid, message: &str) {
        if let Some(recipient) = self.sessions.get(&user_id) {
            let _ = recipient.do_send(WsMessage(message.to_string()));
        }
    }

    pub fn broadcast_to_channel(&self, channel: &str, message: &str) {
        for recipient in self.sessions.values() {
            let _ = recipient.do_send(WsMessage(message.to_string()));
        }
    }
}

impl Handler<WsMessage> for WebSocketConnection {
    type Result = ();

    fn handle(&mut self, msg: WsMessage, ctx: &mut Self::Context) {
        ctx.text(msg.0);
    }
}

impl Handler<Subscribe> for WebSocketConnection {
    type Result = ();

    fn handle(&mut self, msg: Subscribe, _ctx: &mut Self::Context) {
        self.subscriptions.insert(msg.channel, true);
    }
}

impl Handler<Unsubscribe> for WebSocketConnection {
    type Result = ();

    fn handle(&mut self, msg: Unsubscribe, _ctx: &mut Self::Context) {
        self.subscriptions.remove(&msg.channel);
    }
}

/// WebSocket message types
#[derive(Debug, Serialize, Deserialize)]
pub struct WsRequest {
    pub action: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WsResponse {
    pub action: String,
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// WebSocket handler for tournament events
pub async fn tournament_websocket(
    req: HttpRequest,
    stream: web::Payload,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, Error> {
    let tournament_id = path.into_inner();
    let ws = ws::start(
        WebSocketConnection {
            id: Uuid::new_v4(),
            user_id: None, // TODO: Extract from JWT token
            subscriptions: HashMap::new(),
        },
        &req,
        stream,
    )?;

    // Subscribe to tournament channel
    ws.do_send(Subscribe {
        channel: format!("tournament:{}", tournament_id),
    });

    Ok(HttpResponse::Ok().json(ws))
}

/// WebSocket handler for match events
pub async fn match_websocket(
    req: HttpRequest,
    stream: web::Payload,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, Error> {
    let match_id = path.into_inner();
    let ws = ws::start(
        WebSocketConnection {
            id: Uuid::new_v4(),
            user_id: None, // TODO: Extract from JWT token
            subscriptions: HashMap::new(),
        },
        &req,
        stream,
    )?;

    // Subscribe to match channel
    ws.do_send(Subscribe {
        channel: format!("match:{}", match_id),
    });

    Ok(HttpResponse::Ok().json(ws))
}

/// WebSocket handler for global events
pub async fn global_websocket(
    req: HttpRequest,
    stream: web::Payload,
) -> Result<HttpResponse, Error> {
    let ws = ws::start(
        WebSocketConnection {
            id: Uuid::new_v4(),
            user_id: None, // TODO: Extract from JWT token
            subscriptions: HashMap::new(),
        },
        &req,
        stream,
    )?;

    // Subscribe to global channel
    ws.do_send(Subscribe {
        channel: "global".to_string(),
    });

    Ok(HttpResponse::Ok().json(ws))
}

/// WebSocket handler for user-specific events
pub async fn user_websocket(
    req: HttpRequest,
    stream: web::Payload,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, Error> {
    let user_id = path.into_inner();
    let ws = ws::start(
        WebSocketConnection {
            id: Uuid::new_v4(),
            user_id: Some(user_id),
            subscriptions: HashMap::new(),
        },
        &req,
        stream,
    )?;

    // Subscribe to user-specific channels
    ws.do_send(Subscribe {
        channel: format!("user:{}", user_id),
    });

    Ok(HttpResponse::Ok().json(ws))
}
