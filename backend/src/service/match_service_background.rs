use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::{Match, MatchType, MatchmakingQueue, QueueStatus, UserElo};
use crate::service::reputation_service::ReputationService;
use chrono::Utc;
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

/// Background matchmaking worker for MatchService
/// This provides periodic queue scanning and match creation as suggested in issue #449
impl crate::service::match_service::MatchService {
    /// Start the background matchmaking worker
    /// This periodically scans the queue and creates matches using tokio::spawn
    pub fn start_background_matchmaker(&self) {
        let db_pool = self.db_pool.clone();
        let reputation_service = self.reputation_service.clone();
        let event_bus = self.event_bus.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
            
            loop {
                interval.tick().await;
                
                // Get all active game/mode combinations with waiting players
                let active_modes = match sqlx::query!(
                    r#"
                    SELECT DISTINCT game, game_mode 
                    FROM matchmaking_queue 
                    WHERE status = $1
                    ORDER BY game, game_mode
                    "#,
                    QueueStatus::Waiting as _
                )
                .fetch_all(&db_pool)
                .await
                {
                    Ok(modes) => modes,
                    Err(e) => {
                        tracing::error!("Failed to get active matchmaking modes: {:?}", e);
                        continue;
                    }
                };

                // Process each game/mode combination
                for mode in active_modes {
                    if let Err(e) = Self::process_matchmaking_cycle(
                        &db_pool, 
                        &reputation_service, 
                        &event_bus,
                        &mode.game, 
                        &mode.game_mode
                    ).await {
                        tracing::error!("Matchmaking cycle failed for {} {}: {:?}", mode.game, mode.game_mode, e);
                    }
                }
            }
        });
    }

    /// Process a single matchmaking cycle for a specific game/mode
    async fn process_matchmaking_cycle(
        db_pool: &DbPool,
        reputation_service: &Option<Arc<ReputationService>>,
        event_bus: &Option<crate::realtime::event_bus::EventBus>,
        game: &str,
        game_mode: &str,
    ) -> Result<(), ApiError> {
        // Find potential matches - get more candidates to find better matches
        let candidates = sqlx::query_as!(
            MatchmakingQueue,
            r#"
            SELECT * FROM matchmaking_queue
            WHERE game = $1 AND game_mode = $2 AND status = $3
            ORDER BY joined_at ASC
            LIMIT 50
            "#,
            game,
            game_mode,
            QueueStatus::Waiting as _
        )
        .fetch_all(db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if candidates.len() < 2 {
            return Ok(()); // Not enough players to match
        }

        // Filter out bad actors if reputation service is available
        let filtered_candidates = if let Some(rep_service) = reputation_service {
            let candidate_ids: Vec<Uuid> = candidates.iter().map(|c| c.user_id).collect();
            let filtered_ids = rep_service.filter_bad_actors(&candidate_ids, 50).await
                .unwrap_or(candidate_ids); // If filtering fails, use original list
            
            candidates.into_iter()
                .filter(|c| filtered_ids.contains(&c.user_id))
                .collect::<Vec<_>>()
        } else {
            candidates
        };

        if filtered_candidates.len() < 2 {
            return Ok(()); // Not enough players after filtering
        }

        // Try to match players
        let mut matched_players = HashSet::new();
        
        for i in 0..filtered_candidates.len() {
            if matched_players.contains(&filtered_candidates[i].user_id) {
                continue;
            }

            for j in (i + 1)..filtered_candidates.len() {
                if matched_players.contains(&filtered_candidates[j].user_id) {
                    continue;
                }

                let player1 = &filtered_candidates[i];
                let player2 = &filtered_candidates[j];

                // Check if Elo ranges overlap
                if Self::elo_ranges_overlap_static(player1, player2) {
                    // Create match
                    let match_record = Self::create_match_static(
                        db_pool,
                        player1.user_id,
                        Some(player2.user_id),
                        MatchType::Ranked,
                        game_mode.to_string(),
                        None,
                        None,
                    ).await?;

                    // Update queue entries
                    Self::update_queue_entries_to_matched_static(
                        db_pool,
                        player1.id,
                        player2.id,
                        match_record.id,
                    ).await?;

                    // Mark players as matched so they don't get matched again in this cycle
                    matched_players.insert(player1.user_id);
                    matched_players.insert(player2.user_id);

                    // Notify players via WebSocket if event bus is available
                    if let Some(bus) = event_bus {
                        let _ = bus.publish(serde_json::json!({
                            "type": "match_created",
                            "match_id": match_record.id,
                            "player1_id": player1.user_id,
                            "player2_id": player2.user_id,
                            "game_mode": game_mode,
                        })).await;
                    }

                    tracing::info!(
                        "Created match {} between {} and {} for {} {}",
                        match_record.id,
                        player1.user_id,
                        player2.user_id,
                        game,
                        game_mode
                    );
                }
            }
        }

        Ok(())
    }

    /// Static helper to check Elo overlap (for use in static context)
    fn elo_ranges_overlap_static(player1: &MatchmakingQueue, player2: &MatchmakingQueue) -> bool {
        player1.min_elo <= player2.max_elo && player2.min_elo <= player1.max_elo
    }

    /// Static helper to create a match (for use in static context)
    async fn create_match_static(
        db_pool: &DbPool,
        player1_id: Uuid,
        player2_id: Option<Uuid>,
        match_type: MatchType,
        game_mode: String,
        tournament_id: Option<Uuid>,
        round_id: Option<Uuid>,
    ) -> Result<Match, ApiError> {
        let match_id = Uuid::new_v4();

        // Get player Elo ratings
        let player1_elo = Self::get_user_elo_static(db_pool, player1_id, &game_mode).await?;
        let player2_elo = if let Some(p2_id) = player2_id {
            Some(Self::get_user_elo_static(db_pool, p2_id, &game_mode).await?)
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
            crate::models::MatchStatus::Pending as _,
            player1_id,
            player2_id,
            player1_elo,
            player2_elo,
            game_mode,
            Utc::now(),
            Utc::now()
        )
        .fetch_one(db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(match_record)
    }

    /// Static helper to get user Elo (for use in static context)
    async fn get_user_elo_static(db_pool: &DbPool, user_id: Uuid, game_mode: &str) -> Result<i32, ApiError> {
        let elo = sqlx::query_as!(
            UserElo,
            "SELECT * FROM user_elo WHERE user_id = $1 AND game_mode = $2",
            user_id,
            game_mode
        )
        .fetch_optional(db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .map(|e| e.current_rating)
        .unwrap_or(1200); // Default Elo if not found

        Ok(elo)
    }

    /// Static helper to update queue entries (for use in static context)
    async fn update_queue_entries_to_matched_static(
        db_pool: &DbPool,
        player1_queue_id: Uuid,
        player2_queue_id: Uuid,
        match_id: Uuid,
    ) -> Result<(), ApiError> {
        // Update player 1
        sqlx::query!(
            "UPDATE matchmaking_queue SET status = $1, matched_at = $2, match_id = $3 WHERE id = $4",
            QueueStatus::Matched as _,
            Utc::now(),
            match_id,
            player1_queue_id
        )
        .execute(db_pool)
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
        .execute(db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }
}
