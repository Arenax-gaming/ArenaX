pub mod health;
pub mod match_authority_handler;
pub mod matchmaking;
#[deprecated(note = "Use realtime::user_ws instead for authenticated WebSocket connections")]
pub mod match_ws_handler;
pub mod notification_handler;
pub mod reputation_handler;

// TODO: Add more HTTP modules as implemented:
// pub mod auth;
// pub mod matches;
// pub mod tournaments;
