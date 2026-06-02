use std::future::{ready, Future};
use std::pin::Pin;
use std::sync::Arc;

use actix_web::{
    dev::Payload,
    error::{ErrorForbidden, ErrorUnauthorized},
    web, Error, FromRequest, HttpRequest,
};

use super::jwt_service::{Claims, JwtError, JwtService};

/// Actix-Web `FromRequest` extractor for JWT `Claims`.
///
/// Reads `Authorization: Bearer <token>` from the request, validates the token
/// using `JwtService` registered as `web::Data<Arc<JwtService>>`, and returns
/// the authenticated `Claims`.
///
/// # Usage
///
/// ```rust
/// pub async fn my_handler(claims: Claims) -> impl Responder { ... }
/// ```
///
/// Returns `401 Unauthorized` when the header is missing or the token is
/// invalid, `403 Forbidden` when the token has been revoked.
impl FromRequest for Claims {
    type Error = Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self, Error>>>>;

    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {
        // 1. Check extensions first — if AuthMiddleware already ran, reuse.
        if let Some(claims) = req.extensions().get::<Claims>().cloned() {
            return Box::pin(ready(Ok(claims)));
        }

        // 2. Extract Bearer token from Authorization header.
        let token = match req
            .headers()
            .get("Authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
        {
            Some(t) => t.to_owned(),
            None => {
                return Box::pin(ready(Err(ErrorUnauthorized(
                    "Missing or invalid Authorization header",
                ))))
            }
        };

        // 3. Get JwtService from app data.
        let jwt_service = match req.app_data::<web::Data<Arc<JwtService>>>() {
            Some(svc) => svc.clone(),
            None => {
                tracing::error!("JwtService not registered in app_data");
                return Box::pin(ready(Err(ErrorUnauthorized("Authentication unavailable"))));
            }
        };

        Box::pin(async move {
            match jwt_service.validate_token(&token).await {
                Ok(claims) => Ok(claims),
                Err(JwtError::TokenExpired) => Err(ErrorUnauthorized("Token expired")),
                Err(JwtError::TokenBlacklisted) => Err(ErrorForbidden("Token has been revoked")),
                Err(JwtError::SessionNotFound) => {
                    Err(ErrorUnauthorized("Session expired or invalid"))
                }
                Err(e) => Err(ErrorUnauthorized(format!("Invalid token: {e}"))),
            }
        })
    }
}
