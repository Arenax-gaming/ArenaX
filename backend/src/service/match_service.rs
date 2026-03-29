#![allow(dead_code)]

use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::match_models::*;
use crate::models::user::User;
use crate::service::reputation_service::ReputationService;
use chrono::{DateTime, Duration, Utc};
use redis::Client as RedisClient;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

// ===== Service-local response types =====

#[derive(Debug, Serialize, Deserialize)]
pub struct MatchHistoryResponse {
    pub matches: Vec<MatchResponse>,
    pub total: i64,
    pub page: i32,
    pub per_page: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LeaderboardResponse {
    pub entries: Vec<LeaderboardEntry>,
    pub total: i64,
    pub game: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LeaderboardEntry {
    pub rank: i64,
    pub user_id: Uuid,
    pub username: String,
    pub elo_rating: i32,
    pub games_played: i32,
    pub wins: i32,
    pub losses: i32,
    pub win_rate: f64,
}

pub struct MatchService {
    db_pool: DbPool,
    redis_client: Option<Arc<RedisClient>>,
    reputation_service: Option<Arc<ReputationService>>,
    event_bus: Option<crate::realtime::event_bus::EventBus>,
}

impl MatchService {
    pub fn new(db_pool: DbPool) -> Self {
        Self {
            db_pool,
            redis_client: None,
            reputation_service: None,
            event_bus: None,
        }
    }

    pub fn with_event_bus(mut self, event_bus: crate::realtime::event_bus::EventBus) -> Self {
        self.event_bus = Some(event_bus);
        self
    }

    pub fn with_reputation_service(mut self, reputation_service: ReputationService) -> Self {
        self.reputation_service = Some(Arc::new(reputation_service));
        self
    }

    // ========================================================================
    // MATCHMAKING
    // ========================================================================

    /// Join the matchmaking queue
    pub async fn join_matchmaking(
        &self,
        user_id: Uuid,
        request: JoinMatchmakingRequest,
    ) -> Result<MatchmakingQueue, ApiError> {
        // Check if user is already in queue
        let existing = sqlx::query_as::<_, MatchmakingQueue>(
            "SELECT * FROM matchmaking_queue WHERE user_id = $1 AND status = $2",
        )
        .bind(user_id)
        .bind(QueueStatus::Waiting)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        if let Some(queue_entry) = existing {
            return Ok(queue_entry);
        }

        // Check player reputation (filter bad actors)
        if let Some(rep_service) = &self.reputation_service {
            let reputation = rep_service.get_player_reputation(user_id).await
                .map_err(|e| ApiError::internal_server_error(&format!("Reputation check failed: {}", e)))?;
            
            // Filter players with very low fair play score
            if reputation.should_filter(30) {
                return Err(ApiError::bad_request(
                    "Account restricted due to behavioral violations. Please contact support.",
                ));
            }
        }

        // Get user's ELO for the game
        let elo = self.get_or_create_elo(user_id, &request.game).await?;

        let elo_range = 200; // Match within 200 ELO points
        let max_wait_minutes = request.max_wait_time.unwrap_or(5);

        let queue_entry = sqlx::query_as::<_, MatchmakingQueue>(
            r#"
            INSERT INTO matchmaking_queue (
                id, user_id, game, game_mode, current_elo,
                min_elo, max_elo, joined_at, expires_at, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(&request.game)
        .bind(&request.game_mode)
        .bind(elo.current_rating)
        .bind(elo.current_rating - elo_range)
        .bind(elo.current_rating + elo_range)
        .bind(Utc::now())
        .bind(Utc::now() + Duration::minutes(max_wait_minutes as i64))
        .bind(QueueStatus::Waiting)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        // Try to find a match immediately
        self.try_match_players(&request.game, &request.game_mode)
            .await?;

        Ok(queue_entry)
    }

    /// Leave the matchmaking queue
    pub async fn leave_matchmaking(&self, user_id: Uuid) -> Result<(), ApiError> {
        sqlx::query("UPDATE matchmaking_queue SET status = $1 WHERE user_id = $2 AND status = $3")
            .bind(QueueStatus::Cancelled)
            .bind(user_id)
            .bind(QueueStatus::Waiting)
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

        Ok(())
    }

    /// Get matchmaking status for a user
    pub async fn get_matchmaking_status(
        &self,
        user_id: Uuid,
    ) -> Result<MatchmakingStatusResponse, ApiError> {
        let queue_entry = sqlx::query_as::<_, MatchmakingQueue>(
            "SELECT * FROM matchmaking_queue WHERE user_id = $1 AND status = $2",
        )
        .bind(user_id)
        .bind(QueueStatus::Waiting)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let in_queue = queue_entry.is_some();

        // Check for current active match
        let current_match = sqlx::query_as::<_, Match>(
            r#"
            SELECT * FROM matches
            WHERE (player1_id = $1 OR player2_id = $1)
            AND status IN ('pending', 'in_progress')
            ORDER BY created_at DESC
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let current_match_response = if let Some(m) = current_match {
            Some(self.match_to_response(m).await?)
        } else {
            None
        };

        Ok(MatchmakingStatusResponse {
            in_queue,
            queue_position: None,
            estimated_wait_time: None,
            current_match: current_match_response,
        })
    }

    /// Try to match players in the queue
    async fn try_match_players(&self, game: &str, game_mode: &str) -> Result<(), ApiError> {
        // Get all waiting players for this game/mode
        let waiting = sqlx::query_as::<_, MatchmakingQueue>(
            r#"
            SELECT * FROM matchmaking_queue
            WHERE game = $1 AND game_mode = $2 AND status = $3 AND expires_at > $4
            ORDER BY joined_at ASC
            "#,
        )
        .bind(game)
        .bind(game_mode)
        .bind(QueueStatus::Waiting)
        .bind(Utc::now())
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        // Try to pair players with compatible ELO ranges
        let mut matched_ids: Vec<Uuid> = Vec::new();

        for i in 0..waiting.len() {
            if matched_ids.contains(&waiting[i].id) {
                continue;
            }

            for j in (i + 1)..waiting.len() {
                if matched_ids.contains(&waiting[j].id) {
                    continue;
                }

                let p1 = &waiting[i];
                let p2 = &waiting[j];

                // Check ELO compatibility
                if p1.current_elo >= p2.min_elo
                    && p1.current_elo <= p2.max_elo
                    && p2.current_elo >= p1.min_elo
                    && p2.current_elo <= p1.max_elo
                {
                    // Create a match
                    let match_id = self
                        .create_match(p1.user_id, p2.user_id, game, game_mode)
                        .await?;

                    // Update queue entries
                    sqlx::query(
                        "UPDATE matchmaking_queue SET status = $1, matched_at = $2, match_id = $3 WHERE id = $4 OR id = $5",
                    )
                    .bind(QueueStatus::Matched)
                    .bind(Utc::now())
                    .bind(match_id)
                    .bind(p1.id)
                    .bind(p2.id)
                    .execute(&self.db_pool)
                    .await
                    .map_err(ApiError::database_error)?;

                    matched_ids.push(p1.id);
                    matched_ids.push(p2.id);

                    info!(
                        match_id = %match_id,
                        player1 = %p1.user_id,
                        player2 = %p2.user_id,
                        "Players matched"
                    );

                    break;
                }
            }
        }

        Ok(())
    }

    // ========================================================================
    // MATCH CRUD
    // ========================================================================

    /// Create a new match
    pub async fn create_match(
        &self,
        player1_id: Uuid,
        player2_id: Uuid,
        game: &str,
        game_mode: &str,
    ) -> Result<Uuid, ApiError> {
        let match_id = Uuid::new_v4();

        // Get ELO ratings
        let p1_elo = self.get_or_create_elo(player1_id, game).await?;
        let p2_elo = self.get_or_create_elo(player2_id, game).await?;

        sqlx::query(
            r#"
            INSERT INTO matches (
                id, match_type, status, player1_id, player2_id,
                player1_elo_before, player2_elo_before,
                game_mode, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            "#,
        )
        .bind(match_id)
        .bind(MatchType::Ranked)
        .bind(MatchStatus::Pending)
        .bind(player1_id)
        .bind(player2_id)
        .bind(p1_elo.current_rating)
        .bind(p2_elo.current_rating)
        .bind(game_mode)
        .bind(Utc::now())
        .bind(Utc::now())
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(match_id)
    }

    /// Get a match by ID
    pub async fn get_match(&self, match_id: Uuid) -> Result<MatchResponse, ApiError> {
        let m = sqlx::query_as::<_, Match>("SELECT * FROM matches WHERE id = $1")
            .bind(match_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or_else(|| ApiError::not_found("Match not found"))?;

        self.match_to_response(m).await
    }

    /// Start a match
    pub async fn start_match(&self, match_id: Uuid) -> Result<MatchResponse, ApiError> {
        let m = sqlx::query_as::<_, Match>("SELECT * FROM matches WHERE id = $1")
            .bind(match_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or_else(|| ApiError::not_found("Match not found"))?;

        if m.status != MatchStatus::Pending {
            return Err(ApiError::bad_request("Match is not in pending state"));
        }

        sqlx::query(
            "UPDATE matches SET status = $1, started_at = $2, updated_at = $3 WHERE id = $4",
        )
        .bind(MatchStatus::InProgress)
        .bind(Utc::now())
        .bind(Utc::now())
        .bind(match_id)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        self.get_match(match_id).await
    }

    /// Report match score
    pub async fn report_score(
        &self,
        match_id: Uuid,
        player_id: Uuid,
        request: ReportScoreRequest,
    ) -> Result<MatchScore, ApiError> {
        // Verify player is in this match
        let m = sqlx::query_as::<_, Match>("SELECT * FROM matches WHERE id = $1")
            .bind(match_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or_else(|| ApiError::not_found("Match not found"))?;

        if m.player1_id != player_id && m.player2_id != Some(player_id) {
            return Err(ApiError::forbidden("You are not a player in this match"));
        }

        if m.status != MatchStatus::InProgress {
            return Err(ApiError::bad_request("Match is not in progress"));
        }

        let score = sqlx::query_as::<_, MatchScore>(
            r#"
            INSERT INTO match_scores (
                id, match_id, player_id, score, proof_url,
                telemetry_data, submitted_at, verified
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(match_id)
        .bind(player_id)
        .bind(request.score)
        .bind(&request.proof_url)
        .bind(&request.telemetry_data)
        .bind(Utc::now())
        .bind(false)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        // Check if both players have reported scores
        self.check_and_complete_match(match_id).await?;

        Ok(score)
    }

    /// Complete a match (called when both scores are reported or by admin)
    async fn check_and_complete_match(&self, match_id: Uuid) -> Result<(), ApiError> {
        let scores = sqlx::query_as::<_, MatchScore>(
            "SELECT * FROM match_scores WHERE match_id = $1 ORDER BY submitted_at",
        )
        .bind(match_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        if scores.len() < 2 {
            return Ok(()); // Wait for both players
        }

        let m = sqlx::query_as::<_, Match>("SELECT * FROM matches WHERE id = $1")
            .bind(match_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or_else(|| ApiError::not_found("Match not found"))?;

        // Check if scores agree
        let p1_score = scores
            .iter()
            .find(|s| s.player_id == m.player1_id)
            .map(|s| s.score);
        let p2_score = scores
            .iter()
            .find(|s| m.player2_id == Some(s.player_id))
            .map(|s| s.score);

        if let (Some(s1), Some(s2)) = (p1_score, p2_score) {
            // Determine winner
            let winner_id = if s1 > s2 {
                Some(m.player1_id)
            } else if s2 > s1 {
                m.player2_id
            } else {
                None // Draw
            };

            // Calculate match duration
            let duration = m
                .started_at
                .map(|start| (Utc::now() - start).num_seconds() as i32);

            // Update match
            sqlx::query(
                r#"
                UPDATE matches
                SET status = $1, winner_id = $2, player1_score = $3, player2_score = $4,
                    completed_at = $5, match_duration = $6, updated_at = $7
                WHERE id = $8
                "#,
            )
            .bind(MatchStatus::Completed)
            .bind(winner_id)
            .bind(s1)
            .bind(s2)
            .bind(Utc::now())
            .bind(duration)
            .bind(Utc::now())
            .bind(match_id)
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            // Update ELO ratings
            if let Some(game) = m.game_mode.split('_').next() {
                self.update_elo_ratings(m.player1_id, m.player2_id, winner_id, game, match_id)
                    .await?;
            }

            info!(match_id = %match_id, winner = ?winner_id, "Match completed");
        }

        Ok(())
    }

    // ========================================================================
    // DISPUTES
    // ========================================================================

    /// Create a dispute for a match
    pub async fn create_dispute(
        &self,
        match_id: Uuid,
        player_id: Uuid,
        request: CreateDisputeRequest,
    ) -> Result<MatchDispute, ApiError> {
        // Verify player is in this match
        let m = sqlx::query_as::<_, Match>("SELECT * FROM matches WHERE id = $1")
            .bind(match_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or_else(|| ApiError::not_found("Match not found"))?;

        if m.player1_id != player_id && m.player2_id != Some(player_id) {
            return Err(ApiError::forbidden("You are not a player in this match"));
        }

        let evidence_urls = request
            .evidence_urls
            .map(|urls| serde_json::to_string(&urls).unwrap_or_default());

        let dispute = sqlx::query_as::<_, MatchDispute>(
            r#"
            INSERT INTO match_disputes (
                id, match_id, disputing_player_id, reason, evidence_urls,
                status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(match_id)
        .bind(player_id)
        .bind(&request.reason)
        .bind(&evidence_urls)
        .bind(DisputeStatus::Pending)
        .bind(Utc::now())
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        // Update match status to disputed
        sqlx::query("UPDATE matches SET status = $1, updated_at = $2 WHERE id = $3")
            .bind(MatchStatus::Disputed)
            .bind(Utc::now())
            .bind(match_id)
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

        Ok(dispute)
    }

    /// Get disputes for a match
    pub async fn get_match_disputes(&self, match_id: Uuid) -> Result<Vec<MatchDispute>, ApiError> {
        let disputes = sqlx::query_as::<_, MatchDispute>(
            "SELECT * FROM match_disputes WHERE match_id = $1 ORDER BY created_at DESC",
        )
        .bind(match_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(disputes)
    }

    // ========================================================================
    // ELO RATING
    // ========================================================================

    /// Get or create ELO record for a user/game
    async fn get_or_create_elo(&self, user_id: Uuid, game: &str) -> Result<UserElo, ApiError> {
        let existing =
            sqlx::query_as::<_, UserElo>("SELECT * FROM user_elo WHERE user_id = $1 AND game = $2")
                .bind(user_id)
                .bind(game)
                .fetch_optional(&self.db_pool)
                .await
                .map_err(ApiError::database_error)?;

        if let Some(elo) = existing {
            return Ok(elo);
        }

        // Create default ELO record
        let elo = sqlx::query_as::<_, UserElo>(
            r#"
            INSERT INTO user_elo (
                id, user_id, game, current_rating, peak_rating,
                games_played, wins, losses, draws, win_streak, loss_streak,
                last_updated
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(game)
        .bind(1200i32) // Default ELO
        .bind(1200i32)
        .bind(0i32)
        .bind(0i32)
        .bind(0i32)
        .bind(0i32)
        .bind(0i32)
        .bind(0i32)
        .bind(Utc::now())
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(elo)
    }

    /// Update ELO ratings after a match
    async fn update_elo_ratings(
        &self,
        player1_id: Uuid,
        player2_id: Option<Uuid>,
        winner_id: Option<Uuid>,
        game: &str,
        match_id: Uuid,
    ) -> Result<(), ApiError> {
        let player2_id = match player2_id {
            Some(id) => id,
            None => return Ok(()), // No opponent (bye)
        };

        let p1_elo = self.get_or_create_elo(player1_id, game).await?;
        let p2_elo = self.get_or_create_elo(player2_id, game).await?;

        let k_factor = 32.0_f64;

        // Calculate expected scores
        let p1_expected = 1.0
            / (1.0 + 10.0_f64.powf((p2_elo.current_rating - p1_elo.current_rating) as f64 / 400.0));
        let p2_expected = 1.0 - p1_expected;

        // Actual scores
        let (p1_actual, p2_actual, p1_result, p2_result) = match winner_id {
            Some(id) if id == player1_id => (1.0, 0.0, MatchResult::Win, MatchResult::Loss),
            Some(_) => (0.0, 1.0, MatchResult::Loss, MatchResult::Win),
            None => (0.5, 0.5, MatchResult::Draw, MatchResult::Draw),
        };

        // Calculate new ratings
        let p1_new_rating = p1_elo.current_rating + (k_factor * (p1_actual - p1_expected)) as i32;
        let p2_new_rating = p2_elo.current_rating + (k_factor * (p2_actual - p2_expected)) as i32;

        let p1_change = p1_new_rating - p1_elo.current_rating;
        let p2_change = p2_new_rating - p2_elo.current_rating;

        // Update player 1 ELO
        let (p1_wins, p1_losses, p1_draws) = match p1_result {
            MatchResult::Win => (p1_elo.wins + 1, p1_elo.losses, p1_elo.draws),
            MatchResult::Loss => (p1_elo.wins, p1_elo.losses + 1, p1_elo.draws),
            MatchResult::Draw => (p1_elo.wins, p1_elo.losses, p1_elo.draws + 1),
        };

        let p1_win_streak = if p1_result == MatchResult::Win {
            p1_elo.win_streak + 1
        } else {
            0
        };
        let p1_loss_streak = if p1_result == MatchResult::Loss {
            p1_elo.loss_streak + 1
        } else {
            0
        };
        let p1_peak = p1_elo.peak_rating.max(p1_new_rating);

        sqlx::query(
            r#"
            UPDATE user_elo
            SET current_rating = $1, peak_rating = $2, games_played = games_played + 1,
                wins = $3, losses = $4, draws = $5,
                win_streak = $6, loss_streak = $7, last_updated = $8
            WHERE user_id = $9 AND game = $10
            "#,
        )
        .bind(p1_new_rating)
        .bind(p1_peak)
        .bind(p1_wins)
        .bind(p1_losses)
        .bind(p1_draws)
        .bind(p1_win_streak)
        .bind(p1_loss_streak)
        .bind(Utc::now())
        .bind(player1_id)
        .bind(game)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        // Update player 2 ELO (same pattern)
        let (p2_wins, p2_losses, p2_draws) = match p2_result {
            MatchResult::Win => (p2_elo.wins + 1, p2_elo.losses, p2_elo.draws),
            MatchResult::Loss => (p2_elo.wins, p2_elo.losses + 1, p2_elo.draws),
            MatchResult::Draw => (p2_elo.wins, p2_elo.losses, p2_elo.draws + 1),
        };

        let p2_win_streak = if p2_result == MatchResult::Win {
            p2_elo.win_streak + 1
        } else {
            0
        };
        let p2_loss_streak = if p2_result == MatchResult::Loss {
            p2_elo.loss_streak + 1
        } else {
            0
        };
        let p2_peak = p2_elo.peak_rating.max(p2_new_rating);

        sqlx::query(
            r#"
            UPDATE user_elo
            SET current_rating = $1, peak_rating = $2, games_played = games_played + 1,
                wins = $3, losses = $4, draws = $5,
                win_streak = $6, loss_streak = $7, last_updated = $8
            WHERE user_id = $9 AND game = $10
            "#,
        )
        .bind(p2_new_rating)
        .bind(p2_peak)
        .bind(p2_wins)
        .bind(p2_losses)
        .bind(p2_draws)
        .bind(p2_win_streak)
        .bind(p2_loss_streak)
        .bind(Utc::now())
        .bind(player2_id)
        .bind(game)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        // Record ELO history for both players
        sqlx::query(
            r#"
            INSERT INTO elo_history (
                id, user_id, game, match_id, rating_before, rating_after,
                rating_change, opponent_id, opponent_rating, result, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(player1_id)
        .bind(game)
        .bind(match_id)
        .bind(p1_elo.current_rating)
        .bind(p1_new_rating)
        .bind(p1_change)
        .bind(player2_id)
        .bind(p2_elo.current_rating)
        .bind(p1_result)
        .bind(Utc::now())
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        sqlx::query(
            r#"
            INSERT INTO elo_history (
                id, user_id, game, match_id, rating_before, rating_after,
                rating_change, opponent_id, opponent_rating, result, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(player2_id)
        .bind(game)
        .bind(match_id)
        .bind(p2_elo.current_rating)
        .bind(p2_new_rating)
        .bind(p2_change)
        .bind(player1_id)
        .bind(p1_elo.current_rating)
        .bind(p2_result)
        .bind(Utc::now())
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        // Update match with new ELO values
        sqlx::query(
            "UPDATE matches SET player1_elo_after = $1, player2_elo_after = $2 WHERE id = $3",
        )
        .bind(p1_new_rating)
        .bind(p2_new_rating)
        .bind(match_id)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(())
    }

    /// Get ELO stats for a user
    pub async fn get_elo_stats(&self, user_id: Uuid, game: &str) -> Result<EloResponse, ApiError> {
        let elo = self.get_or_create_elo(user_id, game).await?;

        let win_rate = if elo.games_played > 0 {
            elo.wins as f64 / elo.games_played as f64
        } else {
            0.0
        };

        // Get rank
        let rank_row = sqlx::query(
            r#"
            SELECT COUNT(*) + 1 as rank
            FROM user_elo
            WHERE game = $1 AND current_rating > $2
            "#,
        )
        .bind(game)
        .bind(elo.current_rating)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let rank: i64 = rank_row.try_get("rank").unwrap_or(0);

        Ok(EloResponse {
            game: game.to_string(),
            current_rating: elo.current_rating,
            peak_rating: elo.peak_rating,
            games_played: elo.games_played,
            wins: elo.wins,
            losses: elo.losses,
            draws: elo.draws,
            win_rate,
            win_streak: elo.win_streak,
            loss_streak: elo.loss_streak,
            rank: Some(rank as i32),
            percentile: None,
        })
    }

    /// Get ELO history for a user
    pub async fn get_elo_history(
        &self,
        user_id: Uuid,
        game: &str,
        limit: i32,
    ) -> Result<Vec<EloHistory>, ApiError> {
        let history = sqlx::query_as::<_, EloHistory>(
            r#"
            SELECT * FROM elo_history
            WHERE user_id = $1 AND game = $2
            ORDER BY created_at DESC
            LIMIT $3
            "#,
        )
        .bind(user_id)
        .bind(game)
        .bind(limit as i64)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(history)
    }

    // ========================================================================
    // MATCH HISTORY & LEADERBOARD
    // ========================================================================

    /// Get match history for a user
    pub async fn get_match_history(
        &self,
        user_id: Uuid,
        page: i32,
        per_page: i32,
    ) -> Result<MatchHistoryResponse, ApiError> {
        let offset = (page - 1) * per_page;

        let matches = sqlx::query_as::<_, Match>(
            r#"
            SELECT * FROM matches
            WHERE player1_id = $1 OR player2_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(user_id)
        .bind(per_page as i64)
        .bind(offset as i64)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let total_row = sqlx::query(
            "SELECT COUNT(*) as count FROM matches WHERE player1_id = $1 OR player2_id = $1",
        )
        .bind(user_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let total: i64 = total_row.try_get("count").unwrap_or(0);

        let mut match_responses = Vec::new();
        for m in matches {
            match_responses.push(self.match_to_response(m).await?);
        }

        Ok(MatchHistoryResponse {
            matches: match_responses,
            total,
            page,
            per_page,
        })
    }

    /// Get leaderboard for a game
    pub async fn get_leaderboard(
        &self,
        game: &str,
        limit: i32,
    ) -> Result<LeaderboardResponse, ApiError> {
        let rows = sqlx::query(
            r#"
            SELECT ue.user_id, u.username, ue.current_rating, ue.games_played,
                   ue.wins, ue.losses,
                   ROW_NUMBER() OVER (ORDER BY ue.current_rating DESC) as rank
            FROM user_elo ue
            JOIN users u ON ue.user_id = u.id
            WHERE ue.game = $1 AND ue.games_played > 0
            ORDER BY ue.current_rating DESC
            LIMIT $2
            "#,
        )
        .bind(game)
        .bind(limit as i64)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let entries: Vec<LeaderboardEntry> = rows
            .iter()
            .map(|row| {
                let games_played: i32 = row.try_get("games_played").unwrap_or(0);
                let wins: i32 = row.try_get("wins").unwrap_or(0);
                let losses: i32 = row.try_get("losses").unwrap_or(0);
                let win_rate = if games_played > 0 {
                    wins as f64 / games_played as f64
                } else {
                    0.0
                };

                LeaderboardEntry {
                    rank: row.try_get("rank").unwrap_or(0),
                    user_id: row.try_get("user_id").unwrap_or_default(),
                    username: row.try_get("username").unwrap_or_default(),
                    elo_rating: row.try_get("current_rating").unwrap_or(1200),
                    games_played,
                    wins,
                    losses,
                    win_rate,
                }
            })
            .collect();

        let total = entries.len() as i64;

        Ok(LeaderboardResponse {
            entries,
            total,
            game: game.to_string(),
        })
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    /// Get raw Match entity by ID (for internal use)
    async fn get_match_raw(&self, match_id: Uuid) -> Result<Match, ApiError> {
        sqlx::query_as::<_, Match>("SELECT * FROM matches WHERE id = $1")
            .bind(match_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or_else(|| ApiError::not_found("Match not found"))
    }

    /// Convert a Match entity to a MatchResponse
    async fn match_to_response(&self, m: Match) -> Result<MatchResponse, ApiError> {
        let player1 = self.get_player_info(m.player1_id).await?;
        let player2 = if let Some(p2_id) = m.player2_id {
            Some(self.get_player_info(p2_id).await?)
        } else {
            None
        };

        // Check for disputes
        let dispute = sqlx::query_as::<_, MatchDispute>(
            "SELECT * FROM match_disputes WHERE match_id = $1 ORDER BY created_at DESC LIMIT 1",
        )
        .bind(m.id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(MatchResponse {
            id: m.id,
            tournament_id: m.tournament_id,
            match_type: m.match_type,
            status: m.status,
            player1,
            player2,
            winner_id: m.winner_id,
            player1_score: m.player1_score,
            player2_score: m.player2_score,
            scheduled_time: m.scheduled_time,
            started_at: m.started_at,
            completed_at: m.completed_at,
            game_mode: m.game_mode,
            map: m.map,
            match_duration: m.match_duration,
            can_report_score: m.status == MatchStatus::InProgress,
            can_dispute: m.status == MatchStatus::Completed,
            dispute_status: dispute.map(|d| d.status),
        })
    }

    /// Get player info for match responses
    async fn get_player_info(&self, user_id: Uuid) -> Result<PlayerInfo, ApiError> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or_else(|| ApiError::not_found("Player not found"))?;

        // Get current ELO (default game)
        let elo_row = sqlx::query(
            "SELECT current_rating FROM user_elo WHERE user_id = $1 ORDER BY last_updated DESC LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let elo_rating: i32 = elo_row
            .and_then(|r| r.try_get("current_rating").ok())
            .unwrap_or(1200);

        Ok(PlayerInfo {
            id: user.id,
            username: user.username,
            elo_rating,
            avatar_url: user.avatar_url,
        })
    }

    // ========================================================================
    // REALTIME EVENT PUBLISHING
    // ========================================================================

    async fn publish_match_event(&self, event_data: serde_json::Value) -> Result<(), ApiError> {
        if let Some(ref event_bus) = self.event_bus {
            if let (Some(match_id_str), Some(event_type)) = (
                event_data.get("match_id").and_then(|v| v.as_str()),
                event_data.get("event").and_then(|v| v.as_str()),
            ) {
                let match_id = Uuid::parse_str(match_id_str).unwrap_or_default();
                let timestamp = chrono::Utc::now().to_rfc3339();

                let event = crate::realtime::events::RealtimeEvent::MatchStatusChange {
                    match_id,
                    from_status: event_data
                        .get("from_status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    to_status: event_type.to_string(),
                    timestamp,
                };

                event_bus.publish_to_match(match_id, &event).await;

                // Also publish to participant user channels
                for key in ["player1_id", "player2_id", "user_id"] {
                    if let Some(uid_str) = event_data.get(key).and_then(|v| v.as_str()) {
                        if let Ok(uid) = Uuid::parse_str(uid_str) {
                            event_bus.publish_to_user(uid, &event).await;
                        }
                    }
                }
            }
        }
        Ok(())
    }

    async fn publish_global_event(&self, _event_data: serde_json::Value) -> Result<(), ApiError> {
        // Global events (e.g., tournament announcements) to be implemented
        // when a global subscription mechanism is added.
        Ok(())
    }

    // ========================================================================
    // DISPUTE MANAGEMENT (ADMIN)
    // ========================================================================

    /// Resolve a match dispute (admin function)
    pub async fn resolve_dispute(
        &self,
        dispute_id: Uuid,
        admin_id: Uuid,
        resolution: String,
        winner_id: Option<Uuid>,
    ) -> Result<MatchDispute, ApiError> {
        let dispute = sqlx::query_as::<_, MatchDispute>(
            r#"
            UPDATE match_disputes
            SET status = $1, admin_reviewer_id = $2, resolution = $3, resolved_at = $4
            WHERE id = $5
            RETURNING *
            "#,
        )
        .bind(DisputeStatus::Resolved)
        .bind(admin_id)
        .bind(&resolution)
        .bind(Utc::now())
        .bind(dispute_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        if let Some(new_winner) = winner_id {
            sqlx::query("UPDATE matches SET winner_id = $1, updated_at = $2 WHERE id = $3")
                .bind(new_winner)
                .bind(Utc::now())
                .bind(dispute.match_id)
                .execute(&self.db_pool)
                .await
                .map_err(ApiError::database_error)?;

            let match_record = self.get_match_raw(dispute.match_id).await?;
            if let Some(game) = match_record.game_mode.split('_').next() {
                self.update_elo_ratings(
                    match_record.player1_id,
                    match_record.player2_id,
                    Some(new_winner),
                    game,
                    dispute.match_id,
                )
                .await?;
            }
        }

        tracing::info!("Dispute {} resolved by admin {}", dispute_id, admin_id);
        Ok(dispute)
    }

    /// Reject a match dispute
    pub async fn reject_dispute(
        &self,
        dispute_id: Uuid,
        admin_id: Uuid,
        reason: String,
    ) -> Result<MatchDispute, ApiError> {
        let dispute = sqlx::query_as::<_, MatchDispute>(
            r#"
            UPDATE match_disputes
            SET status = $1, admin_reviewer_id = $2, admin_notes = $3, resolved_at = $4
            WHERE id = $5
            RETURNING *
            "#,
        )
        .bind(DisputeStatus::Rejected)
        .bind(admin_id)
        .bind(&reason)
        .bind(Utc::now())
        .bind(dispute_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        tracing::info!("Dispute {} rejected by admin {}", dispute_id, admin_id);
        Ok(dispute)
    }

    // ========================================================================
    // MATCH LIFECYCLE
    // ========================================================================

    /// Start a match (transition from scheduled to in_progress)
    pub async fn start_match_lifecycle(&self, match_id: Uuid) -> Result<Match, ApiError> {
        let match_record = self.get_match_raw(match_id).await?;

        if match_record.status != MatchStatus::Scheduled {
            return Err(ApiError::bad_request(
                "Match cannot be started from current status".to_string(),
            ));
        }

        let now = Utc::now();
        let updated_match = sqlx::query_as::<_, Match>(
            r#"
            UPDATE matches
            SET status = $1, started_at = $2, updated_at = $3
            WHERE id = $4
            RETURNING *
            "#,
        )
        .bind(MatchStatus::InProgress)
        .bind(now)
        .bind(now)
        .bind(match_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        self.publish_match_event(serde_json::json!({
            "type": "started",
            "match_id": match_id.to_string(),
            "tournament_id": match_record.tournament_id
        }))
        .await?;

        Ok(updated_match)
    }

    /// Schedule a match
    pub async fn schedule_match(
        &self,
        match_id: Uuid,
        scheduled_time: DateTime<Utc>,
    ) -> Result<Match, ApiError> {
        let match_record = self.get_match_raw(match_id).await?;

        if match_record.status != MatchStatus::Pending {
            return Err(ApiError::bad_request(
                "Match cannot be scheduled from current status".to_string(),
            ));
        }

        if scheduled_time <= Utc::now() {
            return Err(ApiError::bad_request(
                "Scheduled time must be in the future".to_string(),
            ));
        }

        let updated_match = sqlx::query_as::<_, Match>(
            r#"
            UPDATE matches
            SET status = $1, scheduled_time = $2, updated_at = $3
            WHERE id = $4
            RETURNING *
            "#,
        )
        .bind(MatchStatus::Scheduled)
        .bind(scheduled_time)
        .bind(Utc::now())
        .bind(match_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        self.publish_match_event(serde_json::json!({
            "type": "scheduled",
            "match_id": match_id.to_string(),
            "tournament_id": match_record.tournament_id,
            "scheduled_time": scheduled_time
        }))
        .await?;

        Ok(updated_match)
    }

    /// Cancel a match
    pub async fn cancel_match(
        &self,
        match_id: Uuid,
        reason: Option<String>,
    ) -> Result<Match, ApiError> {
        let match_record = self.get_match_raw(match_id).await?;

        if match_record.status == MatchStatus::Completed
            || match_record.status == MatchStatus::Cancelled
        {
            return Err(ApiError::bad_request(
                "Cannot cancel a completed or already cancelled match".to_string(),
            ));
        }

        let updated_match = sqlx::query_as::<_, Match>(
            r#"
            UPDATE matches
            SET status = $1, updated_at = $2
            WHERE id = $3
            RETURNING *
            "#,
        )
        .bind(MatchStatus::Cancelled)
        .bind(Utc::now())
        .bind(match_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        tracing::info!("Match {} cancelled. Reason: {:?}", match_id, reason);
        Ok(updated_match)
    }

    /// Clean up expired matchmaking queue entries
    pub async fn cleanup_expired_queue_entries(&self) -> Result<i64, ApiError> {
        let result = sqlx::query(
            r#"
            UPDATE matchmaking_queue
            SET status = $1
            WHERE status = $2 AND expires_at < $3
            "#,
        )
        .bind(QueueStatus::Expired)
        .bind(QueueStatus::Waiting)
        .bind(Utc::now())
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let rows_affected = result.rows_affected();
        if rows_affected > 0 {
            tracing::info!("Cleaned up {} expired queue entries", rows_affected);
        }

        Ok(rows_affected as i64)
    }

    /// Get dispute details
    pub async fn get_dispute(&self, dispute_id: Uuid) -> Result<MatchDispute, ApiError> {
        sqlx::query_as::<_, MatchDispute>("SELECT * FROM match_disputes WHERE id = $1")
            .bind(dispute_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or_else(|| ApiError::not_found("Dispute not found"))
    }
}
