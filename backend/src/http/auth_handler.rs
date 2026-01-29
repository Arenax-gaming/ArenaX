use crate::api_error::ApiError;
use crate::auth::jwt_service::{TokenAnalytics, TokenPair};
use crate::auth::middleware::ClaimsExt;
use crate::models::user::{AuthResponse, CreateUserRequest, LoginRequest};
use crate::service::auth_service::AuthService;
use actix_web::{web, HttpRequest, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use tracing::info;
use uuid::Uuid;

/// Refresh token request
#[derive(Debug, Deserialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
}

/// Change password request
#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub old_password: String,
    pub new_password: String,
}

/// Logout request
#[derive(Debug, Deserialize)]
pub struct LogoutRequest {
    pub token: String,
}

/// Sessions response
#[derive(Debug, Serialize)]
pub struct SessionsResponse {
    pub sessions: Vec<SessionInfo>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub device_id: Option<String>,
    pub created_at: i64,
    pub last_activity: i64,
}

/// POST /api/auth/register
/// Register a new user
pub async fn register(
    auth_service: web::Data<AuthService>,
    request: web::Json<CreateUserRequest>,
) -> Result<impl Responder, ApiError> {
    info!(
        username = %request.username,
        email = %request.email,
        "Registration request received"
    );

    let response = auth_service.register(request.into_inner()).await?;

    Ok(HttpResponse::Created().json(response))
}

/// POST /api/auth/login
/// Login user and get tokens
pub async fn login(
    auth_service: web::Data<AuthService>,
    request: web::Json<LoginRequest>,
) -> Result<impl Responder, ApiError> {
    info!(email = %request.email, "Login request received");

    let response = auth_service.login(request.into_inner()).await?;

    Ok(HttpResponse::Ok().json(response))
}

/// POST /api/auth/refresh
/// Refresh access token using refresh token
pub async fn refresh_token(
    auth_service: web::Data<AuthService>,
    request: web::Json<RefreshTokenRequest>,
) -> Result<impl Responder, ApiError> {
    info!("Token refresh request received");

    let token_pair = auth_service.refresh_token(&request.refresh_token).await?;

    Ok(HttpResponse::Ok().json(token_pair))
}

/// POST /api/auth/logout
/// Logout user (blacklist token)
pub async fn logout(
    auth_service: web::Data<AuthService>,
    req: HttpRequest,
) -> Result<impl Responder, ApiError> {
    // Extract token from Authorization header
    let auth_header = req
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or_else(|| ApiError::bad_request("Missing or invalid Authorization header"))?;

    auth_service.logout(auth_header).await?;

    info!("User logged out successfully");

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "message": "Logged out successfully"
    })))
}

/// GET /api/auth/me
/// Get current user profile (requires authentication)
pub async fn get_current_user(
    auth_service: web::Data<AuthService>,
    req: HttpRequest,
) -> Result<impl Responder, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let user = auth_service.get_user(user_id).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "is_verified": user.is_verified,
        "created_at": user.created_at,
    })))
}

/// POST /api/auth/change-password
/// Change user password (requires authentication)
pub async fn change_password(
    auth_service: web::Data<AuthService>,
    req: HttpRequest,
    request: web::Json<ChangePasswordRequest>,
) -> Result<impl Responder, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    auth_service
        .change_password(user_id, &request.old_password, &request.new_password)
        .await?;

    info!(user_id = %user_id, "Password changed successfully");

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "message": "Password changed successfully. All sessions have been revoked."
    })))
}

/// POST /api/auth/revoke-sessions
/// Revoke all user sessions (requires authentication)
pub async fn revoke_all_sessions(
    auth_service: web::Data<AuthService>,
    req: HttpRequest,
) -> Result<impl Responder, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let count = auth_service.revoke_all_sessions(user_id).await?;

    info!(user_id = %user_id, count = count, "Sessions revoked");

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "message": format!("{} session(s) revoked successfully", count),
        "count": count
    })))
}

/// GET /api/auth/sessions
/// Get all active sessions for current user (requires authentication)
pub async fn get_sessions(
    auth_service: web::Data<AuthService>,
    req: HttpRequest,
) -> Result<impl Responder, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    // This would need to be implemented in auth_service to call jwt_service
    // For now, return empty response
    Ok(HttpResponse::Ok().json(SessionsResponse {
        sessions: vec![],
        total: 0,
    }))
}

/// GET /api/auth/analytics
/// Get token analytics (admin only)
pub async fn get_analytics(
    auth_service: web::Data<AuthService>,
    req: HttpRequest,
) -> Result<impl Responder, ApiError> {
    // Check if user is admin
    let claims = req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    if !claims.roles.contains(&"admin".to_string()) {
        return Err(ApiError::forbidden("Admin access required"));
    }

    // This would need to be implemented in auth_service to call jwt_service
    // For now, return mock data
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "total_generated": 0,
        "total_validated": 0,
        "total_refreshed": 0,
        "total_blacklisted": 0,
        "active_sessions": 0
    })))
}

/// Configure authentication routes
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api/auth")
            .route("/register", web::post().to(register))
            .route("/login", web::post().to(login))
            .route("/refresh", web::post().to(refresh_token))
            .route("/logout", web::post().to(logout))
            .route("/me", web::get().to(get_current_user))
            .route("/change-password", web::post().to(change_password))
            .route("/revoke-sessions", web::post().to(revoke_all_sessions))
            .route("/sessions", web::get().to(get_sessions))
            .route("/analytics", web::get().to(get_analytics)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_request_deserialization() {
        let json = r#"{"refresh_token":"test_token"}"#;
        let req: RefreshTokenRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.refresh_token, "test_token");
    }

    #[test]
    fn test_change_password_request() {
        let json = r#"{"old_password":"old123","new_password":"new456"}"#;
        let req: ChangePasswordRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.old_password, "old123");
        assert_eq!(req.new_password, "new456");
    }
}
