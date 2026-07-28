use crate::api_error::ApiError;
use crate::auth::jwt_service::{JwtConfig, JwtService, TokenPair};
use crate::auth::middleware::ClaimsExt;
use crate::models::user::{AuthResponse, CreateUserRequest, LoginRequest};
use crate::service::auth_service::{ActiveSession, AuthService};
use actix_web::cookie::{Cookie, SameSite};
use actix_web::{web, HttpRequest, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

// ── Cookie names ──────────────────────────────────────────────────────────────

pub const ACCESS_TOKEN_COOKIE: &str = "auth_token";
pub const REFRESH_TOKEN_COOKIE: &str = "auth_refresh_token";

// ── Cookie builders ───────────────────────────────────────────────────────────

/// Build the `auth_token` (access) cookie.
///
/// - `HttpOnly` — not readable by JavaScript.
/// - `Secure`   — only sent over HTTPS (browsers ignore on localhost).
/// - `SameSite=Strict` — never sent on cross-site requests.
/// - `Path=/api` — scoped so it isn't sent for unrelated requests.
fn build_access_cookie(token: &str, max_age_secs: i64) -> Cookie<'static> {
    Cookie::build(ACCESS_TOKEN_COOKIE, token.to_owned())
        .path("/api")
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Strict)
        .max_age(actix_web::cookie::time::Duration::seconds(max_age_secs))
        .finish()
}

/// Build the `auth_refresh_token` cookie.
///
/// Scoped to `/api/auth/refresh` so it is only sent for token refresh
/// requests, minimising the attack surface.
fn build_refresh_cookie(token: &str, max_age_secs: i64) -> Cookie<'static> {
    Cookie::build(REFRESH_TOKEN_COOKIE, token.to_owned())
        .path("/api/auth/refresh")
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Strict)
        .max_age(actix_web::cookie::time::Duration::seconds(max_age_secs))
        .finish()
}

/// Build expired (clearing) versions of both cookies.
fn clear_access_cookie() -> Cookie<'static> {
    Cookie::build(ACCESS_TOKEN_COOKIE, "")
        .path("/api")
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Strict)
        .max_age(actix_web::cookie::time::Duration::seconds(0))
        .finish()
}

fn clear_refresh_cookie() -> Cookie<'static> {
    Cookie::build(REFRESH_TOKEN_COOKIE, "")
        .path("/api/auth/refresh")
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Strict)
        .max_age(actix_web::cookie::time::Duration::seconds(0))
        .finish()
}

// ── Helper: attach cookie pair to any response builder ───────────────────────

/// Attach the access + refresh httpOnly cookies to `response_builder` and
/// return the finalised `HttpResponse`.
fn response_with_auth_cookies(
    mut builder: actix_web::HttpResponseBuilder,
    tokens: &TokenPair,
    refresh_max_age: i64,
) -> HttpResponse {
    builder
        .cookie(build_access_cookie(&tokens.access_token, tokens.expires_in))
        .cookie(build_refresh_cookie(&tokens.refresh_token, refresh_max_age))
        .finish()
}

// ── Request / response DTOs ───────────────────────────────────────────────────

/// Refresh token request — accepted from JSON body as a fallback, but the
/// preferred path is the `auth_refresh_token` cookie set at login.
#[derive(Debug, Deserialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: Option<String>,
}

/// Change password request
#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub old_password: String,
    pub new_password: String,
}

/// Sessions response
#[derive(Debug, Serialize)]
pub struct SessionsResponse {
    pub sessions: Vec<ActiveSession>,
    pub total: usize,
}

/// Response body returned to the client on login / register.
///
/// Tokens are delivered as httpOnly cookies; this body carries only the user
/// profile plus `expires_in` so the frontend knows when to expect a 401.
#[derive(Debug, Serialize)]
pub struct AuthSuccessResponse {
    pub user: crate::models::user::UserProfile,
    /// Access token TTL in seconds — the frontend uses this to proactively
    /// refresh before expiry without ever touching the token value itself.
    pub expires_in: i64,
}

/// Short-lived token for WebSocket authentication handshakes.
#[derive(Debug, Serialize)]
pub struct WsTokenResponse {
    /// A signed JWT valid for 60 seconds, used only to authenticate the
    /// initial WebSocket message.  It must NOT be stored — request a fresh
    /// one immediately before opening a socket.
    pub ws_token: String,
    pub expires_in: i64,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /api/auth/register
pub async fn register(
    auth_service: web::Data<AuthService>,
    jwt_service: web::Data<Arc<JwtService>>,
    request: web::Json<CreateUserRequest>,
) -> Result<impl Responder, ApiError> {
    info!(
        username = %request.username,
        email = %request.email.as_deref().unwrap_or("(none)"),
        "Registration request received"
    );

    let response: AuthResponse = auth_service.register(request.into_inner()).await?;

    // Retrieve the refresh TTL from the JwtService config so the cookie
    // max-age matches the token lifetime exactly.
    let refresh_max_age = jwt_service
        .refresh_token_expiry_secs();

    let body = AuthSuccessResponse {
        user: response.user,
        expires_in: {
            // We don't have direct access to the access TTL here, but the
            // TokenPair carries it — reconstruct a temporary pair just for
            // the expires_in field.
            jwt_service.access_token_expiry_secs()
        },
    };

    let tokens = TokenPair {
        access_token: response.token,
        refresh_token: response.refresh_token,
        expires_in: body.expires_in,
        token_type: "Bearer".to_string(),
    };

    let mut builder = HttpResponse::Created();
    builder
        .cookie(build_access_cookie(&tokens.access_token, tokens.expires_in))
        .cookie(build_refresh_cookie(&tokens.refresh_token, refresh_max_age));
    Ok(builder.json(body))
}

/// POST /api/auth/login
pub async fn login(
    auth_service: web::Data<AuthService>,
    jwt_service: web::Data<Arc<JwtService>>,
    request: web::Json<LoginRequest>,
) -> Result<impl Responder, ApiError> {
    info!(email = %request.email, "Login request received");

    let response: AuthResponse = auth_service.login(request.into_inner()).await?;

    let refresh_max_age = jwt_service.refresh_token_expiry_secs();
    let access_expires_in = jwt_service.access_token_expiry_secs();

    let body = AuthSuccessResponse {
        user: response.user,
        expires_in: access_expires_in,
    };

    let tokens = TokenPair {
        access_token: response.token,
        refresh_token: response.refresh_token,
        expires_in: access_expires_in,
        token_type: "Bearer".to_string(),
    };

    let mut builder = HttpResponse::Ok();
    builder
        .cookie(build_access_cookie(&tokens.access_token, tokens.expires_in))
        .cookie(build_refresh_cookie(&tokens.refresh_token, refresh_max_age));
    Ok(builder.json(body))
}

/// POST /api/auth/refresh
///
/// Reads the refresh token from the `auth_refresh_token` cookie (preferred)
/// or from a JSON body field `refresh_token` (legacy / mobile clients).
pub async fn refresh_token(
    auth_service: web::Data<AuthService>,
    jwt_service: web::Data<Arc<JwtService>>,
    req: HttpRequest,
    body: web::Json<RefreshTokenRequest>,
) -> Result<impl Responder, ApiError> {
    info!("Token refresh request received");

    // Prefer the httpOnly cookie; fall back to the JSON body field.
    let refresh_token_value = req
        .cookie(REFRESH_TOKEN_COOKIE)
        .map(|c| c.value().to_owned())
        .or_else(|| body.refresh_token.clone())
        .ok_or_else(|| ApiError::bad_request("No refresh token provided"))?;

    let token_pair = auth_service.refresh_token(&refresh_token_value).await?;

    let refresh_max_age = jwt_service.refresh_token_expiry_secs();

    let mut builder = HttpResponse::Ok();
    builder
        .cookie(build_access_cookie(&token_pair.access_token, token_pair.expires_in))
        .cookie(build_refresh_cookie(&token_pair.refresh_token, refresh_max_age));
    Ok(builder.json(serde_json::json!({ "expires_in": token_pair.expires_in })))
}

/// POST /api/auth/logout
///
/// Blacklists the current access token (extracted from cookie or Authorization
/// header) and clears both auth cookies.
pub async fn logout(
    auth_service: web::Data<AuthService>,
    req: HttpRequest,
) -> Result<impl Responder, ApiError> {
    // Accept token from cookie or Authorization header.
    let token = req
        .cookie(ACCESS_TOKEN_COOKIE)
        .map(|c| c.value().to_owned())
        .or_else(|| {
            req.headers()
                .get("Authorization")
                .and_then(|h| h.to_str().ok())
                .and_then(|s| s.strip_prefix("Bearer "))
                .map(str::to_owned)
        })
        .ok_or_else(|| ApiError::bad_request("No auth token found"))?;

    auth_service.logout(&token).await?;

    info!("User logged out successfully");

    Ok(HttpResponse::Ok()
        .cookie(clear_access_cookie())
        .cookie(clear_refresh_cookie())
        .json(serde_json::json!({ "message": "Logged out successfully" })))
}

/// GET /api/auth/me
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

    // Clear cookies — the user must log in again after a password change.
    Ok(HttpResponse::Ok()
        .cookie(clear_access_cookie())
        .cookie(clear_refresh_cookie())
        .json(serde_json::json!({
            "message": "Password changed successfully. All sessions have been revoked."
        })))
}

/// POST /api/auth/revoke-sessions
pub async fn revoke_all_sessions(
    auth_service: web::Data<AuthService>,
    req: HttpRequest,
) -> Result<impl Responder, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let count = auth_service.revoke_all_sessions(user_id).await?;

    info!(user_id = %user_id, count = count, "Sessions revoked");

    Ok(HttpResponse::Ok()
        .cookie(clear_access_cookie())
        .cookie(clear_refresh_cookie())
        .json(serde_json::json!({
            "message": format!("{} session(s) revoked successfully", count),
            "count": count
        })))
}

/// GET /api/auth/sessions
pub async fn get_sessions(
    auth_service: web::Data<AuthService>,
    req: HttpRequest,
) -> Result<impl Responder, ApiError> {
    let user_id = req
        .user_id()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let sessions = auth_service.get_sessions(user_id).await?;
    let total = sessions.len();

    Ok(HttpResponse::Ok().json(SessionsResponse { sessions, total }))
}

/// GET /api/auth/analytics  (admin only)
pub async fn get_analytics(
    _auth_service: web::Data<AuthService>,
    req: HttpRequest,
) -> Result<impl Responder, ApiError> {
    let claims = req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    if !claims.roles.contains(&"admin".to_string()) {
        return Err(ApiError::forbidden("Admin access required"));
    }

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "total_generated": 0,
        "total_validated": 0,
        "total_refreshed": 0,
        "total_blacklisted": 0,
        "active_sessions": 0
    })))
}

/// GET /api/auth/ws-token
///
/// Issues a short-lived (60-second) signed access token for authenticating
/// the initial WebSocket handshake message.  The token is NOT stored in a
/// cookie — it is returned in the JSON body and used immediately.
///
/// Requires: valid `auth_token` cookie (i.e. the user must already be logged in).
pub async fn get_ws_token(
    jwt_service: web::Data<Arc<JwtService>>,
    req: HttpRequest,
) -> Result<impl Responder, ApiError> {
    let claims = req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("User not authenticated"))?;

    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::internal_error("Invalid user ID in token"))?;

    let ws_token = jwt_service
        .generate_ws_token(user_id, claims.roles)
        .await
        .map_err(|e| ApiError::internal_error(format!("WS token generation failed: {}", e)))?;

    Ok(HttpResponse::Ok().json(WsTokenResponse {
        ws_token,
        expires_in: 60,
    }))
}

/// Configure authentication routes.
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/auth")
            .route("/register", web::post().to(register))
            .route("/login", web::post().to(login))
            .route("/refresh", web::post().to(refresh_token))
            .route("/logout", web::post().to(logout))
            .route("/me", web::get().to(get_current_user))
            .route("/change-password", web::post().to(change_password))
            .route("/revoke-sessions", web::post().to(revoke_all_sessions))
            .route("/sessions", web::get().to(get_sessions))
            .route("/analytics", web::get().to(get_analytics))
            .route("/ws-token", web::get().to(get_ws_token)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_refresh_request_optional_field() {
        // Fully absent field
        let json = r#"{}"#;
        let req: RefreshTokenRequest = serde_json::from_str(json).unwrap();
        assert!(req.refresh_token.is_none());

        // Present field
        let json = r#"{"refresh_token":"test_token"}"#;
        let req: RefreshTokenRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.refresh_token.as_deref(), Some("test_token"));
    }

    #[test]
    fn test_change_password_request() {
        let json = r#"{"old_password":"old123","new_password":"new456"}"#;
        let req: ChangePasswordRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.old_password, "old123");
        assert_eq!(req.new_password, "new456");
    }
}
