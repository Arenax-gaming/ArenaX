use crate::models::*;
use crate::db::DbPool;
use crate::api_error::ApiError;
use sqlx::Row;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::cmp::Ordering;
use std::sync::Arc;
use redis::Client as RedisClient;

pub struct MatchService {
    db_pool: DbPool,
    redis_client: Option<Arc<RedisClient>>,
}

impl MatchService {
    pub fn new(db_pool: DbPool) -> Self {
        Self { 
            db_pool,
            redis_client: None,
        }
    }

    pub fn with_redis(mut self, redis_client: RedisClient) -> Self {
        self.redis_client = Some(redis_client);
        self
    }

    /// Create a new match
    pub async fn create_match(
        &self,
        player1_id: Uuid,
        player2_id: Option<Uuid>,
        match_type: MatchType,
        game_mode: String,
        tournament_id: Option<Uuid>,
        round_id: Option<Uuid>,
    ) -> Result<Match, ApiError> {
        let match_id = Uuid::new_v4();
        
        // Get player Elo ratings
        let player1_elo = self.get_user_elo(player1_id, &game_mode).await?;
        let player2_elo = if let Some(p2_id) = player2_id {
            Some(self.get_user_elo(p2_id, &game_mode).await?)
        } else {
            None
        };

        let match_record = sqlx::query_as!(
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
            tournament_id,
            round_id,
            match_type as _,
            MatchStatus::Pending as _,
            player1_id,
            player2_id,
            player1_elo,
            player2_elo,
            game_mode,
            Utc::now(),
            Utc::now()
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(match_record)
    }

    /// Get match details
    pub async fn get_match(&self, match_id: Uuid, user_id: Option<Uuid>) -> Result<MatchResponse, ApiError> {
        let match_record = sqlx::query_as!(
            Match,
            "SELECT * FROM matches WHERE id = $1",
            match_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or(ApiError::not_found("Match not found"))?;

        // Get player information
        let player1 = self.get_player_info(match_record.player1_id).await?;
        let player2 = if let Some(p2_id) = match_record.player2_id {
            Some(self.get_player_info(p2_id).await?)
        } else {
            None
        };

        // Check if user can report score or dispute
        let can_report_score = self.can_user_report_score(user_id, &match_record).await?;
        let can_dispute = self.can_user_dispute_match(user_id, &match_record).await?;
        let dispute_status = self.get_match_dispute_status(match_id).await?;

        Ok(MatchResponse {
            id: match_record.id,
            tournament_id: match_record.tournament_id,
            match_type: match_record.match_type.into(),
            status: match_record.status.into(),
            player1,
            player2,
            winner_id: match_record.winner_id,
            player1_score: match_record.player1_score,
            player2_score: match_record.player2_score,
            scheduled_time: match_record.scheduled_time,
            started_at: match_record.started_at,
            completed_at: match_record.completed_at,
            game_mode: match_record.game_mode,
            map: match_record.map,
            match_duration: match_record.match_duration,
            can_report_score,
            can_dispute,
            dispute_status,
        })
    }

    /// Report match score
    pub async fn report_score(
        &self,
        match_id: Uuid,
        user_id: Uuid,
        request: ReportScoreRequest,
    ) -> Result<MatchScore, ApiError> {
        // Validate match and user
        let match_record = self.get_match_by_id(match_id).await?;
        self.validate_score_report(&match_record, user_id).await?;

        // Create score record
        let score_record = sqlx::query_as!(
            MatchScore,
            r#"
            INSERT INTO match_scores (
                id, match_id, player_id, score, proof_url, telemetry_data, 
                submitted_at, verified
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8
            ) RETURNING *
            "#,
            Uuid::new_v4(),
            match_id,
            user_id,
            request.score,
            request.proof_url,
            request.telemetry_data,
            Utc::now(),
            false
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Update match with score
        self.update_match_score(match_id, user_id, request.score).await?;

        // Publish score reported event
        self.publish_match_event(serde_json::json!({
            "type": "score_reported",
            "match_id": match_id,
            "tournament_id": match_record.tournament_id,
            "user_id": user_id,
            "score": request.score
        })).await?;

        // Check if both players have reported scores
        let both_reported = self.both_players_reported_scores(match_id).await?;
        if both_reported {
            self.process_match_completion(match_id).await?;
        }

        Ok(score_record)
    }

    /// Create a match dispute
    pub async fn create_dispute(
        &self,
        match_id: Uuid,
        user_id: Uuid,
        request: CreateDisputeRequest,
    ) -> Result<MatchDispute, ApiError> {
        // Validate dispute creation
        let match_record = self.get_match_by_id(match_id).await?;
        self.validate_dispute_creation(&match_record, user_id).await?;

        // Create dispute record
        let dispute = sqlx::query_as!(
            MatchDispute,
            r#"
            INSERT INTO match_disputes (
                id, match_id, disputing_player_id, reason, evidence_urls, 
                status, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7
            ) RETURNING *
            "#,
            Uuid::new_v4(),
            match_id,
            user_id,
            request.reason,
            request.evidence_urls.map(|urls| serde_json::to_string(&urls).unwrap_or_default()),
            DisputeStatus::Pending as _,
            Utc::now()
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Update match status to disputed
        self.update_match_status(match_id, MatchStatus::Disputed).await?;

        // Publish dispute event
        self.publish_match_event(serde_json::json!({
            "type": "disputed",
            "match_id": match_id,
            "tournament_id": match_record.tournament_id,
            "user_id": user_id,
            "reason": request.reason
        })).await?;

        Ok(dispute)
    }

    /// Join matchmaking queue
    pub async fn join_matchmaking(
        &self,
        user_id: Uuid,
        request: JoinMatchmakingRequest,
    ) -> Result<MatchmakingQueue, ApiError> {
        // Check if user is already in queue
        if self.is_user_in_queue(user_id, &request.game).await? {
            return Err(ApiError::bad_request("User is already in matchmaking queue"));
        }

        // Get user's current Elo rating
        let current_elo = self.get_user_elo(user_id, &request.game).await?;
        
        // Calculate Elo range for matchmaking
        let (min_elo, max_elo) = self.calculate_elo_range(current_elo);

        // Set expiration time
        let expires_at = Utc::now() + chrono::Duration::minutes(request.max_wait_time.unwrap_or(10) as i64);

        // Add to queue
        let queue_entry = sqlx::query_as!(
            MatchmakingQueue,
            r#"
            INSERT INTO matchmaking_queue (
                id, user_id, game, game_mode, current_elo, min_elo, max_elo,
                joined_at, expires_at, status
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            ) RETURNING *
            "#,
            Uuid::new_v4(),
            user_id,
            request.game,
            request.game_mode,
            current_elo,
            min_elo,
            max_elo,
            Utc::now(),
            expires_at,
            QueueStatus::Waiting as _
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Try to find a match immediately
        self.try_matchmaking(&request.game, &request.game_mode).await?;

        Ok(queue_entry)
    }

    /// Get matchmaking status for user
    pub async fn get_matchmaking_status(&self, user_id: Uuid) -> Result<MatchmakingStatusResponse, ApiError> {
        let queue_entry = sqlx::query_as!(
            MatchmakingQueue,
            "SELECT * FROM matchmaking_queue WHERE user_id = $1 AND status = $2",
            user_id,
            QueueStatus::Waiting as _
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if let Some(entry) = queue_entry {
            // Calculate queue position
            let position = self.get_queue_position(user_id, &entry.game).await?;
            
            // Estimate wait time
            let estimated_wait = self.estimate_wait_time(&entry.game, &entry.game_mode).await?;

            Ok(MatchmakingStatusResponse {
                in_queue: true,
                queue_position: Some(position),
                estimated_wait_time: Some(estimated_wait),
                current_match: None,
            })
        } else {
            // Check if user has an active match
            let active_match = self.get_user_active_match(user_id).await?;
            
            Ok(MatchmakingStatusResponse {
                in_queue: false,
                queue_position: None,
                estimated_wait_time: None,
                current_match: active_match,
            })
        }
    }

    /// Get user's Elo rating
    pub async fn get_user_elo_rating(&self, user_id: Uuid, game: &str) -> Result<EloResponse, ApiError> {
        let elo_record = sqlx::query_as!(
            UserElo,
            "SELECT * FROM user_elo WHERE user_id = $1 AND game = $2",
            user_id,
            game
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or(ApiError::not_found("Elo rating not found"))?;

        // Calculate win rate
        let total_games = elo_record.games_played;
        let win_rate = if total_games > 0 {
            (elo_record.wins as f64 / total_games as f64) * 100.0
        } else {
            0.0
        };

        // Get global rank and percentile
        let (rank, percentile) = self.calculate_rank_and_percentile(user_id, game).await?;

        Ok(EloResponse {
            game: elo_record.game,
            current_rating: elo_record.current_rating,
            peak_rating: elo_record.peak_rating,
            games_played: elo_record.games_played,
            wins: elo_record.wins,
            losses: elo_record.losses,
            draws: elo_record.draws,
            win_rate,
            win_streak: elo_record.win_streak,
            loss_streak: elo_record.loss_streak,
            rank,
            percentile,
        })
    }

    // Private helper methods

    async fn get_user_elo(&self, user_id: Uuid, game: &str) -> Result<i32, ApiError> {
        let elo_record = sqlx::query_as!(
            UserElo,
            "SELECT * FROM user_elo WHERE user_id = $1 AND game = $2",
            user_id,
            game
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(elo_record.map(|r| r.current_rating).unwrap_or(1200)) // Default Elo rating
    }

    async fn get_player_info(&self, user_id: Uuid) -> Result<PlayerInfo, ApiError> {
        let user = sqlx::query_as!(
            User,
            "SELECT * FROM users WHERE id = $1",
            user_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or(ApiError::not_found("User not found"))?;

        // Get user's Elo rating for the game (assuming we have a default game)
        let elo_rating = self.get_user_elo(user_id, "default").await?;

        Ok(PlayerInfo {
            id: user.id,
            username: user.username,
            elo_rating,
            avatar_url: user.avatar_url,
        })
    }

    async fn can_user_report_score(&self, user_id: Option<Uuid>, match_record: &Match) -> Result<bool, ApiError> {
        if user_id.is_none() {
            return Ok(false);
        }

        let user_id = user_id.unwrap();

        // Check if user is a player in this match
        if user_id != match_record.player1_id && match_record.player2_id.map(|p2| p2 != user_id).unwrap_or(true) {
            return Ok(false);
        }

        // Check if match is in progress
        if match_record.status != MatchStatus::InProgress {
            return Ok(false);
        }

        // Check if user has already reported score
        let existing_score = sqlx::query!(
            "SELECT id FROM match_scores WHERE match_id = $1 AND player_id = $2",
            match_record.id,
            user_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(existing_score.is_none())
    }

    async fn can_user_dispute_match(&self, user_id: Option<Uuid>, match_record: &Match) -> Result<bool, ApiError> {
        if user_id.is_none() {
            return Ok(false);
        }

        let user_id = user_id.unwrap();

        // Check if user is a player in this match
        if user_id != match_record.player1_id && match_record.player2_id.map(|p2| p2 != user_id).unwrap_or(true) {
            return Ok(false);
        }

        // Check if match is completed
        if match_record.status != MatchStatus::Completed {
            return Ok(false);
        }

        // Check if there's already a pending dispute
        let existing_dispute = sqlx::query!(
            "SELECT id FROM match_disputes WHERE match_id = $1 AND status = $2",
            match_record.id,
            DisputeStatus::Pending as _
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(existing_dispute.is_none())
    }

    async fn get_match_dispute_status(&self, match_id: Uuid) -> Result<Option<DisputeStatus>, ApiError> {
        let dispute = sqlx::query!(
            "SELECT status FROM match_disputes WHERE match_id = $1 ORDER BY created_at DESC LIMIT 1",
            match_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(dispute.map(|d| d.status.into()))
    }

    async fn get_match_by_id(&self, match_id: Uuid) -> Result<Match, ApiError> {
        sqlx::query_as!(
            Match,
            "SELECT * FROM matches WHERE id = $1",
            match_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or(ApiError::not_found("Match not found".to_string()))
    }

    async fn validate_score_report(&self, match_record: &Match, user_id: Uuid) -> Result<(), ApiError> {
        // Check if user is a player in this match
        if user_id != match_record.player1_id && match_record.player2_id.map(|p2| p2 != user_id).unwrap_or(true) {
            return Err(ApiError::forbidden("User is not a player in this match"));
        }

        // Check if match is in progress
        if match_record.status != MatchStatus::InProgress {
            return Err(ApiError::bad_request("Match is not in progress"));
        }

        // Check if user has already reported score
        let existing_score = sqlx::query!(
            "SELECT id FROM match_scores WHERE match_id = $1 AND player_id = $2",
            match_record.id,
            user_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if existing_score.is_some() {
            return Err(ApiError::bad_request("Score already reported for this match"));
        }

        Ok(())
    }

    async fn update_match_score(&self, match_id: Uuid, user_id: Uuid, score: i32) -> Result<(), ApiError> {
        let match_record = self.get_match_by_id(match_id).await?;

        if user_id == match_record.player1_id {
            sqlx::query!(
                "UPDATE matches SET player1_score = $1, updated_at = $2 WHERE id = $3",
                score,
                Utc::now(),
                match_id
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        } else if match_record.player2_id.map(|p2| p2 == user_id).unwrap_or(false) {
            sqlx::query!(
                "UPDATE matches SET player2_score = $1, updated_at = $2 WHERE id = $3",
                score,
                Utc::now(),
                match_id
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        }

        Ok(())
    }

    async fn both_players_reported_scores(&self, match_id: Uuid) -> Result<bool, ApiError> {
        let match_record = self.get_match_by_id(match_id).await?;
        
        let player1_score = sqlx::query!(
            "SELECT id FROM match_scores WHERE match_id = $1 AND player_id = $2",
            match_id,
            match_record.player1_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let player2_score = if let Some(p2_id) = match_record.player2_id {
            sqlx::query!(
                "SELECT id FROM match_scores WHERE match_id = $1 AND player_id = $2",
                match_id,
                p2_id
            )
            .fetch_optional(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
        } else {
            Some(sqlx::Row::new()) // Bye match, consider as reported
        };

        Ok(player1_score.is_some() && player2_score.is_some())
    }

    async fn process_match_completion(&self, match_id: Uuid) -> Result<(), ApiError> {
        let match_record = self.get_match_by_id(match_id).await?;
        
        // Determine winner
        let winner_id = self.determine_winner(&match_record).await?;
        
        // Update match with winner and completion time
        sqlx::query!(
            r#"
            UPDATE matches 
            SET winner_id = $1, status = $2, completed_at = $3, updated_at = $4
            WHERE id = $5
            "#,
            winner_id,
            MatchStatus::Completed as _,
            Utc::now(),
            Utc::now(),
            match_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Update Elo ratings
        self.update_elo_ratings(&match_record, winner_id).await?;

        // Create Elo history records
        self.create_elo_history(&match_record, winner_id).await?;

        // Publish match completed event
        self.publish_match_event(serde_json::json!({
            "type": "completed",
            "match_id": match_id,
            "tournament_id": match_record.tournament_id,
            "winner_id": winner_id,
            "player1_score": match_record.player1_score.unwrap_or(0),
            "player2_score": match_record.player2_score.unwrap_or(0)
        })).await?;

        // Publish global event if it's a ranked match
        if match_record.match_type == MatchType::Ranked {
            if let Some(winner) = winner_id {
                self.publish_global_event(serde_json::json!({
                    "type": "match_completed",
                    "match_id": match_id,
                    "game_mode": match_record.game_mode,
                    "winner_id": winner
                })).await?;
            }
        }

        Ok(())
    }

    async fn determine_winner(&self, match_record: &Match) -> Result<Option<Uuid>, ApiError> {
        let player1_score = match_record.player1_score.unwrap_or(0);
        let player2_score = match_record.player2_score.unwrap_or(0);

        match player1_score.cmp(&player2_score) {
            Ordering::Greater => Ok(Some(match_record.player1_id)),
            Ordering::Less => Ok(match_record.player2_id),
            Ordering::Equal => Ok(None), // Draw
        }
    }

    async fn update_elo_ratings(&self, match_record: &Match, winner_id: Option<Uuid>) -> Result<(), ApiError> {
        if match_record.player2_id.is_none() {
            return Ok(()); // Bye match, no Elo update needed
        }

        let player1_elo = match_record.player1_elo_before.unwrap_or(1200);
        let player2_elo = match_record.player2_elo_before.unwrap_or(1200);

        // Calculate new Elo ratings
        let (new_player1_elo, new_player2_elo) = self.calculate_elo_change(
            player1_elo,
            player2_elo,
            winner_id,
            match_record.player1_id,
            match_record.player2_id.unwrap(),
        );

        // Determine results for each player
        let player1_result = if winner_id == Some(match_record.player1_id) {
            MatchResult::Win
        } else if winner_id == match_record.player2_id {
            MatchResult::Loss
        } else {
            MatchResult::Draw
        };

        let player2_result = if winner_id == match_record.player2_id {
            MatchResult::Win
        } else if winner_id == Some(match_record.player1_id) {
            MatchResult::Loss
        } else {
            MatchResult::Draw
        };

        // Update player 1 Elo
        self.update_user_elo(match_record.player1_id, &match_record.game_mode, new_player1_elo, player1_result).await?;

        // Update player 2 Elo
        self.update_user_elo(match_record.player2_id.unwrap(), &match_record.game_mode, new_player2_elo, player2_result).await?;

        // Update match record with new Elo ratings
        sqlx::query!(
            r#"
            UPDATE matches
            SET player1_elo_after = $1, player2_elo_after = $2, updated_at = $3
            WHERE id = $4
            "#,
            new_player1_elo,
            new_player2_elo,
            Utc::now(),
            match_record.id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    fn calculate_elo_change(
        &self,
        player1_elo: i32,
        player2_elo: i32,
        winner_id: Option<Uuid>,
        player1_id: Uuid,
        player2_id: Uuid,
    ) -> (i32, i32) {
        const K_FACTOR: f64 = 32.0;

        // Calculate expected scores
        let expected_player1 = 1.0 / (1.0 + 10.0_f64.powf((player2_elo - player1_elo) as f64 / 400.0));
        let expected_player2 = 1.0 - expected_player1;

        // Determine actual scores
        let (actual_player1, actual_player2) = match winner_id {
            Some(winner) => {
                if winner == player1_id {
                    (1.0, 0.0) // Player 1 wins
                } else if winner == player2_id {
                    (0.0, 1.0) // Player 2 wins
                } else {
                    (0.5, 0.5) // Draw
                }
            }
            None => (0.5, 0.5), // Draw
        };

        // Calculate new ratings
        let new_player1_elo = player1_elo + (K_FACTOR * (actual_player1 - expected_player1)) as i32;
        let new_player2_elo = player2_elo + (K_FACTOR * (actual_player2 - expected_player2)) as i32;

        (new_player1_elo, new_player2_elo)
    }

    async fn update_user_elo(&self, user_id: Uuid, game: &str, new_elo: i32, result: MatchResult) -> Result<(), ApiError> {
        // Get current Elo record
        let current_elo = sqlx::query_as!(
            UserElo,
            "SELECT * FROM user_elo WHERE user_id = $1 AND game = $2",
            user_id,
            game
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if let Some(elo_record) = current_elo {
            // Update existing record
            let peak_rating = elo_record.peak_rating.max(new_elo);

            // Calculate new win/loss/draw counts and streaks
            let (wins, losses, draws) = match result {
                MatchResult::Win => (elo_record.wins + 1, elo_record.losses, elo_record.draws),
                MatchResult::Loss => (elo_record.wins, elo_record.losses + 1, elo_record.draws),
                MatchResult::Draw => (elo_record.wins, elo_record.losses, elo_record.draws + 1),
            };

            let (win_streak, loss_streak) = match result {
                MatchResult::Win => (elo_record.win_streak + 1, 0),
                MatchResult::Loss => (0, elo_record.loss_streak + 1),
                MatchResult::Draw => (0, 0), // Draws reset both streaks
            };

            sqlx::query!(
                r#"
                UPDATE user_elo
                SET current_rating = $1, peak_rating = $2, games_played = games_played + 1,
                    wins = $3, losses = $4, draws = $5, win_streak = $6, loss_streak = $7,
                    last_updated = $8
                WHERE user_id = $9 AND game = $10
                "#,
                new_elo,
                peak_rating,
                wins,
                losses,
                draws,
                win_streak,
                loss_streak,
                Utc::now(),
                user_id,
                game
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        } else {
            // Create new record
            let (wins, losses, draws) = match result {
                MatchResult::Win => (1, 0, 0),
                MatchResult::Loss => (0, 1, 0),
                MatchResult::Draw => (0, 0, 1),
            };

            let (win_streak, loss_streak) = match result {
                MatchResult::Win => (1, 0),
                MatchResult::Loss => (0, 1),
                MatchResult::Draw => (0, 0),
            };

            sqlx::query!(
                r#"
                INSERT INTO user_elo (
                    id, user_id, game, current_rating, peak_rating, games_played,
                    wins, losses, draws, win_streak, loss_streak, last_updated
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
                )
                "#,
                Uuid::new_v4(),
                user_id,
                game,
                new_elo,
                new_elo,
                1,
                wins,
                losses,
                draws,
                win_streak,
                loss_streak,
                Utc::now()
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        }

        Ok(())
    }

    async fn create_elo_history(&self, match_record: &Match, winner_id: Option<Uuid>) -> Result<(), ApiError> {
        if match_record.player2_id.is_none() {
            return Ok(()); // Bye match, no history needed
        }

        let player1_elo_before = match_record.player1_elo_before.unwrap_or(1200);
        let player2_elo_before = match_record.player2_elo_before.unwrap_or(1200);
        let player1_elo_after = match_record.player1_elo_after.unwrap_or(1200);
        let player2_elo_after = match_record.player2_elo_after.unwrap_or(1200);

        // Create history for player 1
        let player1_result = if winner_id == Some(match_record.player1_id) {
            MatchResult::Win
        } else if winner_id == match_record.player2_id {
            MatchResult::Loss
        } else {
            MatchResult::Draw
        };

        sqlx::query!(
            r#"
            INSERT INTO elo_history (
                id, user_id, game, match_id, rating_before, rating_after, rating_change,
                opponent_id, opponent_rating, result, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
            )
            "#,
            Uuid::new_v4(),
            match_record.player1_id,
            match_record.game_mode,
            match_record.id,
            player1_elo_before,
            player1_elo_after,
            player1_elo_after - player1_elo_before,
            match_record.player2_id.unwrap(),
            player2_elo_before,
            player1_result as _,
            Utc::now()
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Create history for player 2
        let player2_result = if winner_id == match_record.player2_id {
            MatchResult::Win
        } else if winner_id == Some(match_record.player1_id) {
            MatchResult::Loss
        } else {
            MatchResult::Draw
        };

        sqlx::query!(
            r#"
            INSERT INTO elo_history (
                id, user_id, game, match_id, rating_before, rating_after, rating_change,
                opponent_id, opponent_rating, result, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
            )
            "#,
            Uuid::new_v4(),
            match_record.player2_id.unwrap(),
            match_record.game_mode,
            match_record.id,
            player2_elo_before,
            player2_elo_after,
            player2_elo_after - player2_elo_before,
            match_record.player1_id,
            player1_elo_before,
            player2_result as _,
            Utc::now()
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    async fn validate_dispute_creation(&self, match_record: &Match, user_id: Uuid) -> Result<(), ApiError> {
        // Check if user is a player in this match
        if user_id != match_record.player1_id && match_record.player2_id.map(|p2| p2 != user_id).unwrap_or(true) {
            return Err(ApiError::forbidden("User is not a player in this match"));
        }

        // Check if match is completed
        if match_record.status != MatchStatus::Completed {
            return Err(ApiError::bad_request("Match is not completed"));
        }

        // Check if there's already a pending dispute
        let existing_dispute = sqlx::query!(
            "SELECT id FROM match_disputes WHERE match_id = $1 AND status = $2",
            match_record.id,
            DisputeStatus::Pending as _
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if existing_dispute.is_some() {
            return Err(ApiError::bad_request("Dispute already exists for this match"));
        }

        Ok(())
    }

    async fn update_match_status(&self, match_id: Uuid, status: MatchStatus) -> Result<(), ApiError> {
        sqlx::query!(
            "UPDATE matches SET status = $1, updated_at = $2 WHERE id = $3",
            status as _,
            Utc::now(),
            match_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    async fn is_user_in_queue(&self, user_id: Uuid, game: &str) -> Result<bool, ApiError> {
        let count = sqlx::query!(
            "SELECT COUNT(*) as count FROM matchmaking_queue WHERE user_id = $1 AND game = $2 AND status = $3",
            user_id,
            game,
            QueueStatus::Waiting as _
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .count
        .unwrap_or(0);

        Ok(count > 0)
    }

    fn calculate_elo_range(&self, current_elo: i32) -> (i32, i32) {
        const ELO_RANGE: i32 = 200; // ±200 Elo points
        (current_elo - ELO_RANGE, current_elo + ELO_RANGE)
    }

    async fn try_matchmaking(&self, game: &str, game_mode: &str) -> Result<(), ApiError> {
        // Find potential matches
        let candidates = sqlx::query_as!(
            MatchmakingQueue,
            r#"
            SELECT * FROM matchmaking_queue 
            WHERE game = $1 AND game_mode = $2 AND status = $3
            ORDER BY joined_at ASC
            LIMIT 10
            "#,
            game,
            game_mode,
            QueueStatus::Waiting as _
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Try to match players
        for i in 0..candidates.len() {
            for j in (i + 1)..candidates.len() {
                let player1 = &candidates[i];
                let player2 = &candidates[j];

                // Check if Elo ranges overlap
                if self.elo_ranges_overlap(player1, player2) {
                    // Create match
                    let match_record = self.create_match(
                        player1.user_id,
                        Some(player2.user_id),
                        MatchType::Ranked,
                        game_mode.to_string(),
                        None,
                        None,
                    ).await?;

                    // Update queue entries
                    self.update_queue_entries_to_matched(player1.id, player2.id, match_record.id).await?;

                    // Only create one match per call
                    return Ok(());
                }
            }
        }

        Ok(())
    }

    fn elo_ranges_overlap(&self, player1: &MatchmakingQueue, player2: &MatchmakingQueue) -> bool {
        player1.min_elo <= player2.max_elo && player2.min_elo <= player1.max_elo
    }

    async fn update_queue_entries_to_matched(&self, player1_queue_id: Uuid, player2_queue_id: Uuid, match_id: Uuid) -> Result<(), ApiError> {
        // Update player 1
        sqlx::query!(
            "UPDATE matchmaking_queue SET status = $1, matched_at = $2, match_id = $3 WHERE id = $4",
            QueueStatus::Matched as _,
            Utc::now(),
            match_id,
            player1_queue_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Update player 2
        sqlx::query!(
            "UPDATE matchmaking_queue SET status = $1, matched_at = $2, match_id = $3 WHERE id = $4",
            QueueStatus::Matched as _,
            Utc::now(),
            match_id,
            player2_queue_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    async fn get_queue_position(&self, user_id: Uuid, game: &str) -> Result<i32, ApiError> {
        let position = sqlx::query!(
            r#"
            SELECT COUNT(*) as position FROM matchmaking_queue 
            WHERE game = $1 AND status = $2 AND joined_at < (
                SELECT joined_at FROM matchmaking_queue WHERE user_id = $3 AND game = $1 AND status = $2
            )
            "#,
            game,
            QueueStatus::Waiting as _,
            user_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .position
        .unwrap_or(0);

        Ok(position as i32 + 1) // 1-indexed position
    }

    async fn estimate_wait_time(&self, game: &str, game_mode: &str) -> Result<i32, ApiError> {
        // Simple estimation based on queue size and average match duration
        let queue_size = sqlx::query!(
            "SELECT COUNT(*) as count FROM matchmaking_queue WHERE game = $1 AND game_mode = $2 AND status = $3",
            game,
            game_mode,
            QueueStatus::Waiting as _
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .count
        .unwrap_or(0);

        // Estimate 2 minutes per person in queue (rough approximation)
        Ok((queue_size as i32) * 120)
    }

    async fn get_user_active_match(&self, user_id: Uuid) -> Result<Option<MatchResponse>, ApiError> {
        let match_record = sqlx::query_as!(
            Match,
            r#"
            SELECT m.* FROM matches m 
            WHERE (m.player1_id = $1 OR m.player2_id = $1) 
            AND m.status IN ($2, $3)
            ORDER BY m.created_at DESC 
            LIMIT 1
            "#,
            user_id,
            MatchStatus::Pending as _,
            MatchStatus::InProgress as _
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if let Some(match_record) = match_record {
            Ok(Some(self.get_match(match_record.id, Some(user_id)).await?))
        } else {
            Ok(None)
        }
    }

    async fn calculate_rank_and_percentile(&self, user_id: Uuid, game: &str) -> Result<(Option<i32>, Option<f64>), ApiError> {
        // Get user's current rating
        let user_rating = self.get_user_elo(user_id, game).await?;

        // Count players with higher ratings
        let higher_rated_count = sqlx::query!(
            "SELECT COUNT(*) as count FROM user_elo WHERE game = $1 AND current_rating > $2",
            game,
            user_rating
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .count
        .unwrap_or(0);

        // Get total player count
        let total_players = sqlx::query!(
            "SELECT COUNT(*) as count FROM user_elo WHERE game = $1",
            game
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .count
        .unwrap_or(0);

        if total_players == 0 {
            return Ok((None, None));
        }

        let rank = higher_rated_count as i32 + 1;
        let percentile = ((total_players - higher_rated_count) as f64 / total_players as f64) * 100.0;

        Ok((Some(rank), Some(percentile)))
    }

    /// Leave matchmaking queue
    pub async fn leave_matchmaking(&self, user_id: Uuid) -> Result<(), ApiError> {
        sqlx::query!(
            "UPDATE matchmaking_queue SET status = $1 WHERE user_id = $2 AND status = $3",
            QueueStatus::Cancelled as _,
            user_id,
            QueueStatus::Waiting as _
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    /// Get user's match history
    pub async fn get_user_match_history(
        &self,
        user_id: Uuid,
        page: i32,
        per_page: i32,
        game: Option<String>,
    ) -> Result<MatchHistoryResponse, ApiError> {
        let offset = (page - 1) * per_page;
        
        let matches = sqlx::query_as!(
            Match,
            r#"
            SELECT * FROM matches 
            WHERE (player1_id = $1 OR player2_id = $1) 
            AND ($2::text IS NULL OR game_mode = $2)
            AND status = $3
            ORDER BY completed_at DESC 
            LIMIT $4 OFFSET $5
            "#,
            user_id,
            game,
            MatchStatus::Completed as _,
            per_page,
            offset
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Get total count
        let total = sqlx::query!(
            r#"
            SELECT COUNT(*) as count FROM matches 
            WHERE (player1_id = $1 OR player2_id = $1) 
            AND ($2::text IS NULL OR game_mode = $2)
            AND status = $3
            "#,
            user_id,
            game,
            MatchStatus::Completed as _
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .count
        .unwrap_or(0);

        // Convert to response format
        let mut match_responses = Vec::new();
        for match_record in matches {
            let player1 = self.get_player_info(match_record.player1_id).await?;
            let player2 = if let Some(p2_id) = match_record.player2_id {
                Some(self.get_player_info(p2_id).await?)
            } else {
                None
            };

            match_responses.push(MatchResponse {
                id: match_record.id,
                tournament_id: match_record.tournament_id,
                match_type: match_record.match_type.into(),
                status: match_record.status.into(),
                player1,
                player2,
                winner_id: match_record.winner_id,
                player1_score: match_record.player1_score,
                player2_score: match_record.player2_score,
                scheduled_time: match_record.scheduled_time,
                started_at: match_record.started_at,
                completed_at: match_record.completed_at,
                game_mode: match_record.game_mode,
                map: match_record.map,
                match_duration: match_record.match_duration,
                can_report_score: false,
                can_dispute: false,
                dispute_status: None,
            });
        }

        Ok(MatchHistoryResponse {
            matches: match_responses,
            total,
            page,
            per_page,
        })
    }

    /// Get leaderboard
    pub async fn get_leaderboard(
        &self,
        game: String,
        page: i32,
        per_page: i32,
    ) -> Result<LeaderboardResponse, ApiError> {
        let offset = (page - 1) * per_page;
        
        let rankings = sqlx::query!(
            r#"
            SELECT ue.*, u.username, u.avatar_url 
            FROM user_elo ue
            JOIN users u ON ue.user_id = u.id
            WHERE ue.game = $1
            ORDER BY ue.current_rating DESC, ue.games_played DESC
            LIMIT $2 OFFSET $3
            "#,
            game,
            per_page,
            offset
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Get total count
        let total = sqlx::query!(
            "SELECT COUNT(*) as count FROM user_elo WHERE game = $1",
            game
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .count
        .unwrap_or(0);

        // Convert to response format
        let mut leaderboard_entries = Vec::new();
        for (index, ranking) in rankings.iter().enumerate() {
            let rank = offset as usize + index + 1;
            let win_rate = if ranking.games_played > 0 {
                (ranking.wins as f64 / ranking.games_played as f64) * 100.0
            } else {
                0.0
            };

            leaderboard_entries.push(LeaderboardEntry {
                rank: rank as i32,
                user_id: ranking.user_id,
                username: ranking.username.clone().unwrap_or_else(|| "Unknown".to_string()),
                avatar_url: ranking.avatar_url.clone(),
                current_rating: ranking.current_rating,
                peak_rating: ranking.peak_rating,
                games_played: ranking.games_played,
                wins: ranking.wins,
                losses: ranking.losses,
                draws: ranking.draws,
                win_rate,
                win_streak: ranking.win_streak,
            });
        }

        Ok(LeaderboardResponse {
            game,
            entries: leaderboard_entries,
            total,
            page,
            per_page,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MatchHistoryResponse {
    pub matches: Vec<MatchResponse>,
    pub total: i64,
    pub page: i32,
    pub per_page: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LeaderboardResponse {
    pub game: String,
    pub entries: Vec<LeaderboardEntry>,
    pub total: i64,
    pub page: i32,
    pub per_page: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LeaderboardEntry {
    pub rank: i32,
    pub user_id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub current_rating: i32,
    pub peak_rating: i32,
    pub games_played: i32,
    pub wins: i32,
    pub losses: i32,
    pub draws: i32,
    pub win_rate: f64,
    pub win_streak: i32,
}

// Helper trait implementations for enum conversions
impl From<i32> for MatchType {
    fn from(value: i32) -> Self {
        match value {
            0 => MatchType::Tournament,
            1 => MatchType::Casual,
            2 => MatchType::Ranked,
            3 => MatchType::Practice,
            _ => MatchType::Casual,
        }
    }
}

impl From<i32> for MatchStatus {
    fn from(value: i32) -> Self {
        match value {
            0 => MatchStatus::Pending,
            1 => MatchStatus::Scheduled,
            2 => MatchStatus::InProgress,
            3 => MatchStatus::Completed,
            4 => MatchStatus::Disputed,
            5 => MatchStatus::Cancelled,
            6 => MatchStatus::Abandoned,
            _ => MatchStatus::Pending,
        }
    }
}

impl From<i32> for DisputeStatus {
    fn from(value: i32) -> Self {
        match value {
            0 => DisputeStatus::Pending,
            1 => DisputeStatus::UnderReview,
            2 => DisputeStatus::Resolved,
            3 => DisputeStatus::Rejected,
            _ => DisputeStatus::Pending,
        }
    }
}

impl From<i32> for QueueStatus {
    fn from(value: i32) -> Self {
        match value {
            0 => QueueStatus::Waiting,
            1 => QueueStatus::Matched,
            2 => QueueStatus::Expired,
            3 => QueueStatus::Cancelled,
            _ => QueueStatus::Waiting,
        }
    }
}

impl MatchService {
    // Real-time event publishing methods
    // TODO: Implement proper realtime module with event types
    async fn publish_match_event(&self, _event_data: serde_json::Value) -> Result<(), ApiError> {
        // Placeholder for real-time match event publishing
        // Will be implemented when realtime module is added
        Ok(())
    }

    async fn publish_global_event(&self, _event_data: serde_json::Value) -> Result<(), ApiError> {
        // Placeholder for real-time global event publishing
        // Will be implemented when realtime module is added
        Ok(())
    }

    /// Resolve a match dispute (admin function)
    pub async fn resolve_dispute(
        &self,
        dispute_id: Uuid,
        admin_id: Uuid,
        resolution: String,
        winner_id: Option<Uuid>,
    ) -> Result<MatchDispute, ApiError> {
        // Update dispute record
        let dispute = sqlx::query_as!(
            MatchDispute,
            r#"
            UPDATE match_disputes 
            SET status = $1, admin_reviewer_id = $2, resolution = $3, resolved_at = $4
            WHERE id = $5
            RETURNING *
            "#,
            DisputeStatus::Resolved as _,
            admin_id,
            resolution,
            Utc::now(),
            dispute_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Update match record if winner needs to be reassigned
        if let Some(new_winner) = winner_id {
            sqlx::query!(
                "UPDATE matches SET winner_id = $1, updated_at = $2 WHERE id = $3",
                new_winner,
                Utc::now(),
                dispute.match_id
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            // Recalculate Elo ratings with new winner
            let match_record = self.get_match_by_id(dispute.match_id).await?;
            self.update_elo_ratings(&match_record, Some(new_winner)).await?;
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
        let dispute = sqlx::query_as!(
            MatchDispute,
            r#"
            UPDATE match_disputes 
            SET status = $1, admin_reviewer_id = $2, admin_notes = $3, resolved_at = $4
            WHERE id = $5
            RETURNING *
            "#,
            DisputeStatus::Rejected as _,
            admin_id,
            reason,
            Utc::now(),
            dispute_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        tracing::info!("Dispute {} rejected by admin {}", dispute_id, admin_id);
        Ok(dispute)
    }

    /// Start a match (transition from scheduled to in_progress)
    pub async fn start_match(&self, match_id: Uuid) -> Result<Match, ApiError> {
        let match_record = self.get_match_by_id(match_id).await?;

        if match_record.status != MatchStatus::Scheduled {
            return Err(ApiError::bad_request("Match cannot be started from current status".to_string()));
        }

        let updated_match = sqlx::query_as!(
            Match,
            r#"
            UPDATE matches 
            SET status = $1, started_at = $2, updated_at = $3
            WHERE id = $4
            RETURNING *
            "#,
            MatchStatus::InProgress as _,
            Utc::now(),
            Utc::now(),
            match_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Publish match started event
        self.publish_match_event(serde_json::json!({
            "type": "started",
            "match_id": match_id,
            "tournament_id": match_record.tournament_id
        })).await?;

        Ok(updated_match)
    }

    /// Schedule a match
    pub async fn schedule_match(
        &self,
        match_id: Uuid,
        scheduled_time: DateTime<Utc>,
    ) -> Result<Match, ApiError> {
        let match_record = self.get_match_by_id(match_id).await?;

        if match_record.status != MatchStatus::Pending {
            return Err(ApiError::bad_request("Match cannot be scheduled from current status".to_string()));
        }

        if scheduled_time <= Utc::now() {
            return Err(ApiError::bad_request("Scheduled time must be in the future".to_string()));
        }

        let updated_match = sqlx::query_as!(
            Match,
            r#"
            UPDATE matches 
            SET status = $1, scheduled_time = $2, updated_at = $3
            WHERE id = $4
            RETURNING *
            "#,
            MatchStatus::Scheduled as _,
            scheduled_time,
            Utc::now(),
            match_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Publish match scheduled event
        self.publish_match_event(serde_json::json!({
            "type": "scheduled",
            "match_id": match_id,
            "tournament_id": match_record.tournament_id,
            "scheduled_time": scheduled_time
        })).await?;

        Ok(updated_match)
    }

    /// Cancel a match
    pub async fn cancel_match(
        &self,
        match_id: Uuid,
        reason: Option<String>,
    ) -> Result<Match, ApiError> {
        let match_record = self.get_match_by_id(match_id).await?;

        if match_record.status == MatchStatus::Completed || match_record.status == MatchStatus::Cancelled {
            return Err(ApiError::bad_request("Cannot cancel a completed or already cancelled match".to_string()));
        }

        let updated_match = sqlx::query_as!(
            Match,
            r#"
            UPDATE matches 
            SET status = $1, updated_at = $2
            WHERE id = $3
            RETURNING *
            "#,
            MatchStatus::Cancelled as _,
            Utc::now(),
            match_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        tracing::info!("Match {} cancelled. Reason: {:?}", match_id, reason);
        Ok(updated_match)
    }

    /// Clean up expired matchmaking queue entries
    pub async fn cleanup_expired_queue_entries(&self) -> Result<i64, ApiError> {
        let result = sqlx::query!(
            r#"
            UPDATE matchmaking_queue 
            SET status = $1
            WHERE status = $2 AND expires_at < $3
            "#,
            QueueStatus::Expired as _,
            QueueStatus::Waiting as _,
            Utc::now()
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let rows_affected = result.rows_affected();
        if rows_affected > 0 {
            tracing::info!("Cleaned up {} expired queue entries", rows_affected);
        }

        Ok(rows_affected as i64)
    }

    /// Get dispute details
    pub async fn get_dispute(&self, dispute_id: Uuid) -> Result<MatchDispute, ApiError> {
        sqlx::query_as!(
            MatchDispute,
            "SELECT * FROM match_disputes WHERE id = $1",
            dispute_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or(ApiError::not_found("Dispute not found".to_string()))
    }

    /// Get all disputes for a match
    pub async fn get_match_disputes(&self, match_id: Uuid) -> Result<Vec<MatchDispute>, ApiError> {
        sqlx::query_as!(
            MatchDispute,
            "SELECT * FROM match_disputes WHERE match_id = $1 ORDER BY created_at DESC",
            match_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))
    }

    /// Get pending disputes for admin review
    pub async fn get_pending_disputes(
        &self,
        page: i32,
        per_page: i32,
    ) -> Result<DisputeListResponse, ApiError> {
        let offset = (page - 1) * per_page;

        let disputes = sqlx::query_as!(
            MatchDispute,
            r#"
            SELECT * FROM match_disputes 
            WHERE status = $1
            ORDER BY created_at ASC
            LIMIT $2 OFFSET $3
            "#,
            DisputeStatus::Pending as _,
            per_page,
            offset
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let total = sqlx::query!(
            "SELECT COUNT(*) as count FROM match_disputes WHERE status = $1",
            DisputeStatus::Pending as _
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .count
        .unwrap_or(0);

        Ok(DisputeListResponse {
            disputes,
            total,
            page,
            per_page,
        })
    }

    /// Enhanced Elo calculation with consideration for player stats
    pub fn calculate_elo_change_enhanced(
        &self,
        player1_elo: i32,
        player2_elo: i32,
        winner_id: Option<Uuid>,
        player1_id: Uuid,
        player2_id: Uuid,
        player1_games: i32,
        player2_games: i32,
    ) -> (i32, i32) {
        let mut k_factor = 32.0;

        // Adjust K-factor based on number of games played
        if player1_games < 30 {
            k_factor = 48.0; // New players have higher K-factor for faster rating changes
        } else if player1_games > 100 {
            k_factor = 24.0; // Established players have lower K-factor
        }

        let k_factor_p2 = if player2_games < 30 {
            48.0
        } else if player2_games > 100 {
            24.0
        } else {
            32.0
        };

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
                    (0.5, 0.5)
                }
            }
            None => (0.5, 0.5),
        };

        // Calculate new ratings with adjusted K-factors
        let new_player1_elo = (player1_elo as f64 + k_factor * (actual_player1 - expected_player1)).round() as i32;
        let new_player2_elo = (player2_elo as f64 + k_factor_p2 * (actual_player2 - expected_player2)).round() as i32;

        // Ensure ratings don't go below 100 or above 3000
        let new_player1_elo = new_player1_elo.max(100).min(3000);
        let new_player2_elo = new_player2_elo.max(100).min(3000);

        (new_player1_elo, new_player2_elo)
    }
}
