use actix_web::{web, HttpRequest, HttpResponse, Result};
use serde::Deserialize;
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::service::UserService;

#[derive(Deserialize)]
pub struct UpdateProfileRequest {
    pub username: Option<String>,
    pub avatar_url: Option<String>,
    pub display_name: Option<String>,
    pub bio: Option<String>,
}

/// GET /api/users/{id}
/// Get public user profile by ID
pub async fn get_user_profile(
    pool: web::Data<sqlx::PgPool>,
    user_id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let service = UserService::new(pool.get_ref().clone());
    let profile = service.get_user_profile(*user_id).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": profile
    })))
}

/// GET /api/users/me
/// Get authenticated user's own profile
pub async fn get_current_user_profile(
    pool: web::Data<sqlx::PgPool>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let service = UserService::new(pool.get_ref().clone());
    let user = service.get_current_user_profile(user_id).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": user
    })))
}

/// PUT /api/users/me
/// Update authenticated user's profile
pub async fn update_user_profile(
    pool: web::Data<sqlx::PgPool>,
    req: HttpRequest,
    body: web::Json<UpdateProfileRequest>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let service = UserService::new(pool.get_ref().clone());
    let updated_user = service
        .update_user_profile(
            user_id,
            body.username.clone(),
            body.avatar_url.clone(),
            body.display_name.clone(),
            body.bio.clone(),
        )
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": updated_user,
        "message": "Profile updated successfully"
    })))
}

/// GET /api/users/{id}/stats
/// Get user stats including win/loss record and Elo history
pub async fn get_user_stats(
    pool: web::Data<sqlx::PgPool>,
    user_id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let service = UserService::new(pool.get_ref().clone());
    let stats = service.get_user_stats(*user_id).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": stats
    })))
}

/// DELETE /api/users/me
///
/// Soft-deletes the authenticated user's account (GDPR/NDPR right to erasure):
/// PII is anonymised, `deleted_at` is set, the account is deactivated and
/// login is refused. The Stellar public key is retained for the on-chain audit
/// trail.
pub async fn delete_account(
    pool: web::Data<sqlx::PgPool>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let service = UserService::new(pool.get_ref().clone());
    service.soft_delete_user(user_id).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Account deletion scheduled. Your personal data has been anonymised (right to erasure)."
    })))
}

/// GET /api/users/me/export
///
/// Queues an asynchronous data-export job. The archive is prepared in the
/// background and delivered via email link when ready (GDPR/NDPR data
/// portability; not a synchronous download).
pub async fn export_user_data(
    pool: web::Data<sqlx::PgPool>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let service = UserService::new(pool.get_ref().clone());
    let job = service.queue_data_export(user_id).await?;

    Ok(HttpResponse::Accepted().json(serde_json::json!({
        "success": true,
        "message": "Data export queued. You will receive a secure download link by email once it is ready.",
        "data": job
    })))
}

/// GET /api/users/me/export/{job_id}
///
/// Returns the status (and the retrieval link, once ready) of a queued data
/// export job.
pub async fn get_export_job(
    pool: web::Data<sqlx::PgPool>,
    req: HttpRequest,
    job_id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let service = UserService::new(pool.get_ref().clone());
    let job = service.get_export_job(job_id.into_inner(), user_id).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": job
    })))
}

/// Configure user routes.
///
/// Intended to be called via `.configure(...)` inside an existing `/api`
/// scope.  Opens a `/users` sub-scope — **not** `/api/users` — so paths
/// resolve to `/api/users/…` without a duplicate `/api` prefix.
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/users")
            .route("/{id}", web::get().to(get_user_profile))
            .route("/me", web::get().to(get_current_user_profile))
            .route("/me", web::put().to(update_user_profile))
            .route("/me", web::delete().to(delete_account))
            .route("/me/export", web::get().to(export_user_data))
            .route("/me/export/{job_id}", web::get().to(get_export_job))
            .route("/{id}/stats", web::get().to(get_user_stats)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_profile_request_deserialization() {
        let json = r#"{"username":"new_username","avatar_url":"https://example.com/avatar.jpg"}"#;
        let req: UpdateProfileRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.username, Some("new_username".to_string()));
        assert_eq!(req.avatar_url, Some("https://example.com/avatar.jpg".to_string()));
    }

    #[test]
    fn test_update_profile_request_partial() {
        let json = r#"{"display_name":"John Doe"}"#;
        let req: UpdateProfileRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.display_name, Some("John Doe".to_string()));
        assert_eq!(req.username, None);
    }
}
