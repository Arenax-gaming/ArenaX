use crate::api_error::ApiError;
use crate::auth::Claims;
use crate::db::DbPool;
use crate::models::matchmaker::*;
use crate::service::matchmaker::{MatchmakerService, EloEngine, MatchmakingConfig};
use actix_web::{web, HttpResponse, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct JoinQueueRequest {
    pub game: String,
    pub game_mode: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JoinQueueResponse {
    pub success: bool,
    pub queue_position: Option<usize>,
    pub estimated_wait_time: Option<i32>,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LeaveQueueRequest {
    pub game: String,
    pub game_mode: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LeaveQueueResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueueStatusResponse {
    pub in_queue: bool,
    pub queue_entry: Option<QueueEntry>,
    pub queue_size: usize,
    pub estimated_wait_time: Option<i32>,
    pub wait_time_so_far: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MatchmakingStatsResponse {
    pub total_players_in_queue: usize,
    pub games: Vec<GameQueueStats>,
    pub matches_created_last_hour: i64,
    pub average_wait_time: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GameQueueStats {
    pub game: String,
    pub game_modes: Vec<GameModeStats>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GameModeStats {
    pub game_mode: String,
    pub players_in_queue: usize,
    pub average_wait_time: Option<i32>,
    pub matches_per_hour: i64,
}

/// Join matchmaking queue
pub async fn join_queue(
    db_pool: web::Data<DbPool>,
    matchmaker: web::Data<MatchmakerService>,
    claims: web::ReqData<Claims>,
    request: web::Json<JoinQueueRequest>,
) -> Result<HttpResponse> {
    let user_id = claims.user_id;
    let game = request.game.clone();
    let game_mode = request.game_mode.clone();

    // Check if user is already in queue
    match matchmaker.is_user_in_queue(user_id, &game, &game_mode).await {
        Ok(Some(entry)) => {
            return Ok(HttpResponse::BadRequest().json(JoinQueueResponse {
                success: false,
                queue_position: None,
                estimated_wait_time: None,
                message: "Already in queue".to_string(),
            }));
        }
        Ok(None) => {} // Continue
        Err(e) => return Err(e.into()),
    }

    // Get user's current ELO rating
    let current_elo = match get_user_elo(&db_pool, user_id, &game).await {
        Ok(elo) => elo,
        Err(_) => {
            // Create default ELO record if not exists
            create_default_elo(&db_pool, user_id, &game).await?;
            1200 // Default ELO
        }
    };

    // Add to queue
    if let Err(e) = matchmaker.add_to_queue(user_id, game.clone(), game_mode.clone(), current_elo).await {
        return Err(e.into());
    }

    // Get queue stats
    let queue_size = matchmaker.get_queue_size(&game, &game_mode).await.unwrap_or(0);
    let estimated_wait_time = matchmaker.get_estimated_wait_time(user_id, &game, &game_mode).await.ok();

    // Add to database queue for persistence
    add_to_database_queue(&db_pool, user_id, &game, &game_mode, current_elo).await?;

    Ok(HttpResponse::Ok().json(JoinQueueResponse {
        success: true,
        queue_position: Some(queue_size),
        estimated_wait_time,
        message: "Successfully joined queue".to_string(),
    }))
}

/// Leave matchmaking queue
pub async fn leave_queue(
    db_pool: web::Data<DbPool>,
    matchmaker: web::Data<MatchmakerService>,
    claims: web::ReqData<Claims>,
    request: web::Json<LeaveQueueRequest>,
) -> Result<HttpResponse> {
    let user_id = claims.user_id;
    let game = request.game.clone();
    let game_mode = request.game_mode.clone();

    // Check if user is in queue
    match matchmaker.is_user_in_queue(user_id, &game, &game_mode).await {
        Ok(Some(_)) => {} // Continue
        Ok(None) => {
            return Ok(HttpResponse::BadRequest().json(LeaveQueueResponse {
                success: false,
                message: "Not in queue".to_string(),
            }));
        }
        Err(e) => return Err(e.into()),
    }

    // Remove from Redis queue
    let mut conn = matchmaker.redis_client.get_multiplexed_async_connection().await
        .map_err(|e| ApiError::internal_error(&format!("Redis connection error: {}", e)))?;
    
    if let Err(e) = matchmaker.remove_from_queue(&mut conn, &user_id, &game, &game_mode).await {
        return Err(e.into());
    }

    // Update database queue status
    update_database_queue_status(&db_pool, user_id, &game, &game_mode).await?;

    Ok(HttpResponse::Ok().json(LeaveQueueResponse {
        success: true,
        message: "Successfully left queue".to_string(),
    }))
}

/// Get queue status for current user
pub async fn get_queue_status(
    db_pool: web::Data<DbPool>,
    matchmaker: web::Data<MatchmakerService>,
    claims: web::ReqData<Claims>,
    path: web::Path<(String, String)>, // (game, game_mode)
) -> Result<HttpResponse> {
    let user_id = claims.user_id;
    let (game, game_mode) = path.into_inner();

    // Check if user is in queue
    let queue_entry = matchmaker.is_user_in_queue(user_id, &game, &game_mode).await?;
    let in_queue = queue_entry.is_some();

    let queue_size = matchmaker.get_queue_size(&game, &game_mode).await.unwrap_or(0);
    let estimated_wait_time = matchmaker.get_estimated_wait_time(user_id, &game, &game_mode).await.ok();

    let wait_time_so_far = if let Some(ref entry) = queue_entry {
        Some(Utc::now().signed_duration_since(entry.joined_at).num_seconds())
    } else {
        None
    };

    Ok(HttpResponse::Ok().json(QueueStatusResponse {
        in_queue,
        queue_entry,
        queue_size,
        estimated_wait_time,
        wait_time_so_far,
    }))
}

/// Get matchmaking statistics
pub async fn get_matchmaking_stats(
    db_pool: web::Data<DbPool>,
    matchmaker: web::Data<MatchmakerService>,
) -> Result<HttpResponse> {
    // Get total players in queue from database
    let total_query = sqlx::query!(
        "SELECT COUNT(*) as count FROM matchmaking_queue WHERE status = $1",
        QueueStatus::Waiting as _
    )
    .fetch_one(db_pool.as_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    let total_players_in_queue = total_query.count.unwrap_or(0) as usize;

    // Get stats by game and game mode
    let game_stats_query = sqlx::query!(
        r#"
        SELECT game, game_mode, COUNT(*) as player_count
        FROM matchmaking_queue 
        WHERE status = $1
        GROUP BY game, game_mode
        ORDER BY game, game_mode
        "#,
        QueueStatus::Waiting as _
    )
    .fetch_all(db_pool.as_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    let mut games_map: std::collections::HashMap<String, Vec<(String, usize)>> = std::collections::HashMap::new();
    
    for row in game_stats_query {
        games_map
            .entry(row.game)
            .or_insert_with(Vec::new)
            .push((row.game_mode, row.player_count.unwrap_or(0) as usize));
    }

    let mut games = Vec::new();
    for (game, modes) in games_map {
        let mut game_mode_stats = Vec::new();
        for (game_mode, player_count) in modes {
            let matches_per_hour = get_matches_per_hour(&db_pool, &game, &game_mode).await.unwrap_or(0);
            let average_wait_time = get_average_wait_time(&db_pool, &game, &game_mode).await.ok();

            game_mode_stats.push(GameModeStats {
                game_mode,
                players_in_queue: player_count,
                average_wait_time,
                matches_per_hour,
            });
        }

        games.push(GameQueueStats {
            game,
            game_modes: game_mode_stats,
        });
    }

    // Get overall stats
    let matches_created_last_hour = get_matches_created_last_hour(&db_pool).await.unwrap_or(0);
    let average_wait_time = get_overall_average_wait_time(&db_pool).await.unwrap_or(0.0);

    Ok(HttpResponse::Ok().json(MatchmakingStatsResponse {
        total_players_in_queue,
        games,
        matches_created_last_hour,
        average_wait_time,
    }))
}

/// Get user's ELO rating
pub async fn get_elo(
    db_pool: web::Data<DbPool>,
    claims: web::ReqData<Claims>,
    path: web::Path<String>, // game
) -> Result<HttpResponse> {
    let user_id = claims.user_id;
    let game = path.into_inner();

    let elo_record = sqlx::query_as!(
        UserElo,
        "SELECT * FROM user_elo WHERE user_id = $1 AND game = $2",
        user_id,
        game
    )
    .fetch_optional(db_pool.as_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    match elo_record {
        Some(elo) => Ok(HttpResponse::Ok().json(elo)),
        None => {
            // Create default ELO record
            create_default_elo(&db_pool, user_id, &game).await?;
            let default_elo = get_user_elo(&db_pool, user_id, &game).await?;
            Ok(HttpResponse::Ok().json(default_elo))
        }
    }
}

/// Get user's ELO history
pub async fn get_elo_history(
    db_pool: web::Data<DbPool>,
    claims: web::ReqData<Claims>,
    path: web::Path<(String, i32, i32)>, // (game, page, limit)
) -> Result<HttpResponse> {
    let user_id = claims.user_id;
    let (game, page, limit) = path.into_inner();
    let offset = (page - 1) * limit;

    let history = sqlx::query_as!(
        EloHistory,
        r#"
        SELECT * FROM elo_history 
        WHERE user_id = $1 AND game = $2
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
        "#,
        user_id,
        game,
        limit,
        offset
    )
    .fetch_all(db_pool.as_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(HttpResponse::Ok().json(history))
}

// Helper functions

async fn get_user_elo(db_pool: &DbPool, user_id: Uuid, game: &str) -> Result<UserElo, ApiError> {
    let elo_record = sqlx::query_as!(
        UserElo,
        "SELECT * FROM user_elo WHERE user_id = $1 AND game = $2",
        user_id,
        game
    )
    .fetch_one(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(elo_record)
}

async fn create_default_elo(db_pool: &DbPool, user_id: Uuid, game: &str) -> Result<(), ApiError> {
    sqlx::query!(
        "INSERT INTO user_elo (user_id, game, current_rating, wins, losses, draws, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        user_id,
        game,
        1200i32, // Default ELO
        0i32,
        0i32,
        0i32,
        Utc::now(),
        Utc::now()
    )
    .execute(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(())
}

async fn add_to_database_queue(
    db_pool: &DbPool,
    user_id: Uuid,
    game: &str,
    game_mode: &str,
    current_elo: i32,
) -> Result<(), ApiError> {
    sqlx::query!(
        r#"
        INSERT INTO matchmaking_queue (
            id, user_id, game, game_mode, current_elo, min_elo, max_elo,
            joined_at, expires_at, status
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
        "#,
        Uuid::new_v4(),
        user_id,
        game,
        game_mode,
        current_elo,
        current_elo - 100, // Initial range
        current_elo + 100,
        Utc::now(),
        Utc::now() + chrono::Duration::minutes(10), // 10 minute expiry
        QueueStatus::Waiting as _
    )
    .execute(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(())
}

async fn update_database_queue_status(
    db_pool: &DbPool,
    user_id: Uuid,
    game: &str,
    game_mode: &str,
) -> Result<(), ApiError> {
    sqlx::query!(
        "UPDATE matchmaking_queue SET status = $1 WHERE user_id = $2 AND game = $3 AND game_mode = $4",
        QueueStatus::Left as _,
        user_id,
        game,
        game_mode
    )
    .execute(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(())
}

async fn get_matches_per_hour(db_pool: &DbPool, game: &str, game_mode: &str) -> Result<i64, ApiError> {
    let one_hour_ago = Utc::now() - chrono::Duration::hours(1);
    
    let result = sqlx::query!(
        "SELECT COUNT(*) as count FROM matches WHERE game_mode = $1 AND created_at >= $2",
        format!("{}:{}", game, game_mode),
        one_hour_ago
    )
    .fetch_one(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(result.count.unwrap_or(0))
}

async fn get_average_wait_time(db_pool: &DbPool, game: &str, game_mode: &str) -> Result<Option<i32>, ApiError> {
    let result = sqlx::query!(
        r#"
        SELECT AVG(EXTRACT(EPOCH FROM (matched_at - joined_at))::INTEGER) as avg_wait_seconds
        FROM matchmaking_queue 
        WHERE game = $1 AND game_mode = $2 
        AND status = $3 
        AND matched_at IS NOT NULL
        AND created_at >= $4
        "#,
        game,
        game_mode,
        QueueStatus::Matched as _,
        Utc::now() - chrono::Duration::hours(1)
    )
    .fetch_one(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(result.avg_wait_seconds.map(|x| x as i32))
}

async fn get_matches_created_last_hour(db_pool: &DbPool) -> Result<i64, ApiError> {
    let one_hour_ago = Utc::now() - chrono::Duration::hours(1);
    
    let result = sqlx::query!(
        "SELECT COUNT(*) as count FROM matches WHERE created_at >= $1",
        one_hour_ago
    )
    .fetch_one(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(result.count.unwrap_or(0))
}

async fn get_overall_average_wait_time(db_pool: &DbPool) -> Result<f64, ApiError> {
    let result = sqlx::query!(
        r#"
        SELECT AVG(EXTRACT(EPOCH FROM (matched_at - joined_at))::INTEGER) as avg_wait_seconds
        FROM matchmaking_queue 
        WHERE status = $1 
        AND matched_at IS NOT NULL
        AND created_at >= $2
        "#,
        QueueStatus::Matched as _,
        Utc::now() - chrono::Duration::hours(1)
    )
    .fetch_one(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(result.avg_wait_seconds.unwrap_or(0.0))
}

// Helper functions for calculating ELO ranges and wait times
fn calculate_elo_range(current_elo: i32, wait_time_minutes: i64) -> (i32, i32) {
    let base_range = 100;
    let expansion = (wait_time_minutes as f64 / 30.0).floor() as i32 * 50; // Expand by 50 every 30 minutes
    let max_range = 500;
    
    let range = (base_range + expansion).min(max_range);
    (current_elo - range, current_elo + range)
}

fn estimate_wait_time(queue_size: usize, player_elo: i32) -> i32 {
    // Base wait time: 2 minutes per person in queue
    let base_wait = queue_size as i32 * 120;
    
    // Adjust based on ELO (extreme ELOs wait longer)
    let elo_adjustment = if player_elo < 1000 || player_elo > 2000 {
        300 // 5 extra minutes
    } else {
        0
    };
    
    base_wait + elo_adjustment
}
