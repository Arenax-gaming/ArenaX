use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::{Match, MatchType, MatchStatus, QueueStatus, UserElo};
use chrono::{DateTime, Utc};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::time::{interval, timeout, Duration};
use uuid::Uuid;

// Redis key patterns
const QUEUE_KEY_PREFIX: &str = "queue";
const QUEUE_ENTRY_PREFIX: &str = "queue_entry";
/// Sorted-set key that tracks all active (game, game_mode) pairs so the
/// background worker never has to query the database on every tick.
const ACTIVE_MODES_KEY: &str = "matchmaking:active_modes";
const ELO_BUCKET_SIZE: i32 = 100;
const MAX_ELO_GAP: i32 = 500;
const MATCHMAKER_INTERVAL: Duration = Duration::from_secs(5);
/// Hard deadline for a single matchmaking processing cycle.
const PROCESS_TIMEOUT: Duration = Duration::from_millis(900);
const EXPANSION_INTERVALS: &[Duration] = &[
    Duration::from_secs(30),
    Duration::from_secs(60),
    Duration::from_secs(120),
    Duration::from_secs(300),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueEntry {
    pub user_id: Uuid,
    pub game: String,
    pub game_mode: String,
    pub current_elo: i32,
    pub min_elo: i32,
    pub max_elo: i32,
    pub joined_at: DateTime<Utc>,
    pub wait_time_multiplier: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchCandidate {
    pub player1: QueueEntry,
    pub player2: QueueEntry,
    pub match_quality: f64,
    pub elo_gap: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchmakingConfig {
    pub elo_bucket_size: i32,
    pub max_elo_gap: i32,
    pub expansion_intervals: Vec<Duration>,
    pub max_wait_time: Duration,
    pub min_players_per_match: usize,
    pub max_players_per_match: usize,
}

impl Default for MatchmakingConfig {
    fn default() -> Self {
        Self {
            elo_bucket_size: ELO_BUCKET_SIZE,
            max_elo_gap: MAX_ELO_GAP,
            expansion_intervals: EXPANSION_INTERVALS.to_vec(),
            max_wait_time: Duration::from_secs(600), // 10 minutes
            min_players_per_match: 2,
            max_players_per_match: 2,
        }
    }
}

/// Shared Redis connection manager — multiplexed, no per-request connection
/// establishment overhead.
pub type RedisConn = redis::aio::ConnectionManager;

pub struct MatchmakerService {
    db_pool: DbPool,
    /// Shared, multiplexed Redis connection.  All public methods borrow this
    /// instead of opening a new connection on every call.
    redis: RedisConn,
    config: MatchmakingConfig,
}

impl MatchmakerService {
    pub fn new(db_pool: DbPool, redis: RedisConn, config: MatchmakingConfig) -> Self {
        Self { db_pool, redis, config }
    }

    /// Return a clone of the shared Redis connection manager.
    /// Cloning a `ConnectionManager` is cheap — it shares the underlying
    /// multiplexed connection.
    pub fn redis_conn(&self) -> RedisConn {
        self.redis.clone()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Background worker
    // ─────────────────────────────────────────────────────────────────────────

    /// Start the background matchmaker worker.
    pub async fn start_matchmaker_worker(&self) -> Result<(), ApiError> {
        let mut ticker = interval(MATCHMAKER_INTERVAL);

        loop {
            ticker.tick().await;

            // Wrap each cycle in a hard timeout so a slow Redis/DB call can
            // never cause the worker to fall behind indefinitely.
            match timeout(PROCESS_TIMEOUT, self.process_matchmaking()).await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => tracing::error!("Matchmaker processing error: {:?}", e),
                Err(_) => tracing::warn!(
                    "Matchmaker processing cycle exceeded {:?} deadline — skipping tick",
                    PROCESS_TIMEOUT
                ),
            }
        }
    }

    /// Main matchmaking processing loop.
    async fn process_matchmaking(&self) -> Result<(), ApiError> {
        let mut conn = self.redis.clone();

        // Derive active (game, game_mode) pairs from Redis instead of hitting
        // the database on every 5-second tick.
        let active_modes = self.get_active_modes_from_redis(&mut conn).await?;

        for (game, game_mode) in active_modes {
            self.find_matches_for_game_mode(&mut conn, &game, &game_mode).await?;
        }

        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Match-finding
    // ─────────────────────────────────────────────────────────────────────────

    /// Find and create matches for a specific game mode.
    async fn find_matches_for_game_mode(
        &self,
        conn: &mut RedisConn,
        game: &str,
        game_mode: &str,
    ) -> Result<(), ApiError> {
        let queue_entries = self.get_queue_entries(conn, game, game_mode).await?;

        if queue_entries.len() < self.config.min_players_per_match {
            return Ok(());
        }

        // Sort by wait time (longest waiting first) so they get priority.
        let mut sorted_entries = queue_entries;
        sorted_entries.sort_by(|a, b| a.joined_at.cmp(&b.joined_at));

        let mut matches_found = Vec::new();
        let mut processed_players = std::collections::HashSet::new();

        for (i, entry) in sorted_entries.iter().enumerate() {
            if processed_players.contains(&entry.user_id) {
                continue;
            }

            if let Some(candidate) =
                find_best_match_for_player(entry, &sorted_entries[i..], &processed_players)
            {
                processed_players.insert(candidate.player1.user_id);
                processed_players.insert(candidate.player2.user_id);
                matches_found.push(candidate);
            }
        }

        for candidate in matches_found {
            self.create_match_from_candidate(&candidate).await?;
            self.remove_from_queue(conn, &candidate.player1.user_id, game, game_mode).await?;
            self.remove_from_queue(conn, &candidate.player2.user_id, game, game_mode).await?;
        }

        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Redis helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// Scan all `queue_entry:<game>:<game_mode>:*` keys without blocking Redis.
    /// Uses SCAN cursor iteration and fetches all values in a single MGET call.
    async fn get_queue_entries(
        &self,
        conn: &mut RedisConn,
        game: &str,
        game_mode: &str,
    ) -> Result<Vec<QueueEntry>, ApiError> {
        let pattern = format!("{}:{}:{}:*", QUEUE_ENTRY_PREFIX, game, game_mode);
        let keys = scan_keys(conn, &pattern).await?;

        if keys.is_empty() {
            return Ok(Vec::new());
        }

        // Fetch all values in one round-trip with MGET.
        let values: Vec<Option<String>> = redis::cmd("MGET")
            .arg(&keys)
            .query_async(conn)
            .await
            .map_err(|e| ApiError::internal_error(&format!("Redis MGET error: {}", e)))?;

        let entries = values
            .into_iter()
            .flatten()
            .filter_map(|json| serde_json::from_str::<QueueEntry>(&json).ok())
            .collect();

        Ok(entries)
    }

    /// Add a player to the matchmaking queue.
    pub async fn add_to_queue(
        &self,
        user_id: Uuid,
        game: String,
        game_mode: String,
        current_elo: i32,
    ) -> Result<(), ApiError> {
        let mut conn = self.redis.clone();
        let now = Utc::now();
        let (min_elo, max_elo) = self.calculate_initial_elo_range(current_elo);

        let entry = QueueEntry {
            user_id,
            game: game.clone(),
            game_mode: game_mode.clone(),
            current_elo,
            min_elo,
            max_elo,
            joined_at: now,
            wait_time_multiplier: 1.0,
        };

        let entry_key = format!("{}:{}:{}:{}", QUEUE_ENTRY_PREFIX, game, game_mode, user_id);
        let entry_json = serde_json::to_string(&entry)
            .map_err(|e| ApiError::internal_error(&format!("JSON serialization error: {}", e)))?;

        let elo_bucket = (current_elo / self.config.elo_bucket_size) * self.config.elo_bucket_size;
        let queue_key = format!("{}:{}:{}:{}", QUEUE_KEY_PREFIX, game, game_mode, elo_bucket);
        let active_mode_member = format!("{}:{}", game, game_mode);

        // Pipeline: SET entry + ZADD ELO bucket + SADD active-modes — 1 round-trip.
        let mut pipe = redis::pipe();
        pipe.cmd("SET")
            .arg(&entry_key)
            .arg(&entry_json)
            .arg("EX")
            .arg(600u64)
            .ignore()
            .cmd("ZADD")
            .arg(&queue_key)
            .arg(now.timestamp())
            .arg(user_id.to_string())
            .ignore()
            .cmd("SADD")
            .arg(ACTIVE_MODES_KEY)
            .arg(&active_mode_member)
            .ignore();

        pipe.query_async::<()>(&mut conn)
            .await
            .map_err(|e| ApiError::internal_error(&format!("Redis pipeline error: {}", e)))?;

        Ok(())
    }

    /// Remove a player from the matchmaking queue.
    pub async fn remove_from_queue(
        &self,
        conn: &mut RedisConn,
        user_id: &Uuid,
        game: &str,
        game_mode: &str,
    ) -> Result<(), ApiError> {
        let entry_key = format!("{}:{}:{}:{}", QUEUE_ENTRY_PREFIX, game, game_mode, user_id);

        // Find all ELO-bucket sorted-set keys for this game/mode via SCAN
        // (non-blocking), then remove the player from all of them in one pipeline.
        let bucket_pattern = format!("{}:{}:{}:*", QUEUE_KEY_PREFIX, game, game_mode);
        let bucket_keys = scan_keys(conn, &bucket_pattern).await?;

        let mut pipe = redis::pipe();
        pipe.cmd("DEL").arg(&entry_key).ignore();
        for bk in &bucket_keys {
            pipe.cmd("ZREM").arg(bk).arg(user_id.to_string()).ignore();
        }

        pipe.query_async::<()>(conn)
            .await
            .map_err(|e| ApiError::internal_error(&format!("Redis pipeline error: {}", e)))?;

        Ok(())
    }

    /// Return all active (game, game_mode) pairs tracked in Redis.
    async fn get_active_modes_from_redis(
        &self,
        conn: &mut RedisConn,
    ) -> Result<Vec<(String, String)>, ApiError> {
        let members: Vec<String> = conn
            .smembers(ACTIVE_MODES_KEY)
            .await
            .map_err(|e| ApiError::internal_error(&format!("Redis SMEMBERS error: {}", e)))?;

        let pairs = members
            .into_iter()
            .filter_map(|m| {
                let mut parts = m.splitn(2, ':');
                let game = parts.next()?.to_string();
                let mode = parts.next()?.to_string();
                Some((game, mode))
            })
            .collect();

        Ok(pairs)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API used by HTTP handlers
    // ─────────────────────────────────────────────────────────────────────────

    /// Check if a user is currently in the queue.
    pub async fn is_user_in_queue(
        &self,
        user_id: Uuid,
        game: &str,
        game_mode: &str,
    ) -> Result<Option<QueueEntry>, ApiError> {
        let mut conn = self.redis.clone();
        let key = format!("{}:{}:{}:{}", QUEUE_ENTRY_PREFIX, game, game_mode, user_id);

        let entry_json: Option<String> = conn
            .get(&key)
            .await
            .map_err(|e| ApiError::internal_error(&format!("Redis GET error: {}", e)))?;

        match entry_json {
            Some(json) => {
                let entry = serde_json::from_str(&json).map_err(|e| {
                    ApiError::internal_error(&format!("JSON deserialization error: {}", e))
                })?;
                Ok(Some(entry))
            }
            None => Ok(None),
        }
    }

    /// Return the number of players waiting in a specific queue.
    /// Uses SCAN instead of KEYS to avoid blocking Redis.
    pub async fn get_queue_size(&self, game: &str, game_mode: &str) -> Result<usize, ApiError> {
        let mut conn = self.redis.clone();
        let pattern = format!("{}:{}:{}:*", QUEUE_ENTRY_PREFIX, game, game_mode);
        let keys = scan_keys(&mut conn, &pattern).await?;
        Ok(keys.len())
    }

    /// Estimate wait time based on queue depth.
    /// Avoids a redundant SCAN by accepting the already-known queue size.
    pub fn estimate_wait_time_from_size(queue_size: usize, current_elo: i32) -> i32 {
        if queue_size <= 1 {
            // There's already someone to match with (or the queue is empty).
            return 30; // optimistic 30-second estimate
        }
        // Rough heuristic: ~30 seconds per pair ahead in the queue.
        let base = (queue_size / 2) as i32 * 30;
        let elo_penalty = if current_elo < 1000 || current_elo > 2000 { 60 } else { 0 };
        base + elo_penalty
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Database helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// Create a match record in the database.
    async fn create_match_from_candidate(&self, candidate: &MatchCandidate) -> Result<Match, ApiError> {
        let match_id = Uuid::new_v4();
        let now = Utc::now();

        let match_record: Match = sqlx::query_as!(
            Match,
            r#"
            INSERT INTO matches (
                id, tournament_id, round_id, match_type, status, player1_id, player2_id,
                player1_elo_before, player2_elo_before, game_mode, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
            ) RETURNING *
            "#,
            match_id,
            None::<Uuid>,
            None::<Uuid>,
            MatchType::Ranked as _,
            MatchStatus::Pending as _,
            candidate.player1.user_id,
            Some(candidate.player2.user_id),
            candidate.player1.current_elo,
            candidate.player2.current_elo,
            candidate.player1.game_mode,
            now,
            now
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        tracing::info!(
            "Created match {} between players {} and {} (ELO gap: {}, quality: {:.2})",
            match_id,
            candidate.player1.user_id,
            candidate.player2.user_id,
            candidate.elo_gap,
            candidate.match_quality
        );

        Ok(match_record)
    }

    fn calculate_initial_elo_range(&self, current_elo: i32) -> (i32, i32) {
        let range = self.config.elo_bucket_size;
        ((current_elo - range).max(0), current_elo + range)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure (sync) helpers — no async needed
// ─────────────────────────────────────────────────────────────────────────────

/// Find the best opponent for `player` from `candidates`.
/// This is pure CPU work — no I/O — so it does not need to be async.
fn find_best_match_for_player(
    player: &QueueEntry,
    candidates: &[QueueEntry],
    processed_players: &std::collections::HashSet<Uuid>,
) -> Option<MatchCandidate> {
    let mut best_candidate: Option<MatchCandidate> = None;
    let mut best_score = -1.0_f64;

    let max_gap = calculate_max_elo_gap(player);

    for candidate in candidates {
        if candidate.user_id == player.user_id
            || processed_players.contains(&candidate.user_id)
        {
            continue;
        }

        let elo_gap = (player.current_elo - candidate.current_elo).abs();
        if elo_gap > max_gap {
            continue;
        }

        let match_quality = calculate_match_quality(player, candidate, elo_gap);
        if match_quality > best_score {
            best_score = match_quality;
            best_candidate = Some(MatchCandidate {
                player1: player.clone(),
                player2: candidate.clone(),
                match_quality,
                elo_gap,
            });
        }
    }

    best_candidate
}

fn calculate_max_elo_gap(entry: &QueueEntry) -> i32 {
    let wait_seconds = Utc::now()
        .signed_duration_since(entry.joined_at)
        .num_seconds() as u64;

    let mut max_gap = ELO_BUCKET_SIZE;
    for interval in EXPANSION_INTERVALS {
        if wait_seconds > interval.as_secs() {
            max_gap = (max_gap * 2).min(MAX_ELO_GAP);
        }
    }
    max_gap
}

fn calculate_match_quality(player1: &QueueEntry, player2: &QueueEntry, elo_gap: i32) -> f64 {
    let elo_score = 1.0 - (elo_gap as f64 / MAX_ELO_GAP as f64);

    let wait1 = Utc::now()
        .signed_duration_since(player1.joined_at)
        .num_seconds() as f64;
    let wait2 = Utc::now()
        .signed_duration_since(player2.joined_at)
        .num_seconds() as f64;
    let wait_bonus = ((wait1 + wait2) / 2.0 / 600.0).min(0.5);

    elo_score + wait_bonus
}

/// Non-blocking SCAN over the Redis keyspace.  Returns all keys matching
/// `pattern` without ever calling the blocking KEYS command.
async fn scan_keys(conn: &mut RedisConn, pattern: &str) -> Result<Vec<String>, ApiError> {
    let mut keys = Vec::new();
    let mut cursor: u64 = 0;

    loop {
        let (next_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(pattern)
            .arg("COUNT")
            .arg(100u64)
            .query_async(conn)
            .await
            .map_err(|e| ApiError::internal_error(&format!("Redis SCAN error: {}", e)))?;

        keys.extend(batch);
        cursor = next_cursor;

        if cursor == 0 {
            break;
        }
    }

    Ok(keys)
}

// ─────────────────────────────────────────────────────────────────────────────
// ELO calculation engine
// ─────────────────────────────────────────────────────────────────────────────

pub struct EloEngine {
    k_factor: f64,
}

impl EloEngine {
    pub fn new(k_factor: f64) -> Self {
        Self { k_factor }
    }

    pub fn calculate_elo_change(
        &self,
        player1_elo: i32,
        player2_elo: i32,
        winner_id: Option<Uuid>,
        player1_id: Uuid,
        player2_id: Uuid,
    ) -> (i32, i32) {
        let expected_p1 =
            1.0 / (1.0 + 10.0_f64.powf((player2_elo - player1_elo) as f64 / 400.0));
        let expected_p2 = 1.0 - expected_p1;

        let (actual_p1, actual_p2) = match winner_id {
            Some(w) if w == player1_id => (1.0, 0.0),
            Some(w) if w == player2_id => (0.0, 1.0),
            _ => (0.5, 0.5),
        };

        let new_p1 = player1_elo + (self.k_factor * (actual_p1 - expected_p1)) as i32;
        let new_p2 = player2_elo + (self.k_factor * (actual_p2 - expected_p2)) as i32;
        (new_p1, new_p2)
    }

    pub async fn update_elo_ratings(
        &self,
        db_pool: &DbPool,
        match_id: Uuid,
        winner_id: Option<Uuid>,
    ) -> Result<(), ApiError> {
        let match_record = sqlx::query_as!(Match, "SELECT * FROM matches WHERE id = $1", match_id)
            .fetch_one(db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

        let (new_elo1, new_elo2) = self.calculate_elo_change(
            match_record.player1_elo_before,
            match_record.player2_elo_before.unwrap_or(1200),
            winner_id,
            match_record.player1_id,
            match_record.player2_id.unwrap_or_default(),
        );

        sqlx::query!(
            "UPDATE user_elo SET current_rating = $1, updated_at = $2 WHERE user_id = $3 AND game = $4",
            new_elo1,
            Utc::now(),
            match_record.player1_id,
            match_record.game_mode
        )
        .execute(db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if let Some(p2_id) = match_record.player2_id {
            sqlx::query!(
                "UPDATE user_elo SET current_rating = $1, updated_at = $2 WHERE user_id = $3 AND game = $4",
                new_elo2,
                Utc::now(),
                p2_id,
                match_record.game_mode
            )
            .execute(db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        }

        self.create_elo_history(
            db_pool,
            match_record.player1_id,
            &match_record.game_mode,
            match_record.player1_elo_before,
            new_elo1,
            match_id,
        )
        .await?;

        if let Some(p2_id) = match_record.player2_id {
            self.create_elo_history(
                db_pool,
                p2_id,
                &match_record.game_mode,
                match_record.player2_elo_before.unwrap_or(1200),
                new_elo2,
                match_id,
            )
            .await?;
        }

        Ok(())
    }

    async fn create_elo_history(
        &self,
        db_pool: &DbPool,
        user_id: Uuid,
        game: &str,
        old_elo: i32,
        new_elo: i32,
        match_id: Uuid,
    ) -> Result<(), ApiError> {
        sqlx::query!(
            "INSERT INTO elo_history (user_id, game, old_rating, new_rating, change_amount, match_id, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
            user_id,
            game,
            old_elo,
            new_elo,
            new_elo - old_elo,
            match_id,
            Utc::now()
        )
        .execute(db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }
}
