use actix_web::{http::header, web, HttpRequest, HttpResponse, Result};
use serde::Deserialize;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::auth::jwt_service::JwtService;
use crate::service::social_service::{FeedCursor, DEFAULT_FEED_LIMIT};
use crate::service::SocialService;

#[derive(Deserialize)]
pub struct AddFriendRequest {
    pub friend_id: Uuid,
}

#[derive(Deserialize)]
pub struct SendMessageRequest {
    pub to_user_id: Uuid,
    pub content: String,
}

#[derive(Deserialize)]
pub struct CreatePartyRequest {
    pub name: String,
    pub description: Option<String>,
    pub max_members: Option<i32>,
}

#[derive(Deserialize)]
pub struct AcceptFriendRequestBody {
    pub request_id: Uuid,
}

#[derive(Deserialize)]
pub struct FeedQuery {
    /// Opaque cursor from a previous response's `nextCursor`.
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct FeedOffsetQuery {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
}

/// Resolve the caller from an `Authorization: Bearer` header, if there is one.
///
/// The feed is readable anonymously, so a missing, expired or suspended token
/// degrades to "no personalisation" instead of a 401 — only `is_liked` depends
/// on knowing who is asking.
async fn optional_viewer(req: &HttpRequest, jwt_service: &JwtService) -> Option<Uuid> {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")?;

    let claims = jwt_service.validate_token(token).await.ok()?;
    Uuid::parse_str(&claims.sub).ok()
}

/// GET /api/social/feed — community feed, cursor paginated (#1528)
pub async fn get_feed(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    jwt_service: web::Data<Arc<JwtService>>,
    query: web::Query<FeedQuery>,
) -> Result<HttpResponse, ApiError> {
    let viewer = optional_viewer(&req, jwt_service.get_ref()).await;
    let cursor = query
        .cursor
        .as_deref()
        .filter(|raw| !raw.is_empty())
        .map(FeedCursor::decode)
        .transpose()?;

    let service = SocialService::new(pool.get_ref().clone());
    let page = service
        .get_feed(
            viewer,
            cursor.as_ref(),
            query.limit.unwrap_or(DEFAULT_FEED_LIMIT),
        )
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": page
    })))
}

/// GET /api/social/feed/offset — community feed, offset paginated (deprecated)
///
/// Kept for clients written against the original offset contract. Responses
/// advertise the replacement endpoint (#1528).
pub async fn get_feed_offset(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    jwt_service: web::Data<Arc<JwtService>>,
    query: web::Query<FeedOffsetQuery>,
) -> Result<HttpResponse, ApiError> {
    let viewer = optional_viewer(&req, jwt_service.get_ref()).await;

    let service = SocialService::new(pool.get_ref().clone());
    let page = service
        .get_feed_offset(
            viewer,
            query.offset.unwrap_or(0),
            query.limit.unwrap_or(DEFAULT_FEED_LIMIT),
        )
        .await?;

    Ok(HttpResponse::Ok()
        .insert_header(("Deprecation", "true"))
        .insert_header((
            "Warning",
            "299 - \"Offset pagination is deprecated; use GET /api/social/feed\"",
        ))
        .insert_header(("Link", "</api/social/feed>; rel=\"successor-version\""))
        .json(serde_json::json!({
            "success": true,
            "data": page
        })))
}

/// GET /api/v1/friends
pub async fn get_friends_list(
    pool: web::Data<PgPool>,
    user_id: web::Data<Uuid>, // From auth middleware
) -> Result<HttpResponse, ApiError> {
    let service = SocialService::new(pool.get_ref().clone());
    let friends = service.get_friends_list(*user_id.get_ref()).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": friends
    })))
}

/// POST /api/v1/friends/add
pub async fn add_friend(
    pool: web::Data<PgPool>,
    body: web::Json<AddFriendRequest>,
    user_id: web::Data<Uuid>, // From auth middleware
) -> Result<HttpResponse, ApiError> {
    let service = SocialService::new(pool.get_ref().clone());
    let request = service
        .send_friend_request(*user_id.get_ref(), body.friend_id)
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": request,
        "message": "Friend request sent"
    })))
}

/// POST /api/v1/friends/requests/accept
pub async fn accept_friend_request(
    pool: web::Data<PgPool>,
    body: web::Json<AcceptFriendRequestBody>,
) -> Result<HttpResponse, ApiError> {
    let service = SocialService::new(pool.get_ref().clone());
    service.accept_friend_request(body.request_id).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Friend request accepted"
    })))
}

/// GET /api/v1/friends/requests
pub async fn get_pending_requests(
    pool: web::Data<PgPool>,
    user_id: web::Data<Uuid>, // From auth middleware
) -> Result<HttpResponse, ApiError> {
    let service = SocialService::new(pool.get_ref().clone());
    let requests = service.get_pending_requests(*user_id.get_ref()).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": requests
    })))
}

/// POST /api/v1/messages/send
pub async fn send_message(
    pool: web::Data<PgPool>,
    body: web::Json<SendMessageRequest>,
    user_id: web::Data<Uuid>, // From auth middleware
) -> Result<HttpResponse, ApiError> {
    let service = SocialService::new(pool.get_ref().clone());
    let message = service
        .send_message(*user_id.get_ref(), body.to_user_id, body.content.clone())
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": message,
        "message": "Message sent"
    })))
}

/// GET /api/v1/messages/conversations
pub async fn get_conversations(
    pool: web::Data<PgPool>,
    user_id: web::Data<Uuid>, // From auth middleware
) -> Result<HttpResponse, ApiError> {
    let service = SocialService::new(pool.get_ref().clone());
    let conversations = service.get_conversations(*user_id.get_ref()).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": conversations
    })))
}

/// POST /api/v1/party/create
pub async fn create_party(
    pool: web::Data<PgPool>,
    body: web::Json<CreatePartyRequest>,
    user_id: web::Data<Uuid>, // From auth middleware
) -> Result<HttpResponse, ApiError> {
    let service = SocialService::new(pool.get_ref().clone());
    let party = service
        .create_party(
            *user_id.get_ref(),
            body.name.clone(),
            body.description.clone(),
            body.max_members.unwrap_or(4),
        )
        .await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": party,
        "message": "Party created"
    })))
}

/// GET /api/v1/status/:user_id
pub async fn get_online_status(
    pool: web::Data<PgPool>,
    user_id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let service = SocialService::new(pool.get_ref().clone());
    let status = service.get_online_status(*user_id).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": status
    })))
}
