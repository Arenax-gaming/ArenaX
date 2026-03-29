use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::{Match, MatchType, MatchStatus, QueueStatus, UserElo};
use chrono::{DateTime, Utc};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::time::{interval, Duration};
use uuid::Uuid;

// Redis key patterns
const QUEUE_KEY_PREFIX: &str = "queue";
const QUEUE_ENTRY_PREFIX: &str = "queue_entry";
const ELO_BUCKET_SIZE: i32 = 100;
const MAX_ELO_GAP: i32 = 500;
const MATCHMAKER_INTERVAL: Duration = Duration::from_secs(5);
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

pub struct MatchmakerService {
    db_pool: DbPool,
    redis_client: redis::Client,
    config: MatchmakingConfig,
}

impl MatchmakerService {
    pub fn new(db_pool: DbPool, redis_client: redis::Client, config: MatchmakingConfig) -> Self {
        Self {
            db_pool,
            redis_client,
            config,
        }
    }

    /// Start the background matchmaker worker
    pub async fn start_matchmaker_worker(&self) -> Result<(), ApiError> {
        let mut interval = interval(MATCHMAKER_INTERVAL);
        
        loop {
            interval.tick().await;
            
            if let Err(e) = self.process_matchmaking().await {
                tracing::error!("Matchmaker processing error: {:?}", e);
            }
        }
    }

    /// Main matchmaking processing loop
    async fn process_matchmaking(&self) -> Result<(), ApiError> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await
            .map_err(|e| ApiError::internal_error(&format!("Redis connection error: {}", e)))?;

        // Get all active games
        let active_games = self.get_active_games().await?;
        
        for game in active_games {
            // Process each game mode
            let game_modes = self.get_active_game_modes(&game).await?;
            
            for game_mode in game_modes {
                // Find matches for this game/mode combination
                self.find_matches_for_game_mode(&mut conn, &game, &game_mode).await?;
            }
        }

        Ok(())
    }

    /// Find and create matches for a specific game mode
    async fn find_matches_for_game_mode(
        &self,
        conn: &mut redis::aio::MultiplexedConnection,
        game: &str,
        game_mode: &str,
    ) -> Result<(), ApiError> {
        // Get all queue entries for this game/mode
        let queue_entries = self.get_queue_entries(conn, game, game_mode).await?;
        
        if queue_entries.len() < self.config.min_players_per_match {
            return Ok(());
        }

        // Sort by wait time (longest waiting first)
        let mut sorted_entries = queue_entries;
        sorted_entries.sort_by(|a, b| a.joined_at.cmp(&b.joined_at));

        // Find matches using dynamic ELO range expansion
        let mut matches_found = Vec::new();
        let mut processed_players = std::collections::HashSet::new();

        for (i, entry) in sorted_entries.iter().enumerate() {
            if processed_players.contains(&entry.user_id) {
                continue;
            }

            // Find best match for this player
            if let Some(candidate) = self.find_best_match_for_player(entry, &sorted_entries[i..], &processed_players).await {
                matches_found.push(candidate);
                processed_players.insert(candidate.player1.user_id);
                processed_players.insert(candidate.player2.user_id);
            }
        }

        // Create matches in database
        for candidate in matches_found {
            self.create_match_from_candidate(candidate).await?;
            
            // Remove players from queue
            self.remove_from_queue(conn, &candidate.player1.user_id, game, game_mode).await?;
            self.remove_from_queue(conn, &candidate.player2.user_id, game, game_mode).await?;
        }

        Ok(())
    }

    /// Find the best match for a player considering ELO gap and wait time
    async fn find_best_match_for_player(
        &self,
        player: &QueueEntry,
        candidates: &[QueueEntry],
        processed_players: &std::collections::HashSet<Uuid>,
    ) -> Option<MatchCandidate> {
        let mut best_candidate: Option<MatchCandidate> = None;
        let mut best_score = -1.0;

        for candidate in candidates {
            if candidate.user_id == player.user_id || processed_players.contains(&candidate.user_id) {
                continue;
            }

            // Calculate ELO gap
            let elo_gap = (player.current_elo - candidate.current_elo).abs();
            
            // Skip if ELO gap exceeds maximum for current wait time
            let max_gap = self.calculate_max_elo_gap(player);
            if elo_gap > max_gap {
                continue;
            }

            // Calculate match quality score (0.0 to 1.0)
            let match_quality = self.calculate_match_quality(player, candidate, elo_gap);
            
            // Update best candidate if this is better
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

    /// Calculate maximum ELO gap based on wait time (dynamic expansion)
    fn calculate_max_elo_gap(&self, entry: &QueueEntry) -> i32 {
        let wait_time = Utc::now().signed_duration_since(entry.joined_at);
        let wait_seconds = wait_time.num_seconds() as u64;

        let mut max_gap = self.config.elo_bucket_size;
        
        for interval in &self.config.expansion_intervals {
            if wait_seconds > interval.as_secs() {
                max_gap = (max_gap * 2).min(self.config.max_elo_gap);
            }
        }

        max_gap
    }

    /// Calculate match quality score based on ELO gap and wait time
    fn calculate_match_quality(&self, player1: &QueueEntry, player2: &QueueEntry, elo_gap: i32) -> f64 {
        // ELO compatibility (0.0 to 1.0, higher is better)
        let elo_score = 1.0 - (elo_gap as f64 / self.config.max_elo_gap as f64);
        
        // Wait time bonus (0.0 to 0.5, longer wait gets higher bonus)
        let wait_time1 = Utc::now().signed_duration_since(player1.joined_at).num_seconds() as f64;
        let wait_time2 = Utc::now().signed_duration_since(player2.joined_at).num_seconds() as f64;
        let avg_wait_time = (wait_time1 + wait_time2) / 2.0;
        let wait_bonus = (avg_wait_time / 600.0).min(0.5); // Max 0.5 bonus after 10 minutes

        elo_score + wait_bonus
    }

    /// Get all queue entries for a specific game and mode
    async fn get_queue_entries(
        &self,
        conn: &mut redis::aio::MultiplexedConnection,
        game: &str,
        game_mode: &str,
    ) -> Result<Vec<QueueEntry>, ApiError> {
        let pattern = format!("{}:{}:*", QUEUE_ENTRY_PREFIX, game, game_mode);
        let keys: Vec<String> = conn.keys(&pattern).await
            .map_err(|e| ApiError::internal_error(&format!("Redis keys error: {}", e)))?;

        let mut entries = Vec::new();
        
        for key in keys {
            let entry_json: String = conn.get(&key).await
                .map_err(|e| ApiError::internal_error(&format!("Redis get error: {}", e)))?;
            
            if let Ok(entry) = serde_json::from_str::<QueueEntry>(&entry_json) {
                entries.push(entry);
            }
        }

        Ok(entries)
    }

    /// Add player to matchmaking queue
    pub async fn add_to_queue(
        &self,
        user_id: Uuid,
        game: String,
        game_mode: String,
        current_elo: i32,
    ) -> Result<(), ApiError> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await
            .map_err(|e| ApiError::internal_error(&format!("Redis connection error: {}", e)))?;

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

        // Store in Redis
        let key = format!("{}:{}:{}:{}", QUEUE_ENTRY_PREFIX, game, game_mode, user_id);
        let entry_json = serde_json::to_string(&entry)
            .map_err(|e| ApiError::internal_error(&format!("JSON serialization error: {}", e)))?;

        conn.set_ex(&key, entry_json, 600).await // 10 minute TTL
            .map_err(|e| ApiError::internal_error(&format!("Redis set error: {}", e)))?;

        // Add to sorted set for efficient ELO-based queries
        let elo_bucket = (current_elo / self.config.elo_bucket_size) * self.config.elo_bucket_size;
        let queue_key = format!("{}:{}:{}:{}", QUEUE_KEY_PREFIX, game, game_mode, elo_bucket);
        
        conn.zadd(&queue_key, &user_id.to_string(), now.timestamp()).await
            .map_err(|e| ApiError::internal_error(&format!("Redis zadd error: {}", e)))?;

        Ok(())
    }

    /// Remove player from matchmaking queue
    async fn remove_from_queue(
        &self,
        conn: &mut redis::aio::MultiplexedConnection,
        user_id: &Uuid,
        game: &str,
        game_mode: &str,
    ) -> Result<(), ApiError> {
        // Remove from entry storage
        let key = format!("{}:{}:{}:{}", QUEUE_ENTRY_PREFIX, game, game_mode, user_id);
        conn.del(&key).await
            .map_err(|e| ApiError::internal_error(&format!("Redis del error: {}", e)))?;

        // Remove from all ELO buckets
        let pattern = format!("{}:{}:{}:*", QUEUE_KEY_PREFIX, game, game_mode);
        let keys: Vec<String> = conn.keys(&pattern).await
            .map_err(|e| ApiError::internal_error(&format!("Redis keys error: {}", e)))?;

        for key in keys {
            conn.zrem(&key, &user_id.to_string()).await
                .map_err(|e| ApiError::internal_error(&format!("Redis zrem error: {}", e)))?;
        }

        Ok(())
    }

    /// Calculate initial ELO range for a player
    fn calculate_initial_elo_range(&self, current_elo: i32) -> (i32, i32) {
        let range = self.config.elo_bucket_size;
        (
            (current_elo - range).max(0),
            current_elo + range,
        )
    }

    /// Create match in database from candidate
    async fn create_match_from_candidate(&self, candidate: MatchCandidate) -> Result<Match, ApiError> {
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

    /// Get all active games in the queue
    async fn get_active_games(&self) -> Result<Vec<String>, ApiError> {
        let games = sqlx::query!("SELECT DISTINCT game FROM matchmaking_queue WHERE status = $1", QueueStatus::Waiting as _)
            .fetch_all(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

        Ok(games.into_iter().map(|g| g.game).collect())
    }

    /// Get active game modes for a specific game
    async fn get_active_game_modes(&self, game: &str) -> Result<Vec<String>, ApiError> {
        let modes = sqlx::query!(
            "SELECT DISTINCT game_mode FROM matchmaking_queue WHERE game = $1 AND status = $2",
            game,
            QueueStatus::Waiting as _
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(modes.into_iter().map(|m| m.game_mode).collect())
    }

    /// Check if user is in queue
    pub async fn is_user_in_queue(
        &self,
        user_id: Uuid,
        game: &str,
        game_mode: &str,
    ) -> Result<Option<QueueEntry>, ApiError> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await
            .map_err(|e| ApiError::internal_error(&format!("Redis connection error: {}", e)))?;

        let key = format!("{}:{}:{}:{}", QUEUE_ENTRY_PREFIX, game, game_mode, user_id);
        let entry_json: Option<String> = conn.get(&key).await
            .map_err(|e| ApiError::internal_error(&format!("Redis get error: {}", e)))?;

        match entry_json {
            Some(json) => {
                let entry = serde_json::from_str(&json)
                    .map_err(|e| ApiError::internal_error(&format!("JSON deserialization error: {}", e)))?;
                Ok(Some(entry))
            }
            None => Ok(None),
        }
    }

    /// Get queue size for a specific game and mode
    pub async fn get_queue_size(&self, game: &str, game_mode: &str) -> Result<usize, ApiError> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await
            .map_err(|e| ApiError::internal_error(&format!("Redis connection error: {}", e)))?;

        let pattern = format!("{}:{}:{}:*", QUEUE_ENTRY_PREFIX, game, game_mode);
        let keys: Vec<String> = conn.keys(&pattern).await
            .map_err(|e| ApiError::internal_error(&format!("Redis keys error: {}", e)))?;

        Ok(keys.len())
    }

    /// Get estimated wait time for a player
    pub async fn get_estimated_wait_time(
        &self,
        user_id: Uuid,
        game: &str,
        game_mode: &str,
    ) -> Result<i32, ApiError> {
        let queue_size = self.get_queue_size(game, game_mode).await?;
        
        // Rough estimation: 2 minutes per person in queue ahead
        Ok((queue_size as i32) * 120)
    }
}

// ELO calculation engine
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
        // Calculate expected scores
        let expected_player1 = 1.0 / (1.0 + 10.0_f64.powf((player2_elo - player1_elo) as f64 / 400.0));
        let expected_player2 = 1.0 - expected_player1;

        // Determine actual scores
        let (actual_player1, actual_player2) = match winner_id {
            Some(winner) => {
                if winner == player1_id {
                    (1.0, 0.0)
                } else if winner == player2_id {
                    (0.0, 1.0)
                } else {
                    (0.5, 0.5) // Draw
                }
            }
            None => (0.5, 0.5), // Draw
        };

        // Calculate new ELO ratings
        let new_player1_elo = player1_elo + (self.k_factor * (actual_player1 - expected_player1)) as i32;
        let new_player2_elo = player2_elo + (self.k_factor * (actual_player2 - expected_player2)) as i32;

        (new_player1_elo, new_player2_elo)
    }

    pub async fn update_elo_ratings(
        &self,
        db_pool: &DbPool,
        match_id: Uuid,
        winner_id: Option<Uuid>,
    ) -> Result<(), ApiError> {
        // Get match details
        let match_record = sqlx::query_as!(Match, "SELECT * FROM matches WHERE id = $1", match_id)
            .fetch_one(db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

        // Calculate ELO changes
        let (new_elo1, new_elo2) = self.calculate_elo_change(
            match_record.player1_elo_before,
            match_record.player2_elo_before.unwrap_or(1200),
            winner_id,
            match_record.player1_id,
            match_record.player2_id.unwrap_or_default(),
        );

        // Update player 1 ELO
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

        // Update player 2 ELO if present
        if let Some(player2_id) = match_record.player2_id {
            sqlx::query!(
                "UPDATE user_elo SET current_rating = $1, updated_at = $2 WHERE user_id = $3 AND game = $4",
                new_elo2,
                Utc::now(),
                player2_id,
                match_record.game_mode
            )
            .execute(db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        }

        // Create ELO history records
        self.create_elo_history(db_pool, match_record.player1_id, &match_record.game_mode, 
                               match_record.player1_elo_before, new_elo1, match_id).await?;
        
        if let Some(player2_id) = match_record.player2_id {
            self.create_elo_history(db_pool, player2_id, &match_record.game_mode,
                                   match_record.player2_elo_before.unwrap_or(1200), new_elo2, match_id).await?;
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
            "INSERT INTO elo_history (user_id, game, old_rating, new_rating, change_amount, match_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
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
