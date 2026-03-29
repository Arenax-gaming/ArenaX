use actix::Message;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// All real-time events pushed to clients over WebSocket connections.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RealtimeEvent {
    BalanceUpdate {
        user_id: Uuid,
        balance_ngn: i64,
        balance_arenax_tokens: i64,
        balance_xlm: i64,
        timestamp: String,
    },
    MatchFound {
        match_id: Uuid,
        opponent_id: Uuid,
        opponent_name: String,
        game_mode: String,
        timestamp: String,
    },
    MatchStatusChange {
        match_id: Uuid,
        from_status: String,
        to_status: String,
        timestamp: String,
    },
    Notification {
        id: Uuid,
        title: String,
        body: String,
        category: String,
        timestamp: String,
    },
    MatchCompleted {
        match_id: Uuid,
        winner_id: Uuid,
        elo_change: i32,
        timestamp: String,
    },
    MatchDisputed {
        match_id: Uuid,
        reason: String,
        timestamp: String,
    },
}

/// Envelope wrapping a realtime event for WebSocket delivery.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WsEnvelope {
    pub event: RealtimeEvent,
}

/// Messages received from the client over WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Ping,
    Pong,
    Subscribe {
        channel: String,
    },
    Unsubscribe {
        channel: String,
    },
    Publish {
        channel: String,
        event: RealtimeEvent,
    },
}

/// Actix message for delivering a realtime event to an actor.
#[derive(Debug, Clone, Message)]
#[rtype(result = "()")]
pub struct DeliverEvent(pub RealtimeEvent);

/// Channel naming helpers for pub/sub routing.
pub mod channels {
    use uuid::Uuid;

    pub const USER_CHANNEL_PATTERN: &str = "user:*";
    pub const MATCH_CHANNEL_PATTERN: &str = "match:*";

    pub fn user_channel(user_id: Uuid) -> String {
        format!("user:{}", user_id)
    }

    pub fn match_channel(match_id: Uuid) -> String {
        format!("match:{}", match_id)
    }
}
