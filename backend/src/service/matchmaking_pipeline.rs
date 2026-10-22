//! Store-agnostic matchmaking pipeline: queue -> match -> result -> leaderboard.
//!
//! [`MatchmakerService`](crate::service::matchmaker::MatchmakerService) is
//! bound to Postgres and a live Redis connection. This module drives the same
//! pairing rules ([`pair_queue_entries`]) and ELO engine ([`EloEngine`])
//! through small storage traits, so the full pipeline can run against the
//! in-memory stores below for deterministic end-to-end tests (#1421).

use crate::service::matchmaker::{
    pair_queue_entries, queue_entry_key, queue_entry_prefix, EloEngine, MatchmakingConfig,
    QueueEntry,
};
use chrono::Utc;
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use thiserror::Error;
use uuid::Uuid;

pub const DEFAULT_RATING: i32 = 1200;
pub const DEFAULT_K_FACTOR: f64 = 32.0;

#[derive(Debug, Error, PartialEq)]
pub enum PipelineError {
    #[error("player is already queued")]
    AlreadyQueued,
    #[error("match not found")]
    MatchNotFound,
    #[error("match already completed")]
    MatchAlreadyCompleted,
    #[error("winner is not a participant of this match")]
    InvalidWinner,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipelineMatchStatus {
    Pending,
    Completed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MatchRecord {
    pub id: Uuid,
    pub game: String,
    pub game_mode: String,
    pub player1_id: Uuid,
    pub player2_id: Uuid,
    pub player1_elo_before: i32,
    pub player2_elo_before: i32,
    pub player1_elo_after: Option<i32>,
    pub player2_elo_after: Option<i32>,
    pub winner_id: Option<Uuid>,
    pub status: PipelineMatchStatus,
}

/// Queue storage (Redis in production).
pub trait QueueStore {
    fn put(&self, entry: &QueueEntry);
    fn get(&self, user_id: &Uuid, game: &str, game_mode: &str) -> Option<QueueEntry>;
    fn entries(&self, game: &str, game_mode: &str) -> Vec<QueueEntry>;
    fn remove(&self, user_id: &Uuid, game: &str, game_mode: &str);
}

/// Match storage (`matches` table in production).
pub trait MatchStore {
    fn insert(&self, record: MatchRecord);
    fn get(&self, id: &Uuid) -> Option<MatchRecord>;
    fn update(&self, record: MatchRecord);
}

/// Rating storage (`user_elo` table in production).
pub trait RatingStore {
    fn rating(&self, user_id: &Uuid, game: &str) -> Option<i32>;
    fn set_rating(&self, user_id: Uuid, game: &str, rating: i32);
}

/// Leaderboard storage, ranked by rating (highest first).
pub trait LeaderboardStore {
    fn upsert(&self, game: &str, user_id: Uuid, rating: i32);
    /// 1-based rank of `user_id`, if present.
    fn rank(&self, game: &str, user_id: &Uuid) -> Option<usize>;
    fn standings(&self, game: &str) -> Vec<(Uuid, i32)>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stores
// ─────────────────────────────────────────────────────────────────────────────

/// In-memory stand-in for Redis: queue entries are stored as JSON under the
/// same `queue_entry:<game>:<mode>:<user>` keys the matchmaker writes.
#[derive(Default)]
pub struct InMemoryQueueStore {
    keys: Mutex<BTreeMap<String, String>>,
}

impl QueueStore for InMemoryQueueStore {
    fn put(&self, entry: &QueueEntry) {
        let key = queue_entry_key(&entry.game, &entry.game_mode, &entry.user_id);
        let json = serde_json::to_string(entry).expect("queue entry serializes");
        self.keys.lock().unwrap().insert(key, json);
    }

    fn get(&self, user_id: &Uuid, game: &str, game_mode: &str) -> Option<QueueEntry> {
        let key = queue_entry_key(game, game_mode, user_id);
        self.keys
            .lock()
            .unwrap()
            .get(&key)
            .and_then(|json| serde_json::from_str(json).ok())
    }

    fn entries(&self, game: &str, game_mode: &str) -> Vec<QueueEntry> {
        let prefix = queue_entry_prefix(game, game_mode);
        self.keys
            .lock()
            .unwrap()
            .iter()
            .filter(|(k, _)| k.starts_with(&prefix))
            .filter_map(|(_, json)| serde_json::from_str(json).ok())
            .collect()
    }

    fn remove(&self, user_id: &Uuid, game: &str, game_mode: &str) {
        let key = queue_entry_key(game, game_mode, user_id);
        self.keys.lock().unwrap().remove(&key);
    }
}

#[derive(Default)]
pub struct InMemoryMatchStore {
    matches: Mutex<HashMap<Uuid, MatchRecord>>,
}

impl MatchStore for InMemoryMatchStore {
    fn insert(&self, record: MatchRecord) {
        self.matches.lock().unwrap().insert(record.id, record);
    }

    fn get(&self, id: &Uuid) -> Option<MatchRecord> {
        self.matches.lock().unwrap().get(id).cloned()
    }

    fn update(&self, record: MatchRecord) {
        self.insert(record);
    }
}

#[derive(Default)]
pub struct InMemoryRatingStore {
    ratings: Mutex<HashMap<(Uuid, String), i32>>,
}

impl RatingStore for InMemoryRatingStore {
    fn rating(&self, user_id: &Uuid, game: &str) -> Option<i32> {
        self.ratings
            .lock()
            .unwrap()
            .get(&(*user_id, game.to_string()))
            .copied()
    }

    fn set_rating(&self, user_id: Uuid, game: &str, rating: i32) {
        self.ratings
            .lock()
            .unwrap()
            .insert((user_id, game.to_string()), rating);
    }
}

#[derive(Default)]
pub struct InMemoryLeaderboard {
    boards: Mutex<HashMap<String, HashMap<Uuid, i32>>>,
}

impl LeaderboardStore for InMemoryLeaderboard {
    fn upsert(&self, game: &str, user_id: Uuid, rating: i32) {
        self.boards
            .lock()
            .unwrap()
            .entry(game.to_string())
            .or_default()
            .insert(user_id, rating);
    }

    fn rank(&self, game: &str, user_id: &Uuid) -> Option<usize> {
        self.standings(game)
            .iter()
            .position(|(id, _)| id == user_id)
            .map(|i| i + 1)
    }

    fn standings(&self, game: &str) -> Vec<(Uuid, i32)> {
        let mut rows: Vec<(Uuid, i32)> = self
            .boards
            .lock()
            .unwrap()
            .get(game)
            .map(|b| b.iter().map(|(id, r)| (*id, *r)).collect())
            .unwrap_or_default();
        // Highest rating first; user id breaks ties deterministically.
        rows.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        rows
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline
// ─────────────────────────────────────────────────────────────────────────────

pub struct MatchmakingPipeline<Q, M, R, L> {
    queue: Q,
    matches: M,
    ratings: R,
    leaderboard: L,
    elo: EloEngine,
    config: MatchmakingConfig,
}

pub type InMemoryMatchmakingPipeline = MatchmakingPipeline<
    InMemoryQueueStore,
    InMemoryMatchStore,
    InMemoryRatingStore,
    InMemoryLeaderboard,
>;

impl InMemoryMatchmakingPipeline {
    pub fn in_memory() -> Self {
        Self::new(
            InMemoryQueueStore::default(),
            InMemoryMatchStore::default(),
            InMemoryRatingStore::default(),
            InMemoryLeaderboard::default(),
            DEFAULT_K_FACTOR,
        )
    }
}

impl<Q, M, R, L> MatchmakingPipeline<Q, M, R, L>
where
    Q: QueueStore,
    M: MatchStore,
    R: RatingStore,
    L: LeaderboardStore,
{
    pub fn new(queue: Q, matches: M, ratings: R, leaderboard: L, k_factor: f64) -> Self {
        Self {
            queue,
            matches,
            ratings,
            leaderboard,
            elo: EloEngine::new(k_factor),
            config: MatchmakingConfig::default(),
        }
    }

    pub fn queue(&self) -> &Q {
        &self.queue
    }

    pub fn matches(&self) -> &M {
        &self.matches
    }

    pub fn ratings(&self) -> &R {
        &self.ratings
    }

    pub fn leaderboard(&self) -> &L {
        &self.leaderboard
    }

    /// Seed a player's rating and leaderboard entry.
    pub fn register_player(&self, user_id: Uuid, game: &str, rating: i32) {
        self.ratings.set_rating(user_id, game, rating);
        self.leaderboard.upsert(game, user_id, rating);
    }

    pub fn rating(&self, user_id: &Uuid, game: &str) -> i32 {
        self.ratings.rating(user_id, game).unwrap_or(DEFAULT_RATING)
    }

    pub fn rank(&self, user_id: &Uuid, game: &str) -> Option<usize> {
        self.leaderboard.rank(game, user_id)
    }

    /// Add a player to the queue at their current rating.
    pub fn enqueue(
        &self,
        user_id: Uuid,
        game: &str,
        game_mode: &str,
    ) -> Result<QueueEntry, PipelineError> {
        if self.queue.get(&user_id, game, game_mode).is_some() {
            return Err(PipelineError::AlreadyQueued);
        }

        let current_elo = self.rating(&user_id, game);
        let range = self.config.elo_bucket_size;
        let entry = QueueEntry {
            user_id,
            game: game.to_string(),
            game_mode: game_mode.to_string(),
            current_elo,
            min_elo: (current_elo - range).max(0),
            max_elo: current_elo + range,
            joined_at: Utc::now(),
            wait_time_multiplier: 1.0,
        };
        self.queue.put(&entry);
        Ok(entry)
    }

    /// Run one matchmaking cycle for a queue, creating pending matches and
    /// removing matched players from the queue.
    pub fn run_matchmaking(&self, game: &str, game_mode: &str) -> Vec<MatchRecord> {
        let entries = self.queue.entries(game, game_mode);
        if entries.len() < self.config.min_players_per_match {
            return Vec::new();
        }

        pair_queue_entries(entries)
            .into_iter()
            .map(|candidate| {
                let record = MatchRecord {
                    id: Uuid::new_v4(),
                    game: game.to_string(),
                    game_mode: game_mode.to_string(),
                    player1_id: candidate.player1.user_id,
                    player2_id: candidate.player2.user_id,
                    player1_elo_before: candidate.player1.current_elo,
                    player2_elo_before: candidate.player2.current_elo,
                    player1_elo_after: None,
                    player2_elo_after: None,
                    winner_id: None,
                    status: PipelineMatchStatus::Pending,
                };
                self.matches.insert(record.clone());
                self.queue
                    .remove(&candidate.player1.user_id, game, game_mode);
                self.queue
                    .remove(&candidate.player2.user_id, game, game_mode);
                record
            })
            .collect()
    }

    /// Record a match result (`None` = draw), apply ELO changes to both
    /// players and update the leaderboard immediately.
    pub fn report_result(
        &self,
        match_id: Uuid,
        winner_id: Option<Uuid>,
    ) -> Result<MatchRecord, PipelineError> {
        let mut record = self
            .matches
            .get(&match_id)
            .ok_or(PipelineError::MatchNotFound)?;

        if record.status == PipelineMatchStatus::Completed {
            return Err(PipelineError::MatchAlreadyCompleted);
        }
        if let Some(w) = winner_id {
            if w != record.player1_id && w != record.player2_id {
                return Err(PipelineError::InvalidWinner);
            }
        }

        let (new_p1, new_p2) = self.elo.calculate_elo_change(
            record.player1_elo_before,
            record.player2_elo_before,
            winner_id,
            record.player1_id,
            record.player2_id,
        );

        self.ratings.set_rating(record.player1_id, &record.game, new_p1);
        self.ratings.set_rating(record.player2_id, &record.game, new_p2);
        self.leaderboard.upsert(&record.game, record.player1_id, new_p1);
        self.leaderboard.upsert(&record.game, record.player2_id, new_p2);

        record.player1_elo_after = Some(new_p1);
        record.player2_elo_after = Some(new_p2);
        record.winner_id = winner_id;
        record.status = PipelineMatchStatus::Completed;
        self.matches.update(record.clone());

        Ok(record)
    }
}
