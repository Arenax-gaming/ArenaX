//! Email preference and unsubscribe endpoints (Issue #905).

use actix_web::{web, HttpRequest, HttpResponse, Result};
use serde::{Deserialize, Serialize};

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::db::DbPool;
use crate::service::email_service::{EmailCategory, EmailService};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreferenceRequest {
    /// One of the optional categories — see `EmailCategory`.
    pub category: String,
    pub subscribed: bool,
}

#[derive(Debug, Serialize)]
struct Envelope<T> {
    data: T,
}

/// GET /api/email/preferences — the caller's per-category opt-outs.
pub async fn get_preferences(
    req: HttpRequest,
    pool: web::Data<DbPool>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;
    let service = EmailService::from_env(pool.get_ref().clone());

    let preferences = service.preferences(user_id).await?;
    Ok(HttpResponse::Ok().json(Envelope { data: preferences }))
}

/// PUT /api/email/preferences — switch one category on or off.
pub async fn update_preference(
    req: HttpRequest,
    pool: web::Data<DbPool>,
    body: web::Json<UpdatePreferenceRequest>,
) -> Result<HttpResponse, ApiError> {
    let user_id = req.user_id().ok_or(ApiError::Unauthorized)?;

    let category = EmailCategory::from_str(&body.category).ok_or_else(|| {
        ApiError::BadRequest(format!("Unknown email category '{}'", body.category))
    })?;

    let service = EmailService::from_env(pool.get_ref().clone());
    // The service refuses to switch off a non-optional category, so an attempt
    // to mute security mail comes back as a 400 rather than silently working.
    service.set_preference(user_id, category, body.subscribed).await?;

    let preferences = service.preferences(user_id).await?;
    Ok(HttpResponse::Ok().json(Envelope { data: preferences }))
}

/// GET /api/email/unsubscribe/{token} — honour an unsubscribe link.
///
/// Unauthenticated on purpose: the whole point is that it works from a mail
/// client, where the reader has no session. The token is the authorization,
/// which is why it is random and single-purpose rather than the user's id.
pub async fn unsubscribe(
    pool: web::Data<DbPool>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let service = EmailService::from_env(pool.get_ref().clone());
    service.unsubscribe_by_token(&path.into_inner()).await?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "data": { "unsubscribed": true }
    })))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api/email")
            .route("/preferences", web::get().to(get_preferences))
            .route("/preferences", web::put().to(update_preference))
            .route("/unsubscribe/{token}", web::get().to(unsubscribe)),
    );
}
