pub mod anti_bot_handler;
pub audit_handler;
pub mod auth_handler;
pub mod feature_flag_handler;
pub mod health;
pub mod idempotency;
pub mod idempotency_examples;
pub mod achievement_handler;
pub mod docs_handler;
pub mod ip_list_handler;
pub mod leaderboard_handler;
pub mod match_authority_handler;
pub mod matchmaking;
#[deprecated(note = "Use realtime::user_ws instead for authenticated WebSocket connections")]
pub mod match_ws_handler;
pub mod notification_handler;
pub mod player_stats_handler;
pub mod reputation_handler;
pub mod social_handler;
pub mod staking_handler;
pub mod analytics_handler;
pub mod tournament_handler;
pub mod gas_estimation_handler;

// Stellar transaction retry support (issue: backend retry logic)
pub mod retry_admin_handler;
pub mod dead_letter_queue_handler;
pub mod webhook_handler;

// TODO: Add more Channel modules as implemented:
// pub mod auth;
// pub mod matches;
// pub mod tournaments;
