//! Reputation HTTP Handler
//!
//! Provides REST API endpoints for:
//! - Getting player reputation scores
//! - Viewing reputation history
//! - Admin functions for managing bad actors

use crate::api_error::ApiError;
use crate::models::ApiResponse;
use crate::service::reputation_service::{PlayerReputation, ReputationService};
use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

/// Player reputation response
#[derive(Debug, Serialize)]
pub struct ReputationResponse {
    pub user_id: Uuid,
    pub skill_score: i32,
    pub fair_play_score: i32,
    pub is_bad_actor: bool,
    pub tier: String,
    pub last_updated: Option<String>,
}

impl From<PlayerReputation> for ReputationResponse {
    fn from(rep: PlayerReputation) -> Self {
        use crate::service::reputation_service::ReputationTier;
        
        let tier_str = match rep.get_tier() {
            ReputationTier::Elite => "elite",
            ReputationTier::Good => "good",
            ReputationTier::Average => "average",
            ReputationTier::Poor => "poor",
        };

        Self {
            user_id: rep.user_id,
            skill_score: rep.skill_score,
            fair_play_score: rep.fair_play_score,
            is_bad_actor: rep.is_bad_actor,
            tier: tier_str.to_string(),
            last_updated: Some(rep.last_update_ts.to_string()),
        }
    }
}

/// Reputation history event
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ReputationEventResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub event_type: String,
    pub skill_delta: i32,
    pub fair_play_delta: i32,
    pub match_id: Option<Uuid>,
    pub transaction_hash: Option<String>,
    pub created_at: String,
}

/// Get player reputation
pub async fn get_player_reputation(
    pool: web::Data<sqlx::PgPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user_id = path.into_inner();
    
    let reputation = sqlx::query_as::<_, PlayerReputationData>(
        r#"
        SELECT 
            id as user_id,
            COALESCE(skill_score, 1000) as skill_score,
            COALESCE(fair_play_score, 100) as fair_play_score,
            reputation_last_updated,
            COALESCE(is_bad_actor, false) as is_bad_actor
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool.get_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?
    .ok_or_else(|| ApiError::not_found("User not found"))?;

    let rep = PlayerReputation {
        user_id: reputation.user_id,
        skill_score: reputation.skill_score,
        fair_play_score: reputation.fair_play_score,
        last_update_ts: reputation
            .reputation_last_updated
            .map(|t| t.timestamp() as u64)
            .unwrap_or(0),
        is_bad_actor: reputation.is_bad_actor,
    };

    Ok(HttpResponse::Ok().json(ApiResponse::success(reputation)))
}

#[derive(sqlx::FromRow, serde::Serialize)]
struct PlayerReputationData {
    user_id: Uuid,
    skill_score: i32,
    fair_play_score: i32,
    reputation_last_updated: Option<chrono::DateTime<chrono::Utc>>,
    is_bad_actor: bool,
}

/// Get current user's reputation (authenticated endpoint)
pub async fn get_my_reputation(
    pool: web::Data<sqlx::PgPool>,
    user_id: web::ReqData<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let uid = user_id.into_inner();
    
    let reputation = sqlx::query_as::<_, PlayerReputationData>(
        r#"
        SELECT 
            id as user_id,
            COALESCE(skill_score, 1000) as skill_score,
            COALESCE(fair_play_score, 100) as fair_play_score,
            reputation_last_updated,
            COALESCE(is_bad_actor, false) as is_bad_actor
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(uid)
    .fetch_one(pool.get_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    let rep = PlayerReputation {
        user_id: reputation.user_id,
        skill_score: reputation.skill_score,
        fair_play_score: reputation.fair_play_score,
        last_update_ts: reputation
            .reputation_last_updated
            .map(|t| t.timestamp() as u64)
            .unwrap_or(0),
        is_bad_actor: reputation.is_bad_actor,
    };

    Ok(HttpResponse::Ok().json(ApiResponse::success(rep)))
}

/// Get reputation history for a player
pub async fn get_reputation_history(
    pool: web::Data<sqlx::PgPool>,
    path: web::Path<Uuid>,
    query: web::Query<PaginationQuery>,
) -> Result<HttpResponse, ApiError> {
    let user_id = path.into_inner();
    let limit = query.limit.unwrap_or(20);
    let offset = query.offset.unwrap_or(0);

    let history = sqlx::query_as::<_, ReputationEventResponse>(
        r#"
        SELECT 
            id,
            user_id,
            event_type,
            skill_delta,
            fair_play_delta,
            match_id,
            transaction_hash,
            created_at::text
        FROM reputation_events
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(user_id)
    .bind(limit as i64)
    .bind(offset as i64)
    .fetch_all(pool.get_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(HttpResponse::Ok().json(ApiResponse::success(history)))
}

/// Admin: Get list of bad actors
pub async fn get_bad_actors(
    pool: web::Data<sqlx::PgPool>,
    query: web::Query<PaginationQuery>,
) -> Result<HttpResponse, ApiError> {
    let limit = query.limit.unwrap_or(50);
    let offset = query.offset.unwrap_or(0);

    let rows = sqlx::query(
        r#"
        SELECT 
            id,
            username,
            email,
            skill_score,
            fair_play_score,
            anticheat_flags_count,
            reputation_last_updated
        FROM users
        WHERE is_bad_actor = true
        ORDER BY fair_play_score ASC, created_at DESC
        LIMIT $1 OFFSET $2
        "#,
    )
    .bind(limit as i64)
    .bind(offset as i64)
    .fetch_all(pool.get_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    let bad_actors: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<uuid::Uuid, _>("id").ok(),
                "username": row.try_get::<Option<String>, _>("username").unwrap_or(None),
                "email": row.try_get::<Option<String>, _>("email").unwrap_or(None),
                "skill_score": row.try_get::<Option<i32>, _>("skill_score").unwrap_or(None),
                "fair_play_score": row.try_get::<Option<i32>, _>("fair_play_score").unwrap_or(None),
                "anticheat_flags_count": row.try_get::<Option<i32>, _>("anticheat_flags_count").unwrap_or(None),
                "reputation_last_updated": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("reputation_last_updated")
                    .unwrap_or(None)
                    .map(|t| t.to_rfc3339()),
            })
        })
        .collect();

    Ok(HttpResponse::Ok().json(ApiResponse::success(bad_actors)))
}

/// Admin: Remove bad actor flag (appeal approval)
pub async fn remove_bad_actor_flag(
    pool: web::Data<sqlx::PgPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user_id = path.into_inner();

    sqlx::query(
        r#"
        UPDATE users
        SET is_bad_actor = false, updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .execute(pool.get_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    Ok(HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
        "message": "Bad actor flag removed",
        "user_id": user_id
    }))))
}

/// Get reputation statistics (admin only)
pub async fn get_reputation_stats(
    pool: web::Data<sqlx::PgPool>,
) -> Result<HttpResponse, ApiError> {
    let stats = sqlx::query(
        r#"
        SELECT 
            COUNT(*) FILTER (WHERE is_bad_actor = true) as bad_actors_count,
            COUNT(*) FILTER (WHERE COALESCE(fair_play_score, 100) < 50) as low_fair_play_count,
            COUNT(*) FILTER (WHERE COALESCE(skill_score, 1000) >= 1500) as high_skill_count,
            AVG(COALESCE(skill_score, 1000)) as avg_skill,
            AVG(COALESCE(fair_play_score, 100)) as avg_fair_play
        FROM users
        WHERE is_active = true
        "#,
    )
    .fetch_one(pool.get_ref())
    .await
    .map_err(|e| ApiError::database_error(e))?;

    let response = serde_json::json!({
        "bad_actors_count": stats.try_get::<i64, _>("bad_actors_count").unwrap_or(0),
        "low_fair_play_count": stats.try_get::<i64, _>("low_fair_play_count").unwrap_or(0),
        "high_skill_count": stats.try_get::<i64, _>("high_skill_count").unwrap_or(0),
        "avg_skill": stats.try_get::<f64, _>("avg_skill").unwrap_or(1000.0),
        "avg_fair_play": stats.try_get::<f64, _>("avg_fair_play").unwrap_or(100.0)
    });

    Ok(HttpResponse::Ok().json(ApiResponse::success(response)))
}

#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Configure routes
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api/reputation")
            // Public endpoints
            .route("/player/{user_id}", web::get().to(get_player_reputation))
            // Authenticated user endpoints
            .route("/me", web::get().to(get_my_reputation))
            .route("/history/{user_id}", web::get().to(get_reputation_history))
            // Admin endpoints (should be protected by admin middleware)
            .route("/bad-actors", web::get().to(get_bad_actors))
            .route("/bad-actors/{user_id}/remove", web::post().to(remove_bad_actor_flag))
            .route("/stats", web::get().to(get_reputation_stats)),
    );
}
