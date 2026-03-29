pub mod auth_handler;
pub mod health;
pub mod match_authority_handler;
// NOTE: Deprecated - Use realtime::user_ws instead for authenticated WebSocket connections
#[allow(deprecated)]
pub mod match_ws_handler;
pub mod notification_handler;
pub mod reputation_handler;
