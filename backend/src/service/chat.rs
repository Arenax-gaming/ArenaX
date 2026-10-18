//! In-app chat (Issue #1256).
//!
//! Tournament rooms and direct messages share one store. A message is rejected
//! when it contains profanity, then appended so history survives a restart
//! when Redis is attached. The same payload is published on `chat:{room}` for
//! the WebSocket broadcaster.

use crate::api_error::ApiError;
use crate::auth::jwt_service::JwtService;
use crate::realtime::event_bus::EventBus;
use crate::realtime::events::RealtimeEvent;
use actix_web::{web, HttpRequest, HttpResponse};
use chrono::Utc;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const HISTORY_LIMIT: isize = 200;
const MAX_BODY_CHARS: usize = 2_000;

const PROFANITY: &[&str] = &[
    "shit", "fuck", "bitch", "ass", "damn", "hell", "bastard", "crap", "piss", "dick", "cock",
    "pussy",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatAuthError {
    Forbidden(String),
    Invalid(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatLine {
    pub id: Uuid,
    pub room_id: String,
    pub sender_id: Uuid,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug)]
pub enum ChatError {
    Empty,
    TooLong,
    Profanity(String),
    InvalidRoom(String),
    Forbidden(String),
    Redis(String),
}

impl std::fmt::Display for ChatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChatError::Empty => write!(f, "Message is empty"),
            ChatError::TooLong => write!(f, "Message exceeds {MAX_BODY_CHARS} characters"),
            ChatError::Profanity(word) => write!(f, "Message blocked by the profanity filter ({word})"),
            ChatError::InvalidRoom(reason) => write!(f, "Invalid chat room: {reason}"),
            ChatError::Forbidden(reason) => write!(f, "{reason}"),
            ChatError::Redis(reason) => write!(f, "redis error: {reason}"),
        }
    }
}

pub fn tournament_room(tournament_id: Uuid) -> String {
    format!("tournament:{tournament_id}")
}

pub fn direct_room(a: Uuid, b: Uuid) -> Result<String, ChatError> {
    if a == b {
        return Err(ChatError::InvalidRoom(
            "direct messages need two different users".into(),
        ));
    }
    let (left, right) = if a < b { (a, b) } else { (b, a) };
    Ok(format!("dm:{left}:{right}"))
}

pub fn named_room(slug: &str) -> Result<String, ChatError> {
    if !valid_slug(slug) {
        return Err(ChatError::InvalidRoom(
            "room names use letters, numbers, '_' and '-'".into(),
        ));
    }
    Ok(format!("room:{slug}"))
}

fn valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 64
        && slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// `channel` is either `chat:{room}` or the room id itself.
pub fn authorize_chat_channel(user_id: Uuid, channel: &str) -> Result<(), ChatAuthError> {
    let room = channel.strip_prefix("chat:").unwrap_or(channel);
    if let Some(rest) = room.strip_prefix("dm:") {
        let mut parts = rest.split(':');
        let left = parts.next().and_then(|part| Uuid::parse_str(part).ok());
        let right = parts.next().and_then(|part| Uuid::parse_str(part).ok());
        let extra = parts.next();
        match (left, right, extra) {
            (Some(left), Some(right), None) if left == user_id || right == user_id => Ok(()),
            (Some(_), Some(_), None) => Err(ChatAuthError::Forbidden(
                "Cannot join another user's direct chat".into(),
            )),
            _ => Err(ChatAuthError::Invalid("direct chat id is malformed".into())),
        }
    } else if let Some(id) = room.strip_prefix("tournament:") {
        Uuid::parse_str(id)
            .map(|_| ())
            .map_err(|_| ChatAuthError::Invalid("tournament id is malformed".into()))
    } else if let Some(slug) = room.strip_prefix("room:") {
        if valid_slug(slug) {
            Ok(())
        } else {
            Err(ChatAuthError::Invalid("room name is malformed".into()))
        }
    } else {
        Err(ChatAuthError::Invalid(format!("unknown chat room {room}")))
    }
}

/// Returns the blocked word, if the text contains one as a whole word.
pub fn blocked_word(text: &str) -> Option<&'static str> {
    for word in text.split(|c: char| !c.is_ascii_alphanumeric()) {
        if word.is_empty() {
            continue;
        }
        let lower = word.to_ascii_lowercase();
        if let Some(found) = PROFANITY.iter().copied().find(|banned| *banned == lower) {
            return Some(found);
        }
    }
    None
}

enum Store {
    Memory(Mutex<HashMap<String, Vec<ChatLine>>>),
    Redis(ConnectionManager),
}

pub struct ChatService {
    store: Store,
    bus: Option<EventBus>,
    published: Mutex<Vec<ChatLine>>,
}

impl ChatService {
    pub fn memory() -> Self {
        Self {
            store: Store::Memory(Mutex::new(HashMap::new())),
            bus: None,
            published: Mutex::new(Vec::new()),
        }
    }

    pub fn redis(conn: ConnectionManager, bus: Option<EventBus>) -> Self {
        Self {
            store: Store::Redis(conn),
            bus,
            published: Mutex::new(Vec::new()),
        }
    }

    pub async fn send(&self, sender_id: Uuid, room_id: &str, body: &str) -> Result<ChatLine, ChatError> {
        authorize_chat_channel(sender_id, room_id).map_err(|error| match error {
            ChatAuthError::Forbidden(reason) => ChatError::Forbidden(reason),
            ChatAuthError::Invalid(reason) => ChatError::InvalidRoom(reason),
        })?;
        let body = body.trim();
        if body.is_empty() {
            return Err(ChatError::Empty);
        }
        if body.chars().count() > MAX_BODY_CHARS {
            return Err(ChatError::TooLong);
        }
        if let Some(word) = blocked_word(body) {
            return Err(ChatError::Profanity(word.to_string()));
        }

        let line = ChatLine {
            id: Uuid::new_v4(),
            room_id: room_id.to_string(),
            sender_id,
            body: body.to_string(),
            created_at: Utc::now().to_rfc3339(),
        };
        self.persist(&line).await?;
        self.published.lock().expect("chat outbox").push(line.clone());
        if let Some(bus) = &self.bus {
            bus.publish_to_channel(
                &format!("chat:{room_id}"),
                &RealtimeEvent::ChatMessage {
                    room_id: line.room_id.clone(),
                    message_id: line.id,
                    sender_id: line.sender_id,
                    body: line.body.clone(),
                    timestamp: line.created_at.clone(),
                },
            )
            .await;
        }
        Ok(line)
    }

    pub async fn history(&self, reader: Uuid, room_id: &str, limit: usize) -> Result<Vec<ChatLine>, ChatError> {
        authorize_chat_channel(reader, room_id).map_err(|error| match error {
            ChatAuthError::Forbidden(reason) => ChatError::Forbidden(reason),
            ChatAuthError::Invalid(reason) => ChatError::InvalidRoom(reason),
        })?;
        let limit = limit.clamp(1, HISTORY_LIMIT as usize);
        let mut lines = self.load(room_id).await?;
        if lines.len() > limit {
            lines = lines.split_off(lines.len() - limit);
        }
        Ok(lines)
    }

    pub fn published(&self) -> Vec<ChatLine> {
        self.published.lock().expect("chat outbox").clone()
    }

    async fn persist(&self, line: &ChatLine) -> Result<(), ChatError> {
        match &self.store {
            Store::Memory(rooms) => {
                rooms
                    .lock()
                    .expect("chat history")
                    .entry(line.room_id.clone())
                    .or_default()
                    .push(line.clone());
                Ok(())
            }
            Store::Redis(conn) => {
                let mut conn = conn.clone();
                let payload = serde_json::to_string(line).map_err(|e| ChatError::Redis(e.to_string()))?;
                let key = history_key(&line.room_id);
                redis::cmd("RPUSH")
                    .arg(&key)
                    .arg(payload)
                    .query_async::<i64>(&mut conn)
                    .await
                    .map_err(|e| ChatError::Redis(e.to_string()))?;
                redis::cmd("LTRIM")
                    .arg(&key)
                    .arg(-HISTORY_LIMIT)
                    .arg(-1_i64)
                    .query_async::<String>(&mut conn)
                    .await
                    .map_err(|e| ChatError::Redis(e.to_string()))?;
                Ok(())
            }
        }
    }

    async fn load(&self, room_id: &str) -> Result<Vec<ChatLine>, ChatError> {
        match &self.store {
            Store::Memory(rooms) => Ok(rooms
                .lock()
                .expect("chat history")
                .get(room_id)
                .cloned()
                .unwrap_or_default()),
            Store::Redis(conn) => {
                let mut conn = conn.clone();
                let raw: Vec<String> = redis::cmd("LRANGE")
                    .arg(history_key(room_id))
                    .arg(0)
                    .arg(-1)
                    .query_async(&mut conn)
                    .await
                    .map_err(|e| ChatError::Redis(e.to_string()))?;
                Ok(raw
                    .iter()
                    .filter_map(|line| serde_json::from_str(line).ok())
                    .collect())
            }
        }
    }
}

fn history_key(room_id: &str) -> String {
    format!("chat:history:{room_id}")
}

#[derive(Debug, Deserialize)]
struct SendChatBody {
    content: String,
    room_id: Option<String>,
    tournament_id: Option<Uuid>,
    to_user_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
struct HistoryQuery {
    room: String,
    limit: Option<usize>,
}

fn chat_error(error: ChatError) -> ApiError {
    match error {
        ChatError::Redis(message) => ApiError::RedisError(message),
        ChatError::Forbidden(message) => ApiError::forbidden(message),
        other => ApiError::bad_request(other.to_string()),
    }
}

fn token_from_request(req: &HttpRequest) -> Option<String> {
    req.headers()
        .get("Authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer ").map(str::to_owned))
        .or_else(|| {
            req.cookie(crate::http::auth_handler::ACCESS_TOKEN_COOKIE)
                .map(|cookie| cookie.value().to_string())
        })
}

async fn sender_id(req: &HttpRequest, jwt: &JwtService) -> Result<Uuid, ApiError> {
    let token = token_from_request(req).ok_or_else(|| ApiError::unauthorized("Missing access token"))?;
    let claims = jwt
        .validate_token(&token)
        .await
        .map_err(|_| ApiError::unauthorized("Invalid access token"))?;
    Uuid::parse_str(&claims.sub).map_err(|_| ApiError::unauthorized("Invalid user id"))
}

fn resolve_room(sender: Uuid, body: &SendChatBody) -> Result<String, ChatError> {
    if let Some(tournament_id) = body.tournament_id {
        return Ok(tournament_room(tournament_id));
    }
    if let Some(to_user_id) = body.to_user_id {
        return direct_room(sender, to_user_id);
    }
    if let Some(room_id) = body.room_id.as_deref() {
        authorize_chat_channel(sender, room_id).map_err(|error| match error {
            ChatAuthError::Forbidden(reason) => ChatError::Forbidden(reason),
            ChatAuthError::Invalid(reason) => ChatError::InvalidRoom(reason),
        })?;
        return Ok(room_id.trim_start_matches("chat:").to_string());
    }
    Err(ChatError::InvalidRoom(
        "provide tournament_id, to_user_id, or room_id".into(),
    ))
}

async fn send_chat_message(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    chat: web::Data<Arc<ChatService>>,
    body: web::Json<SendChatBody>,
) -> Result<HttpResponse, ApiError> {
    let sender = sender_id(&req, jwt.get_ref()).await?;
    let room = resolve_room(sender, &body).map_err(chat_error)?;
    let line = chat.send(sender, &room, &body.content).await.map_err(chat_error)?;
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": line
    })))
}

async fn chat_history(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    chat: web::Data<Arc<ChatService>>,
    query: web::Query<HistoryQuery>,
) -> Result<HttpResponse, ApiError> {
    let reader = sender_id(&req, jwt.get_ref()).await?;
    let room = query.room.trim_start_matches("chat:");
    let lines = chat
        .history(reader, room, query.limit.unwrap_or(50))
        .await
        .map_err(chat_error)?;
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": lines
    })))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api/chat")
            .route("/messages", web::post().to(send_chat_message))
            .route("/history", web::get().to(chat_history)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_rooms_are_the_same_in_either_order() {
        let a = Uuid::from_u128(1);
        let b = Uuid::from_u128(2);
        assert_eq!(direct_room(a, b).unwrap(), direct_room(b, a).unwrap());
        assert!(direct_room(a, a).is_err());
    }

    #[test]
    fn profanity_matches_whole_words_only() {
        assert_eq!(blocked_word("what the fuck"), Some("fuck"));
        assert_eq!(blocked_word("CLASS"), None);
        assert_eq!(blocked_word("hello there"), None);
    }

    #[tokio::test]
    async fn tournament_and_direct_messages_are_stored_and_filtered() {
        let chat = ChatService::memory();
        let ada = Uuid::from_u128(10);
        let bob = Uuid::from_u128(11);
        let tournament = Uuid::from_u128(99);
        let room = tournament_room(tournament);

        let line = chat.send(ada, &room, "good luck").await.unwrap();
        assert_eq!(line.room_id, room);
        assert!(chat.send(ada, &room, "fuck this").await.is_err());

        let history = chat.history(bob, &room, 50).await.unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].body, "good luck");

        let dm = direct_room(ada, bob).unwrap();
        chat.send(ada, &dm, "see you in game").await.unwrap();
        assert!(chat.history(bob, &dm, 10).await.unwrap().len() == 1);
        let stranger = Uuid::from_u128(12);
        assert!(chat.history(stranger, &dm, 10).await.is_err());

        let published = chat.published();
        assert_eq!(published.len(), 2);
        assert!(published.iter().any(|line| line.room_id.starts_with("tournament:")));
        assert!(published.iter().any(|line| line.room_id.starts_with("dm:")));
    }

    #[test]
    fn chat_channel_authorization_rejects_a_foreign_direct_room() {
        let ada = Uuid::from_u128(1);
        let bob = Uuid::from_u128(2);
        let stranger = Uuid::from_u128(3);
        let room = direct_room(ada, bob).unwrap();
        assert!(authorize_chat_channel(ada, &format!("chat:{room}")).is_ok());
        assert!(matches!(
            authorize_chat_channel(stranger, &format!("chat:{room}")),
            Err(ChatAuthError::Forbidden(_))
        ));
        assert!(authorize_chat_channel(ada, "chat:tournament:not-a-uuid").is_err());
        assert!(authorize_chat_channel(ada, "chat:room:party-session").is_ok());
    }
}
