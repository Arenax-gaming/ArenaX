//! IP whitelist / blacklist admin handler — Issue #975.
//!
//! Admin-only REST endpoints for managing IP access lists.
//!
//! Endpoints:
//! - `GET    /api/admin/ip-list?type=whitelist|blacklist` — list all IPs
//! - `POST   /api/admin/ip-list` — add an IP to a list
//! - `DELETE /api/admin/ip-list` — remove an IP from a list
//! - `GET    /api/admin/ip-list/check?ip=1.2.3.4` — check an IP's status

use crate::{
    api_error::ApiError,
    auth::middleware::ClaimsExt,
    middleware::ip_list::{
        add_to_blacklist, add_to_whitelist, is_blacklisted, is_whitelisted,
        list_blacklist, list_whitelist, remove_from_blacklist, remove_from_whitelist,
    },
};
use actix_web::{web, HttpRequest, HttpResponse};
use redis::aio::ConnectionManager;
use serde::Deserialize;
use std::sync::Arc;

// ─── Request types ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct IpListQuery {
    /// "whitelist" or "blacklist"
    pub r#type: Option<String>,
}

#[derive(Deserialize)]
pub struct IpCheckQuery {
    pub ip: String,
}

#[derive(Deserialize)]
pub struct AddIpRequest {
    pub ip: String,
    /// "whitelist" or "blacklist"
    pub list: String,
    /// Optional TTL in seconds for blacklist entries (0 = permanent)
    pub ttl_secs: Option<u64>,
}

#[derive(Deserialize)]
pub struct RemoveIpRequest {
    pub ip: String,
    /// "whitelist" or "blacklist"
    pub list: String,
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/// Require admin role, return claims or error.
fn require_admin(req: &HttpRequest) -> Result<crate::auth::jwt_service::Claims, ApiError> {
    let claims = req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("Not authenticated"))?;

    if !claims.roles.contains(&"admin".to_string()) {
        return Err(ApiError::forbidden("Admin access required"));
    }

    Ok(claims)
}

/// GET /api/admin/ip-list
///
/// List all IPs in the whitelist or blacklist.
pub async fn list_ips(
    req: HttpRequest,
    query: web::Query<IpListQuery>,
    redis: web::Data<Arc<ConnectionManager>>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;

    let mut conn = (**redis).clone();
    let list_type = query.r#type.as_deref().unwrap_or("whitelist");

    match list_type {
        "whitelist" => {
            let ips = list_whitelist(&mut conn).await;
            Ok(HttpResponse::Ok().json(serde_json::json!({
                "list": "whitelist",
                "ips": ips,
                "count": ips.len(),
            })))
        }
        "blacklist" => {
            let ips = list_blacklist(&mut conn).await;
            Ok(HttpResponse::Ok().json(serde_json::json!({
                "list": "blacklist",
                "ips": ips,
                "count": ips.len(),
            })))
        }
        _ => Err(ApiError::bad_request("Invalid list type; use 'whitelist' or 'blacklist'")),
    }
}

/// POST /api/admin/ip-list
///
/// Add an IP to the whitelist or blacklist.
pub async fn add_ip(
    req: HttpRequest,
    body: web::Json<AddIpRequest>,
    redis: web::Data<Arc<ConnectionManager>>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;

    let mut conn = (**redis).clone();

    match body.list.as_str() {
        "whitelist" => {
            add_to_whitelist(&mut conn, &body.ip)
                .map_err(|e| ApiError::RedisError(e.to_string()))?;
            Ok(HttpResponse::Ok().json(serde_json::json!({
                "action": "added",
                "list": "whitelist",
                "ip": body.ip,
            })))
        }
        "blacklist" => {
            let ttl = body.ttl_secs.unwrap_or(0);
            add_to_blacklist(&mut conn, &body.ip, ttl)
                .map_err(|e| ApiError::RedisError(e.to_string()))?;
            Ok(HttpResponse::Ok().json(serde_json::json!({
                "action": "added",
                "list": "blacklist",
                "ip": body.ip,
                "ttl_secs": ttl,
            })))
        }
        _ => Err(ApiError::bad_request("Invalid list type; use 'whitelist' or 'blacklist'")),
    }
}

/// DELETE /api/admin/ip-list
///
/// Remove an IP from the whitelist or blacklist.
pub async fn remove_ip(
    req: HttpRequest,
    body: web::Json<RemoveIpRequest>,
    redis: web::Data<Arc<ConnectionManager>>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;

    let mut conn = (**redis).clone();

    match body.list.as_str() {
        "whitelist" => {
            remove_from_whitelist(&mut conn, &body.ip)
                .map_err(|e| ApiError::RedisError(e.to_string()))?;
        }
        "blacklist" => {
            remove_from_blacklist(&mut conn, &body.ip)
                .map_err(|e| ApiError::RedisError(e.to_string()))?;
        }
        _ => return Err(ApiError::bad_request("Invalid list type; use 'whitelist' or 'blacklist'")),
    }

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "action": "removed",
        "list": body.list,
        "ip": body.ip,
    })))
}

/// GET /api/admin/ip-list/check
///
/// Check whether a given IP is whitelisted, blacklisted, or neither.
pub async fn check_ip(
    req: HttpRequest,
    query: web::Query<IpCheckQuery>,
    redis: web::Data<Arc<ConnectionManager>>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&req)?;

    let mut conn = (**redis).clone();
    let whitelisted = is_whitelisted(&mut conn, &query.ip).await;
    let blacklisted = is_blacklisted(&mut conn, &query.ip).await;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "ip": query.ip,
        "whitelisted": whitelisted,
        "blacklisted": blacklisted,
    })))
}

// ─── Route configuration ─────────────────────────────────────────────────────

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/admin/ip-list")
            .route("", web::get().to(list_ips))
            .route("", web::post().to(add_ip))
            .route("", web::delete().to(remove_ip))
            .route("/check", web::get().to(check_ip)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_ip_request_deserialize() {
        let json = r#"{"ip": "1.2.3.4", "list": "blacklist", "ttl_secs": 3600}"#;
        let req: AddIpRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.ip, "1.2.3.4");
        assert_eq!(req.list, "blacklist");
        assert_eq!(req.ttl_secs, Some(3600));
    }

    #[test]
    fn test_remove_ip_request_deserialize() {
        let json = r#"{"ip": "1.2.3.4", "list": "whitelist"}"#;
        let req: RemoveIpRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.ip, "1.2.3.4");
        assert_eq!(req.list, "whitelist");
    }
}
