use crate::api_error::ApiError;
use crate::auth::Claims;
use crate::db::DbPool;
use crate::models::matchmaker::*;
use crate::service::matchmaker::{MatchmakerService, EloEngine, MatchmakingConfig};
use actix_web::{web, HttpResponse, Result};
use chrono::Utc;
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

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

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
        Ok(Some(_)) => {
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
        Ok(elo) => elo.current_rating,
        Err(_) => {
            create_default_elo(&db_pool, user_id, &game).await?;
            1200
        }
    };

    // Add to Redis queue
    if let Err(e) = matchmaker
        .add_to_queue(user_id, game.clone(), game_mode.clone(), current_elo)
        .await
    {
        return Err(e.into());
    }

    // Persist to DB for durability (fire-and-forget style — we already have
    // the Redis entry so the player is in the queue regardless).
    add_to_database_queue(&db_pool, user_id, &game, &game_mode, current_elo).await?;

    // Get queue size once (reuse for both position and wait-time estimate).
    let queue_size = matchmaker.get_queue_size(&game, &game_mode).await.unwrap_or(1);
    let estimated_wait_time =
        Some(MatchmakerService::estimate_wait_time_from_size(queue_size, current_elo));

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

    // Verify the player is actually in the queue
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

    // Remove via the service's public method (uses the shared connection manager)
    if let Err(e) = matchmaker
        .remove_from_queue(&mut matchmaker.redis_conn(), &user_id, &game, &game_mode)
        .await
    {
        return Err(e.into());
    }

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
    path: web::Path<(String, String)>,
) -> Result<HttpResponse> {
    let user_id = claims.user_id;
    let (game, game_mode) = path.into_inner();

    let queue_entry = matchmaker.is_user_in_queue(user_id, &game, &game_mode).await?;
    let in_queue = queue_entry.is_some();

    // Single SCAN call for queue size; derive wait estimate from it.
    let queue_size = matchmaker.get_queue_size(&game, &game_mode).await.unwrap_or(0);
    let current_elo = queue_entry.as_ref().map(|e| e.current_elo).unwrap_or(1200);
    let estimated_wait_time = if in_queue {
        Some(MatchmakerService::estimate_wait_time_from_size(queue_size, current_elo))
    } else {
        None
    };

    let wait_time_so_far = queue_entry.as_ref().map(|e| {
        Utc::now().signed_duration_since(e.joined_at).num_seconds()
    });

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
    // Single query: total players waiting
    let total_query = sqlx::query!(
        "SELECT COUNT(*) as count FROM matchmaking_queue WHERE status = $1",
        QueueStatus::Waiting as _
    )
    .fetch_one(db_pool.as_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    let total_players_in_queue = total_query.count.unwrap_or(0) as usize;

    // Single query: per-game-mode player counts
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

    // Single query: matches-per-hour per game/mode (replaces N+1 loop)
    let one_hour_ago = Utc::now() - chrono::Duration::hours(1);
    let mph_query = sqlx::query!(
        r#"
        SELECT game_mode, COUNT(*) as cnt
        FROM matches
        WHERE created_at >= $1
        GROUP BY game_mode
        "#,
        one_hour_ago
    )
    .fetch_all(db_pool.as_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    // Build a lookup: "game:game_mode" → matches_per_hour
    let mph_map: std::collections::HashMap<String, i64> = mph_query
        .into_iter()
        .map(|r| (r.game_mode, r.cnt.unwrap_or(0)))
        .collect();

    // Single query: average wait time per game/mode (replaces N+1 loop)
    let avg_wait_query = sqlx::query!(
        r#"
        SELECT game, game_mode,
               AVG(EXTRACT(EPOCH FROM (matched_at - joined_at))::INTEGER)::INTEGER as avg_wait
        FROM matchmaking_queue
        WHERE status = $1
          AND matched_at IS NOT NULL
          AND created_at >= $2
        GROUP BY game, game_mode
        "#,
        QueueStatus::Matched as _,
        one_hour_ago
    )
    .fetch_all(db_pool.as_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    // Build a lookup: (game, game_mode) → avg_wait_seconds
    let mut avg_wait_map: std::collections::HashMap<(String, String), i32> =
        std::collections::HashMap::new();
    for row in avg_wait_query {
        if let Some(w) = row.avg_wait {
            avg_wait_map.insert((row.game, row.game_mode), w);
        }
    }

    // Assemble response
    let mut games_map: std::collections::HashMap<String, Vec<GameModeStats>> =
        std::collections::HashMap::new();

    for row in game_stats_query {
        let mph_key = format!("{}:{}", row.game, row.game_mode);
        let matches_per_hour = mph_map.get(&mph_key).copied().unwrap_or(0);
        let average_wait_time = avg_wait_map.get(&(row.game.clone(), row.game_mode.clone())).copied();

        games_map
            .entry(row.game)
            .or_default()
            .push(GameModeStats {
                game_mode: row.game_mode,
                players_in_queue: row.player_count.unwrap_or(0) as usize,
                average_wait_time,
                matches_per_hour,
            });
    }

    let games: Vec<GameQueueStats> = games_map
        .into_iter()
        .map(|(game, game_modes)| GameQueueStats { game, game_modes })
        .collect();

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
    path: web::Path<String>,
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
    path: web::Path<(String, i32, i32)>,
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

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

async fn get_user_elo(db_pool: &DbPool, user_id: Uuid, game: &str) -> Result<UserElo, ApiError> {
    sqlx::query_as!(
        UserElo,
        "SELECT * FROM user_elo WHERE user_id = $1 AND game = $2",
        user_id,
        game
    )
    .fetch_one(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))
}

async fn create_default_elo(db_pool: &DbPool, user_id: Uuid, game: &str) -> Result<(), ApiError> {
    sqlx::query!(
        "INSERT INTO user_elo (user_id, game, current_rating, wins, losses, draws, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (user_id, game) DO NOTHING",
        user_id,
        game,
        1200i32,
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
        current_elo - 100,
        current_elo + 100,
        Utc::now(),
        Utc::now() + chrono::Duration::minutes(10),
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
        "UPDATE matchmaking_queue SET status = $1 WHERE user_id = $2 AND game = $3 AND game_mode = $4 AND status = $5",
        QueueStatus::Left as _,
        user_id,
        game,
        game_mode,
        QueueStatus::Waiting as _
    )
    .execute(db_pool)
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(())
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
