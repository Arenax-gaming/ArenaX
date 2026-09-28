//! HTTP handlers for the feature toggle management system — Issue #948.
//!
//! User-facing:
//! - `GET  /api/feature-flags/evaluate`              — evaluate all flags for the caller
//! - `GET  /api/feature-flags/evaluate/{key}`        — evaluate one flag for the caller
//! - `POST /api/feature-flags/evaluate/{key}/events` — track a conversion / custom event
//!
//! Admin (remote configuration, overrides, analytics):
//! - `GET    /api/feature-flags`
//! - `POST   /api/feature-flags`
//! - `GET    /api/feature-flags/{key}`
//! - `PUT    /api/feature-flags/{key}`
//! - `DELETE /api/feature-flags/{key}`
//! - `GET    /api/feature-flags/{key}/overrides`
//! - `PUT    /api/feature-flags/{key}/overrides/{user_id}`
//! - `DELETE /api/feature-flags/{key}/overrides/{user_id}`
//! - `GET    /api/feature-flags/{key}/analytics`

use crate::{
    api_error::ApiError,
    auth::{
        jwt_service::{Claims, JwtService},
        middleware::ClaimsExt,
    },
    http::auth_handler::ACCESS_TOKEN_COOKIE,
    middleware::security::validate_uuid,
    service::feature_flags::{
        CreateFlagRequest, FeatureFlagService, SetOverrideRequest, TrackEventRequest,
        UpdateFlagRequest,
    },
};
use actix_web::{web, HttpRequest, HttpResponse};
use serde::Deserialize;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct EvaluateQuery {
    /// Admins may evaluate flags as another user.
    pub user_id: Option<String>,
}

fn require_admin(claims: &Claims) -> Result<(), ApiError> {
    if !claims.roles.contains(&"admin".to_string()) {
        return Err(ApiError::forbidden("Admin access required"));
    }
    Ok(())
}

async fn extract_claims(
    req: &HttpRequest,
    jwt: &web::Data<Arc<JwtService>>,
) -> Result<Claims, ApiError> {
    if let Some(claims) = req.claims() {
        return Ok(claims);
    }

    let header_token = req
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_owned);

    let cookie_token = req
        .cookie(ACCESS_TOKEN_COOKIE)
        .map(|c| c.value().to_owned());

    let token = header_token
        .or(cookie_token)
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;

    jwt.validate_token(&token).await.map_err(|e| match e {
        crate::auth::jwt_service::JwtError::TokenBlacklisted => {
            ApiError::forbidden("Token has been revoked")
        }
        _ => ApiError::unauthorized("Authentication required"),
    })
}

fn claims_user_id(claims: &Claims) -> Result<Uuid, ApiError> {
    Uuid::parse_str(&claims.sub).map_err(|_| ApiError::unauthorized("Invalid user ID in token"))
}

fn svc(db: &web::Data<PgPool>) -> FeatureFlagService {
    FeatureFlagService::new(db.get_ref().clone())
}

fn resolve_evaluate_user(
    claims: &Claims,
    query: &EvaluateQuery,
) -> Result<Uuid, ApiError> {
    if let Some(raw) = &query.user_id {
        require_admin(claims)?;
        return validate_uuid(raw).map_err(|e| ApiError::BadRequest(e.to_string()));
    }
    claims_user_id(claims)
}

// ─── User-facing evaluation ───────────────────────────────────────────────────

/// GET /api/feature-flags/evaluate
pub async fn evaluate_all(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<PgPool>,
    query: web::Query<EvaluateQuery>,
) -> Result<HttpResponse, ApiError> {
    let claims = extract_claims(&req, &jwt).await?;
    let user_id = resolve_evaluate_user(&claims, &query)?;
    let results = svc(&db).evaluate_all(user_id).await?;
    Ok(HttpResponse::Ok().json(results))
}

/// GET /api/feature-flags/evaluate/{key}
pub async fn evaluate_one(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<PgPool>,
    path: web::Path<String>,
    query: web::Query<EvaluateQuery>,
) -> Result<HttpResponse, ApiError> {
    let claims = extract_claims(&req, &jwt).await?;
    let user_id = resolve_evaluate_user(&claims, &query)?;
    let result = svc(&db).evaluate(&path.into_inner(), user_id).await?;
    Ok(HttpResponse::Ok().json(result))
}

/// POST /api/feature-flags/evaluate/{key}/events
pub async fn track_event(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<TrackEventRequest>,
) -> Result<HttpResponse, ApiError> {
    let claims = extract_claims(&req, &jwt).await?;
    let user_id = claims_user_id(&claims)?;
    svc(&db)
        .track_event(&path.into_inner(), user_id, body.into_inner())
        .await?;
    Ok(HttpResponse::NoContent().finish())
}

// ─── Admin: remote configuration ──────────────────────────────────────────────

/// GET /api/feature-flags
pub async fn list_flags(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let claims = extract_claims(&req, &jwt).await?;
    require_admin(&claims)?;
    let flags: Vec<_> = svc(&db)
        .list_flags()
        .await?
        .iter()
        .map(|f| f.to_response())
        .collect();
    Ok(HttpResponse::Ok().json(flags))
}

/// POST /api/feature-flags
pub async fn create_flag(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<PgPool>,
    body: web::Json<CreateFlagRequest>,
) -> Result<HttpResponse, ApiError> {
    let claims = extract_claims(&req, &jwt).await?;
    require_admin(&claims)?;
    let created_by = claims_user_id(&claims).ok();
    let flag = svc(&db).create_flag(body.into_inner(), created_by).await?;
    Ok(HttpResponse::Created().json(flag.to_response()))
}

/// GET /api/feature-flags/{key}
pub async fn get_flag(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<PgPool>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let claims = extract_claims(&req, &jwt).await?;
    require_admin(&claims)?;
    let flag = svc(&db).get_flag(&path.into_inner()).await?;
    Ok(HttpResponse::Ok().json(flag.to_response()))
}

/// PUT /api/feature-flags/{key}
pub async fn update_flag(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<UpdateFlagRequest>,
) -> Result<HttpResponse, ApiError> {
    let claims = extract_claims(&req, &jwt).await?;
    require_admin(&claims)?;
    let flag = svc(&db)
        .update_flag(&path.into_inner(), body.into_inner())
        .await?;
    Ok(HttpResponse::Ok().json(flag.to_response()))
}

/// DELETE /api/feature-flags/{key}
pub async fn delete_flag(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<PgPool>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let claims = extract_claims(&req, &jwt).await?;
    require_admin(&claims)?;
    svc(&db).delete_flag(&path.into_inner()).await?;
    Ok(HttpResponse::NoContent().finish())
}

// ─── Admin: per-user overrides ────────────────────────────────────────────────

/// GET /api/feature-flags/{key}/overrides
pub async fn list_overrides(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<PgPool>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let claims = extract_claims(&req, &jwt).await?;
    require_admin(&claims)?;
    let overrides = svc(&db).list_overrides(&path.into_inner()).await?;
    Ok(HttpResponse::Ok().json(overrides))
}

/// PUT /api/feature-flags/{key}/overrides/{user_id}
pub async fn set_override(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<PgPool>,
    path: web::Path<(String, String)>,
    body: web::Json<SetOverrideRequest>,
) -> Result<HttpResponse, ApiError> {
    let claims = extract_claims(&req, &jwt).await?;
    require_admin(&claims)?;
    let (key, user_raw) = path.into_inner();
    let user_id = validate_uuid(&user_raw).map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let created_by = claims_user_id(&claims).ok();
    let overlay = svc(&db)
        .set_override(&key, user_id, body.into_inner(), created_by)
        .await?;
    Ok(HttpResponse::Ok().json(overlay))
}

/// DELETE /api/feature-flags/{key}/overrides/{user_id}
pub async fn remove_override(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<PgPool>,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let claims = extract_claims(&req, &jwt).await?;
    require_admin(&claims)?;
    let (key, user_raw) = path.into_inner();
    let user_id = validate_uuid(&user_raw).map_err(|e| ApiError::BadRequest(e.to_string()))?;
    svc(&db).remove_override(&key, user_id).await?;
    Ok(HttpResponse::NoContent().finish())
}

// ─── Admin: analytics ─────────────────────────────────────────────────────────

/// GET /api/feature-flags/{key}/analytics
pub async fn get_analytics(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    db: web::Data<PgPool>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let claims = extract_claims(&req, &jwt).await?;
    require_admin(&claims)?;
    let analytics = svc(&db).get_analytics(&path.into_inner()).await?;
    Ok(HttpResponse::Ok().json(analytics))
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/feature-flags")
            .route("/evaluate", web::get().to(evaluate_all))
            .route("/evaluate/{key}", web::get().to(evaluate_one))
            .route("/evaluate/{key}/events", web::post().to(track_event))
            .route("", web::get().to(list_flags))
            .route("", web::post().to(create_flag))
            .route("/{key}", web::get().to(get_flag))
            .route("/{key}", web::put().to(update_flag))
            .route("/{key}", web::delete().to(delete_flag))
            .route("/{key}/overrides", web::get().to(list_overrides))
            .route("/{key}/overrides/{user_id}", web::put().to(set_override))
            .route(
                "/{key}/overrides/{user_id}",
                web::delete().to(remove_override),
            )
            .route("/{key}/analytics", web::get().to(get_analytics)),
    );
}
