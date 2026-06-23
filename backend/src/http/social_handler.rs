use actix_web::{web, HttpResponse, Result};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::api_error::ApiError;
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

/// GET /api/v1/friends
pub async fn get_friends_list(
    pool: web::Data<PgPool>,
    user_id: web::Data<Uuid>, // From auth middleware
) -> Result<HttpResponse, ApiError> {
    let service = SocialService::new(pool.get_ref().clone());
    let friends = service.get_friends_list(*user_id).await?;

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
        .send_friend_request(*user_id, body.friend_id)
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
    let requests = service.get_pending_requests(*user_id).await?;

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
        .send_message(*user_id, body.to_user_id, body.content.clone())
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
    let conversations = service.get_conversations(*user_id).await?;

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
            *user_id,
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
