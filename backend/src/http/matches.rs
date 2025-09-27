use actix_web::{web, HttpResponse, Result, HttpRequest};
use crate::service::MatchService;
use crate::models::match_models::*;
use crate::db::DbPool;
use crate::api_error::ApiError;
use uuid::Uuid;
use serde_json::json;

/// Get match details
pub async fn get_match(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Extract user ID from JWT token
    let user_id = None; // Placeholder - should come from auth middleware
    
    let match_id = path.into_inner();
    let match_service = MatchService::new(pool.get_ref().clone());
    let match_data = match_service.get_match(match_id, user_id).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": match_data
    })))
}

/// Report match score
pub async fn report_score(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
    request: web::Json<ReportScoreRequest>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Extract user ID from JWT token
    let user_id = Uuid::new_v4(); // Placeholder - should come from auth middleware
    
    let match_id = path.into_inner();
    let match_service = MatchService::new(pool.get_ref().clone());
    let score = match_service.report_score(match_id, user_id, request.into_inner()).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": score
    })))
}

/// Create a match dispute
pub async fn create_dispute(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
    request: web::Json<CreateDisputeRequest>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Extract user ID from JWT token
    let user_id = Uuid::new_v4(); // Placeholder - should come from auth middleware
    
    let match_id = path.into_inner();
    let match_service = MatchService::new(pool.get_ref().clone());
    let dispute = match_service.create_dispute(match_id, user_id, request.into_inner()).await?;
    
    Ok(HttpResponse::Created().json(json!({
        "success": true,
        "data": dispute
    })))
}

/// Join matchmaking queue
pub async fn join_matchmaking(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    request: web::Json<JoinMatchmakingRequest>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Extract user ID from JWT token
    let user_id = Uuid::new_v4(); // Placeholder - should come from auth middleware
    
    let match_service = MatchService::new(pool.get_ref().clone());
    let queue_entry = match_service.join_matchmaking(user_id, request.into_inner()).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": queue_entry
    })))
}

/// Get matchmaking status
pub async fn get_matchmaking_status(
    req: HttpRequest,
    pool: web::Data<DbPool>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Extract user ID from JWT token
    let user_id = Uuid::new_v4(); // Placeholder - should come from auth middleware
    
    let match_service = MatchService::new(pool.get_ref().clone());
    let status = match_service.get_matchmaking_status(user_id).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": status
    })))
}

/// Leave matchmaking queue
pub async fn leave_matchmaking(
    req: HttpRequest,
    pool: web::Data<DbPool>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Extract user ID from JWT token
    let user_id = Uuid::new_v4(); // Placeholder - should come from auth middleware
    
    let match_service = MatchService::new(pool.get_ref().clone());
    match_service.leave_matchmaking(user_id).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "message": "Left matchmaking queue"
    })))
}

/// Get user's Elo rating
pub async fn get_elo_rating(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Extract user ID from JWT token
    let user_id = Uuid::new_v4(); // Placeholder - should come from auth middleware
    
    let game = path.into_inner();
    let match_service = MatchService::new(pool.get_ref().clone());
    let elo = match_service.get_user_elo_rating(user_id, &game).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": elo
    })))
}

/// Get user's match history
pub async fn get_match_history(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    query: web::Query<MatchHistoryQuery>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Extract user ID from JWT token
    let user_id = Uuid::new_v4(); // Placeholder - should come from auth middleware
    
    let match_service = MatchService::new(pool.get_ref().clone());
    let history = match_service.get_user_match_history(
        user_id,
        query.page.unwrap_or(1),
        query.per_page.unwrap_or(20),
        query.game.clone(),
    ).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": history
    })))
}

/// Get match leaderboard
pub async fn get_leaderboard(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    query: web::Query<LeaderboardQuery>,
) -> Result<HttpResponse, ApiError> {
    let match_service = MatchService::new(pool.get_ref().clone());
    let leaderboard = match_service.get_leaderboard(
        query.game.clone().unwrap_or_else(|| "default".to_string()),
        query.page.unwrap_or(1),
        query.per_page.unwrap_or(50),
    ).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": leaderboard
    })))
}

#[derive(serde::Deserialize)]
pub struct MatchHistoryQuery {
    pub page: Option<i32>,
    pub per_page: Option<i32>,
    pub game: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct LeaderboardQuery {
    pub page: Option<i32>,
    pub per_page: Option<i32>,
    pub game: Option<String>,
}
