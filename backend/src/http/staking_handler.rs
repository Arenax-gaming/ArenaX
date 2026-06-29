use crate::{
    api_error::ApiError,
    auth::middleware::ClaimsExt,
    middleware::security::validate_positive_amount,
    service::staking_service::{ClaimRewardsRequest, StakeForRewardsRequest, StakingService},
};
use actix_web::{web, HttpRequest, HttpResponse};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

// ─── Request bodies ──────────────────────────────────────────────────────────
// user_id is intentionally NOT in these structs; it is always taken from the
// validated JWT claims so a caller cannot act on behalf of another user.

#[derive(Deserialize)]
pub struct StakeBody {
    pub stellar_address: String,
    pub amount: i64,
}

#[derive(Deserialize)]
pub struct ClaimBody {
    pub stellar_address: String,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Extract the authenticated user's UUID from the JWT claims inserted by
/// `AuthMiddleware`.  Returns `401 Unauthorized` if the middleware was not
/// applied or the token was absent.
fn extract_user_id(req: &HttpRequest) -> Result<Uuid, ApiError> {
    req.user_id()
        .ok_or_else(|| ApiError::Unauthorized)
}

/// Verify that `stellar_address` belongs to the authenticated user by checking
/// their wallet row.  Returns `403 Forbidden` when the address doesn't match
/// and `400 Bad Request` when the user has no wallet yet.
async fn verify_stellar_address(
    db: &PgPool,
    user_id: Uuid,
    stellar_address: &str,
) -> Result<(), ApiError> {
    let row = sqlx::query!(
        r#"
        SELECT stellar_public_key
        FROM wallets
        WHERE user_id = $1
        "#,
        user_id,
    )
    .fetch_optional(db)
    .await
    .map_err(|e| ApiError::DatabaseError(e))?;

    match row {
        None => Err(ApiError::BadRequest(
            "No wallet found for this user".to_string(),
        )),
        Some(r) => {
            let registered = r.stellar_public_key.unwrap_or_default();
            if registered != stellar_address {
                Err(ApiError::Forbidden)
            } else {
                Ok(())
            }
        }
    }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

pub async fn stake_for_rewards(
    req: HttpRequest,
    db: web::Data<PgPool>,
    body: web::Json<StakeBody>,
) -> Result<HttpResponse, ApiError> {
    // Identity comes from the token, never from the body.
    let user_id = extract_user_id(&req)?;

    validate_positive_amount(body.amount)
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    // Confirm the caller owns the Stellar address they are staking from.
    verify_stellar_address(db.get_ref(), user_id, &body.stellar_address).await?;

    let svc = StakingService::new(db.get_ref().clone());
    let resp = svc
        .record_stake(&StakeForRewardsRequest {
            user_id,
            stellar_address: body.stellar_address.clone(),
            amount: body.amount,
        })
        .await?;

    Ok(HttpResponse::Ok().json(resp))
}

pub async fn claim_rewards(
    req: HttpRequest,
    db: web::Data<PgPool>,
    body: web::Json<ClaimBody>,
) -> Result<HttpResponse, ApiError> {
    let user_id = extract_user_id(&req)?;

    // Confirm the caller owns the Stellar address they are claiming from.
    verify_stellar_address(db.get_ref(), user_id, &body.stellar_address).await?;

    let svc = StakingService::new(db.get_ref().clone());
    // claimed_amount would come from Soroban tx result in production
    let resp = svc
        .record_claim(
            &ClaimRewardsRequest {
                user_id,
                stellar_address: body.stellar_address.clone(),
            },
            0,
        )
        .await?;

    Ok(HttpResponse::Ok().json(resp))
}

pub async fn unstake(
    req: HttpRequest,
    db: web::Data<PgPool>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let authenticated_user = extract_user_id(&req)?;

    // Parse and validate the path param UUID.
    let path_user_id = path
        .into_inner()
        .parse::<Uuid>()
        .map_err(|_| ApiError::BadRequest("Invalid user_id in path".to_string()))?;

    // Prevent acting on behalf of another user.
    if path_user_id != authenticated_user {
        return Err(ApiError::Forbidden);
    }

    let svc = StakingService::new(db.get_ref().clone());
    svc.record_unstake(authenticated_user).await?;
    Ok(HttpResponse::NoContent().finish())
}

pub async fn get_position(
    db: web::Data<PgPool>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let user_id = path
        .into_inner()
        .parse::<Uuid>()
        .map_err(|_| ApiError::BadRequest("Invalid user_id".to_string()))?;

    let svc = StakingService::new(db.get_ref().clone());
    match svc.get_position(user_id).await? {
        Some(pos) => Ok(HttpResponse::Ok().json(pos)),
        None => Ok(HttpResponse::NotFound().json(serde_json::json!({"error": "no stake found"}))),
    }
}

pub async fn get_staking_stats(db: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let svc = StakingService::new(db.get_ref().clone());
    Ok(HttpResponse::Ok().json(svc.get_stats().await?))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{
        http::StatusCode,
        test,
        web, App,
    };

    /// Verifies that a request without a valid JWT (no auth middleware applied)
    /// hits `extract_user_id` and returns Unauthorized.
    #[actix_web::test]
    async fn test_stake_without_auth_returns_401() {
        let app = test::init_service(
            App::new()
                // No database needed — we never reach the DB call.
                .app_data(web::Data::new(
                    // A minimal PgPool cannot be constructed without a live DB,
                    // so we register a dummy value that satisfies the type.
                    // The handler will return 401 before touching the pool.
                    actix_web::web::Data::<sqlx::PgPool>::default(),
                ))
                .route(
                    "/staking/stake",
                    web::post().to(stake_for_rewards),
                ),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/staking/stake")
            .set_json(serde_json::json!({
                "stellar_address": "GABC1234567890",
                "amount": 1000
            }))
            .to_request();

        let resp = test::call_service(&app, req).await;
        // No JWT in extensions → extract_user_id returns Unauthorized (401).
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    /// Verifies that supplying a different user's ID in the path for unstake
    /// is rejected with 403 Forbidden.
    #[actix_web::test]
    async fn test_unstake_different_user_returns_403() {
        use crate::auth::Claims;
        use actix_web::HttpMessage;

        let owner_id = Uuid::new_v4();
        let attacker_id = Uuid::new_v4();

        let app = test::init_service(
            App::new()
                .app_data(actix_web::web::Data::<sqlx::PgPool>::default())
                .route(
                    "/staking/unstake/{user_id}",
                    web::delete().to(unstake),
                ),
        )
        .await;

        // Simulate the auth middleware having injected `attacker_id` claims.
        let mut req = test::TestRequest::delete()
            .uri(&format!("/staking/unstake/{}", owner_id))
            .to_request();

        req.extensions_mut().insert(crate::auth::Claims {
            sub: attacker_id.to_string(),
            exp: 9999999999,
            iat: 0,
            jti: "test-jti".to_string(),
            token_type: crate::auth::jwt_service::TokenType::Access,
            device_id: None,
            session_id: "test-session".to_string(),
            roles: vec![],
        });

        let resp = test::call_service(&app, req).await;
        // attacker_id != owner_id → 403 Forbidden.
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }
}
