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
    MatchmakingMetricsUpdate {
        dashboard: serde_json::Value,
        timestamp: String,
    },
    /// Incremental leaderboard update (Issue #900).
    ///
    /// Carries only the entries whose position moved, never the whole board.
    ///
    /// # Client merge contract
    ///
    /// The client keeps its own copy of the board and patches it:
    ///
    /// 1. If `version` is not exactly one greater than the last version seen
    ///    for this `category`, a delta was missed — discard the local board and
    ///    re-fetch it from the REST endpoint. Patching across a gap silently
    ///    corrupts the board, so a gap must never be applied.
    /// 2. For each change, replace the entry for `user_id` with the new
    ///    `ranking` and `elo_rating`, inserting it if the player was not on the
    ///    board before (`previous_ranking` is `None`).
    /// 3. Re-sort by `ranking` ascending.
    ///
    /// `previous_ranking` is informational — it is what the client last saw,
    /// which is what makes a "moved up 3 places" animation correct even when
    /// several moves were coalesced into one change.
    LeaderboardDelta {
        category: String,
        /// Monotonic per-category sequence number. See the merge contract.
        version: u64,
        changes: Vec<RankChange>,
        timestamp: String,
    },
}

/// One player's movement on the leaderboard.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RankChange {
    pub user_id: Uuid,
    pub ranking: i32,
    /// The rank the client last saw, or `None` for a player entering the board.
    pub previous_ranking: Option<i32>,
    pub elo_rating: i32,
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
    pub const LEADERBOARD_CHANNEL_PATTERN: &str = "leaderboard:*";
    pub const MATCHMAKING_METRICS_CHANNEL: &str = "matchmaking:metrics";

    pub fn user_channel(user_id: Uuid) -> String {
        format!("user:{}", user_id)
    }

    pub fn match_channel(match_id: Uuid) -> String {
        format!("match:{}", match_id)
    }

    /// Channel carrying leaderboard deltas for one game category.
    ///
    /// Per-category rather than one global channel: a client watching the FIFA
    /// board has no use for Call of Duty rank churn, and fanning both out to
    /// everyone is the cost this whole delta scheme exists to avoid.
    pub fn leaderboard_channel(category: &str) -> String {
        format!("leaderboard:{}", category)
    }
}
