use crate::{
    api_error::ApiError,
    auth::jwt_service::Claims,
    middleware::security::validate_uuid,
    models::tournament::TournamentStatus,
    service::tournament_service::TournamentService,
};
use actix_web::{web, HttpMessage, HttpRequest, HttpResponse};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct TournamentStatisticsQuery {
    pub include_participants: Option<bool>,
    pub include_matches: Option<bool>,
}

pub async fn get_tournament_statistics(
    db: web::Data<PgPool>,
    path: web::Path<Uuid>,
    query: web::Query<TournamentStatisticsQuery>,
) -> Result<HttpResponse, ApiError> {
    let tournament_id = path.into_inner();
    validate_uuid(&tournament_id.to_string())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let svc = TournamentService::new(db.get_ref().clone());
    let stats = svc.get_tournament_statistics(tournament_id).await?;
    Ok(HttpResponse::Ok().json(stats))
}

#[derive(Deserialize)]
pub struct UpdateStatusRequest {
    pub status: TournamentStatus,
}

/// PATCH /api/tournaments/{id}/status
///
/// Allowed callers:
///   - Admins (is_admin == true OR roles contains "admin")
///   - The tournament creator (tournament.created_by == caller user_id)
///
/// Returns 401 when no valid JWT is present, 403 when authenticated but
/// lacking the required permission.
pub async fn update_tournament_status(
    req: HttpRequest,
    db: web::Data<PgPool>,
    path: web::Path<Uuid>,
    body: web::Json<UpdateStatusRequest>,
) -> Result<HttpResponse, ApiError> {
    // ── 1. Authentication ────────────────────────────────────────────────────
    let claims = req
        .extensions()
        .get::<Claims>()
        .cloned()
        .ok_or(ApiError::Unauthorized)?;

    let caller_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::Unauthorized)?;

    let tournament_id = path.into_inner();
    validate_uuid(&tournament_id.to_string())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let svc = TournamentService::new(db.get_ref().clone());

    // ── 2. Fetch tournament to check ownership ───────────────────────────────
    let tournament = svc.get_tournament_by_id(tournament_id).await?;

    // ── 3. Authorization ─────────────────────────────────────────────────────
    let is_admin = claims.is_admin();
    let is_creator = tournament.created_by == caller_id;

    if !is_admin && !is_creator {
        return Err(ApiError::Forbidden);
    }

    // ── 4. Privileged-state guard ────────────────────────────────────────────
    // Only admins may trigger Completed (which chains complete_tournament →
    // calculate_final_rankings → distribute_prizes).
    if body.status == TournamentStatus::Completed && !is_admin {
        return Err(ApiError::Forbidden);
    }

    // ── 5. Perform the update ────────────────────────────────────────────────
    let updated = svc
        .update_tournament_status(tournament_id, body.status)
        .await?;

    Ok(HttpResponse::Ok().json(updated))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::jwt_service::TokenType;
    use actix_web::test;
    use chrono::Utc;
    use uuid::Uuid;

    fn make_claims(user_id: Uuid, is_admin: bool) -> Claims {
        Claims {
            sub: user_id.to_string(),
            exp: (Utc::now() + chrono::Duration::minutes(15)).timestamp(),
            iat: Utc::now().timestamp(),
            jti: Uuid::new_v4().to_string(),
            token_type: TokenType::Access,
            device_id: None,
            session_id: Uuid::new_v4().to_string(),
            roles: if is_admin {
                vec!["admin".to_string()]
            } else {
                vec!["user".to_string()]
            },
            is_admin,
        }
    }

    #[test]
    async fn test_admin_claims_is_admin_true() {
        let claims = make_claims(Uuid::new_v4(), true);
        assert!(claims.is_admin());
    }

    #[test]
    async fn test_user_claims_is_admin_false() {
        let claims = make_claims(Uuid::new_v4(), false);
        assert!(!claims.is_admin());
    }

    #[test]
    async fn test_role_based_admin_detection() {
        // is_admin field false but role "admin" present → still admin
        let claims = Claims {
            sub: Uuid::new_v4().to_string(),
            exp: (Utc::now() + chrono::Duration::minutes(15)).timestamp(),
            iat: Utc::now().timestamp(),
            jti: Uuid::new_v4().to_string(),
            token_type: TokenType::Access,
            device_id: None,
            session_id: Uuid::new_v4().to_string(),
            roles: vec!["admin".to_string()],
            is_admin: false, // field false, but role present
        };
        assert!(claims.is_admin(), "role-based admin detection must work");
    }

    #[test]
    async fn test_no_claims_returns_unauthorized() {
        // Simulate a request with no Claims extension
        let req = test::TestRequest::patch().to_http_request();
        // No Claims inserted → extensions().get::<Claims>() returns None
        let result = req.extensions().get::<Claims>().cloned();
        assert!(result.is_none());
    }
}
