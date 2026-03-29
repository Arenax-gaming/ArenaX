use crate::api_error::ApiError;
use crate::auth::jwt_service::Claims;
use crate::db::DbPool;
use crate::models::matchmaker::*;
use crate::service::matchmaker::MatchmakerService;
use actix_web::{web, HttpResponse, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::Row;
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
    pub queue_entry: Option<crate::service::matchmaker::QueueEntry>,
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
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|e| ApiError::bad_request(format!("Invalid user ID: {}", e)))?;
    let game = request.game.clone();
    let game_mode = request.game_mode.clone();

    // Check if user is already in queue
    match matchmaker.is_user_in_queue(user_id, &game, &game_mode).await {
        Ok(Some(_entry)) => {
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
    let current_elo: i32 = match get_user_elo(&db_pool, user_id, &game).await {
        Ok(elo) => elo.current_rating,
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
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|e| ApiError::bad_request(format!("Invalid user ID: {}", e)))?;
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

    // Remove from queue via the service's public API
    if let Err(e) = matchmaker.leave_queue(user_id, &game, &game_mode).await {
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
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|e| ApiError::bad_request(format!("Invalid user ID: {}", e)))?;
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
    _matchmaker: web::Data<MatchmakerService>,
) -> Result<HttpResponse> {
    // Get total players in queue from database
    let total_row = sqlx::query("SELECT COUNT(*) as count FROM matchmaking_queue WHERE status = $1")
        .bind(format!("{:?}", QueueStatus::Waiting))
        .fetch_one(db_pool.as_ref())
        .await
        .map_err(|e| ApiError::database_error(e))?;

    let total_players_in_queue: i64 = total_row.try_get("count").unwrap_or(0);

    // Get stats by game and game mode
    let game_stats_rows = sqlx::query(
        r#"
        SELECT game, game_mode, COUNT(*) as player_count
        FROM matchmaking_queue 
        WHERE status = $1
        GROUP BY game, game_mode
        ORDER BY game, game_mode
        "#,
    )
    .bind(format!("{:?}", QueueStatus::Waiting))
    .fetch_all(db_pool.as_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    let mut games_map: std::collections::HashMap<String, Vec<(String, usize)>> =
        std::collections::HashMap::new();

    for row in game_stats_rows {
        let game: String = row.try_get("game").unwrap_or_default();
        let game_mode: String = row.try_get("game_mode").unwrap_or_default();
        let player_count: i64 = row.try_get("player_count").unwrap_or(0);
        games_map
            .entry(game)
            .or_insert_with(Vec::new)
            .push((game_mode, player_count as usize));
    }

    let mut games = Vec::new();
    for (game, modes) in games_map {
        let mut game_mode_stats = Vec::new();
        for (game_mode, player_count) in modes {
            let matches_per_hour = get_matches_per_hour(&db_pool, &game, &game_mode)
                .await
                .unwrap_or(0);
            let average_wait_time = get_average_wait_time(&db_pool, &game, &game_mode).await.ok().flatten();

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
        total_players_in_queue: total_players_in_queue as usize,
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
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|e| ApiError::bad_request(format!("Invalid user ID: {}", e)))?;
    let game = path.into_inner();

    let elo_record = sqlx::query_as::<_, UserElo>(
        "SELECT * FROM user_elo WHERE user_id = $1 AND game = $2",
    )
    .bind(user_id)
    .bind(&game)
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
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|e| ApiError::bad_request(format!("Invalid user ID: {}", e)))?;
    let (game, page, limit) = path.into_inner();
    let offset = (page - 1) * limit;

    let history = sqlx::query_as::<_, EloHistory>(
        r#"
        SELECT * FROM elo_history 
        WHERE user_id = $1 AND game = $2
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
        "#,
    )
    .bind(user_id)
    .bind(game)
    .bind(limit as i64)
    .bind(offset as i64)
    .fetch_all(db_pool.as_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(HttpResponse::Ok().json(history))
}

// Helper functions

async fn get_user_elo(db_pool: &DbPool, user_id: Uuid, game: &str) -> Result<UserElo, ApiError> {
    let elo_record = sqlx::query_as::<_, UserElo>(
        "SELECT * FROM user_elo WHERE user_id = $1 AND game = $2",
    )
    .bind(user_id)
    .bind(game)
    .fetch_one(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(elo_record)
}

async fn create_default_elo(
    db_pool: &DbPool,
    user_id: Uuid,
    game: &str,
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO user_elo (user_id, game, current_rating, wins, losses, draws, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(user_id)
    .bind(game)
    .bind(1200i32)
    .bind(0i32)
    .bind(0i32)
    .bind(0i32)
    .bind(Utc::now())
    .bind(Utc::now())
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
    sqlx::query(
        r#"
        INSERT INTO matchmaking_queue (
            id, user_id, game, game_mode, current_elo, min_elo, max_elo,
            joined_at, expires_at, status
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(game)
    .bind(game_mode)
    .bind(current_elo)
    .bind(current_elo - 100)
    .bind(current_elo + 100)
    .bind(Utc::now())
    .bind(Utc::now() + chrono::Duration::minutes(10))
    .bind(format!("{:?}", QueueStatus::Waiting))
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
    sqlx::query(
        "UPDATE matchmaking_queue SET status = $1 WHERE user_id = $2 AND game = $3 AND game_mode = $4",
    )
    .bind(format!("{:?}", QueueStatus::Left))
    .bind(user_id)
    .bind(game)
    .bind(game_mode)
    .execute(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(())
}

async fn get_matches_per_hour(
    db_pool: &DbPool,
    game: &str,
    game_mode: &str,
) -> Result<i64, ApiError> {
    let one_hour_ago = Utc::now() - chrono::Duration::hours(1);

    let result = sqlx::query(
        "SELECT COUNT(*) as count FROM matches WHERE game_mode = $1 AND created_at >= $2",
    )
    .bind(format!("{}:{}", game, game_mode))
    .bind(one_hour_ago)
    .fetch_one(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(result.try_get::<i64, _>("count").unwrap_or(0))
}

async fn get_average_wait_time(
    db_pool: &DbPool,
    game: &str,
    game_mode: &str,
) -> Result<Option<i32>, ApiError> {
    let result = sqlx::query(
        r#"
        SELECT AVG(EXTRACT(EPOCH FROM (matched_at - joined_at))::INTEGER) as avg_wait_seconds
        FROM matchmaking_queue 
        WHERE game = $1 AND game_mode = $2 
        AND status = $3 
        AND matched_at IS NOT NULL
        AND created_at >= $4
        "#,
    )
    .bind(game)
    .bind(game_mode)
    .bind(format!("{:?}", QueueStatus::Matched))
    .bind(Utc::now() - chrono::Duration::hours(1))
    .fetch_one(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(result.try_get::<Option<i32>, _>("avg_wait_seconds").unwrap_or(None))
}

async fn get_matches_created_last_hour(db_pool: &DbPool) -> Result<i64, ApiError> {
    let one_hour_ago = Utc::now() - chrono::Duration::hours(1);

    let result = sqlx::query("SELECT COUNT(*) as count FROM matches WHERE created_at >= $1")
        .bind(one_hour_ago)
        .fetch_one(db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

    Ok(result.try_get::<i64, _>("count").unwrap_or(0))
}

async fn get_overall_average_wait_time(db_pool: &DbPool) -> Result<f64, ApiError> {
    let result = sqlx::query(
        r#"
        SELECT AVG(EXTRACT(EPOCH FROM (matched_at - joined_at))::INTEGER) as avg_wait_seconds
        FROM matchmaking_queue 
        WHERE status = $1 
        AND matched_at IS NOT NULL
        AND created_at >= $2
        "#,
    )
    .bind(format!("{:?}", QueueStatus::Matched))
    .bind(Utc::now() - chrono::Duration::hours(1))
    .fetch_one(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(result.try_get::<f64, _>("avg_wait_seconds").unwrap_or(0.0))
}
