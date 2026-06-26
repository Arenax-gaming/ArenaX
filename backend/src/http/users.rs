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
