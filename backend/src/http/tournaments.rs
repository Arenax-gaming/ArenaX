use actix_web::{web, HttpResponse, Result, HttpRequest};
use crate::service::TournamentService;
use crate::models::tournament::*;
use crate::db::DbPool;
use crate::api_error::ApiError;
use uuid::Uuid;
use serde_json::json;

/// Create a new tournament
pub async fn create_tournament(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    request: web::Json<CreateTournamentRequest>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Extract user ID from JWT token
    let user_id = Uuid::new_v4(); // Placeholder - should come from auth middleware
    
    let tournament_service = TournamentService::new(pool.get_ref().clone());
    let tournament = tournament_service.create_tournament(user_id, request.into_inner()).await?;
    
    Ok(HttpResponse::Created().json(json!({
        "success": true,
        "data": tournament
    })))
}

/// Get tournaments with pagination and filtering
pub async fn get_tournaments(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    query: web::Query<TournamentQueryParams>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Extract user ID from JWT token
    let user_id = None; // Placeholder - should come from auth middleware
    
    let tournament_service = TournamentService::new(pool.get_ref().clone());
    let tournaments = tournament_service.get_tournaments(
        user_id,
        query.page.unwrap_or(1),
        query.per_page.unwrap_or(20),
        query.status,
        query.game.clone(),
    ).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": tournaments
    })))
}

/// Get a specific tournament by ID
pub async fn get_tournament(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Extract user ID from JWT token
    let user_id = None; // Placeholder - should come from auth middleware
    
    let tournament_id = path.into_inner();
    let tournament_service = TournamentService::new(pool.get_ref().clone());
    let tournament = tournament_service.get_tournament(tournament_id, user_id).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": tournament
    })))
}

/// Join a tournament
pub async fn join_tournament(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
    request: web::Json<JoinTournamentRequest>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Extract user ID from JWT token
    let user_id = Uuid::new_v4(); // Placeholder - should come from auth middleware
    
    let tournament_id = path.into_inner();
    let tournament_service = TournamentService::new(pool.get_ref().clone());
    let participant = tournament_service.join_tournament(user_id, tournament_id, request.into_inner()).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": participant
    })))
}

/// Update tournament status (admin only)
pub async fn update_tournament_status(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
    request: web::Json<UpdateTournamentStatusRequest>,
) -> Result<HttpResponse, ApiError> {
    // TODO: Check admin permissions
    let tournament_id = path.into_inner();
    let tournament_service = TournamentService::new(pool.get_ref().clone());
    let tournament = tournament_service.update_tournament_status(tournament_id, request.status).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": tournament
    })))
}

/// Get tournament participants
pub async fn get_tournament_participants(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament_id = path.into_inner();
    let tournament_service = TournamentService::new(pool.get_ref().clone());
    let participants = tournament_service.get_tournament_participants(tournament_id).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": participants
    })))
}

/// Get tournament bracket
pub async fn get_tournament_bracket(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament_id = path.into_inner();
    let tournament_service = TournamentService::new(pool.get_ref().clone());
    let bracket = tournament_service.get_tournament_bracket(tournament_id).await?;
    
    Ok(HttpResponse::Ok().json(json!({
        "success": true,
        "data": bracket
    })))
}

#[derive(serde::Deserialize)]
pub struct TournamentQueryParams {
    pub page: Option<i32>,
    pub per_page: Option<i32>,
    pub status: Option<TournamentStatus>,
    pub game: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct UpdateTournamentStatusRequest {
    pub status: TournamentStatus,
}
