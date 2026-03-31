pub mod auth_handler;
pub mod health;
pub mod idempotency;
pub mod idempotency_examples;
pub mod match_authority_handler;
pub mod matchmaking;
#[deprecated(note = "Use realtime::user_ws instead for authenticated WebSocket connections")]
pub mod match_ws_handler;
pub mod notification_handler;
pub mod reputation_handler;
