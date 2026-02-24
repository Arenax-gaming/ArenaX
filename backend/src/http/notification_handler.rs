use actix_web::{web, HttpRequest, HttpResponse, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::db::DbPool;

/// API response wrapper matching frontend ApiResponse<T>
#[derive(Serialize)]
struct ApiResponse<T: Serialize> {
    data: T,
}

#[derive(Debug, FromRow, Serialize)]
struct NotificationRow {
    id: Uuid,
    user_id: Uuid,
    #[sqlx(rename = "type")]
    typ: String,
    title: String,
    message: String,
    link: Option<String>,
    link_label: Option<String>,
    read: bool,
    created_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateNotificationRequest {
    #[serde(rename = "type")]
    typ: Option<String>,
    title: String,
    message: Option<String>,
    link: Option<String>,
    link_label: Option<String>,
}

fn notification_to_json(row: NotificationRow) -> serde_json::Value {
    serde_json::json!({
        "id": row.id.to_string(),
        "type": row.typ,
        "title": row.title,
        "message": row.message,
        "link": row.link,
        "linkLabel": row.link_label,
        "read": row.read,
        "createdAt": row.created_at.to_rfc3339()
    })
}

/// GET /api/notifications - List user notifications (requires auth)
pub async fn get_notifications(
    req: HttpRequest,
    pool: web::Data<DbPool>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;

    let rows = sqlx::query_as::<_, NotificationRow>(
        r#"
        SELECT id, user_id, type, title, message, link, link_label, read, created_at
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 100
        "#,
    )
    .bind(user_id)
    .fetch_all(pool.as_ref())
    .await
    .map_err(ApiError::DatabaseError)?;

    let data: Vec<serde_json::Value> = rows.into_iter().map(notification_to_json).collect();

    Ok(HttpResponse::Ok().json(ApiResponse { data }))
}

/// POST /api/notifications - Create notification (requires auth)
pub async fn create_notification(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    body: web::Json<CreateNotificationRequest>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;

    let typ = body
        .typ
        .as_deref()
        .unwrap_or("info")
        .to_string();
    let message = body.message.as_deref().unwrap_or("").to_string();

    let row = sqlx::query_as::<_, NotificationRow>(
        r#"
        INSERT INTO notifications (user_id, type, title, message, link, link_label)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, user_id, type, title, message, link, link_label, read, created_at
        "#,
    )
    .bind(user_id)
    .bind(&typ)
    .bind(&body.title)
    .bind(&message)
    .bind(&body.link)
    .bind(&body.link_label)
    .fetch_one(pool.as_ref())
    .await
    .map_err(ApiError::DatabaseError)?;

    Ok(HttpResponse::Created().json(ApiResponse {
        data: notification_to_json(row),
    }))
}

/// PATCH /api/notifications/:id/read - Mark as read (requires auth)
pub async fn mark_notification_read(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;
    let id = path.into_inner();

    let result = sqlx::query(
        r#"
        UPDATE notifications
        SET read = true
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(id)
    .bind(user_id)
    .execute(pool.as_ref())
    .await
    .map_err(ApiError::DatabaseError)?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(HttpResponse::Ok().json(ApiResponse {
        data: serde_json::json!({ "ok": true }),
    }))
}

/// PATCH /api/notifications/read-all - Mark all as read (requires auth)
pub async fn mark_all_read(
    req: HttpRequest,
    pool: web::Data<DbPool>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;

    sqlx::query(
        r#"
        UPDATE notifications
        SET read = true
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .execute(pool.as_ref())
    .await
    .map_err(ApiError::DatabaseError)?;

    Ok(HttpResponse::Ok().json(ApiResponse {
        data: serde_json::json!({ "ok": true }),
    }))
}

/// DELETE /api/notifications/:id - Delete notification (requires auth)
pub async fn delete_notification(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;
    let id = path.into_inner();

    let result = sqlx::query(
        r#"
        DELETE FROM notifications
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(id)
    .bind(user_id)
    .execute(pool.as_ref())
    .await
    .map_err(ApiError::DatabaseError)?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(HttpResponse::Ok().json(ApiResponse {
        data: serde_json::json!({ "ok": true }),
    }))
}
