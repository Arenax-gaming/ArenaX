use crate::api_error::ApiError;
use crate::auth::jwt_service::{Claims, JwtError, JwtService};
use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    error::ErrorUnauthorized,
    Error, HttpMessage,
};
use futures::future::LocalBoxFuture;
use std::future::{ready, Ready};
use std::rc::Rc;
use tracing::{debug, warn};

/// Authentication middleware for protecting routes
pub struct AuthMiddleware {
    jwt_service: Rc<JwtService>,
}

impl AuthMiddleware {
    pub fn new(jwt_service: JwtService) -> Self {
        Self {
            jwt_service: Rc::new(jwt_service),
        }
    }
}

impl<S, B> Transform<S, ServiceRequest> for AuthMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type InitError = ();
    type Transform = AuthMiddlewareService<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(AuthMiddlewareService {
            service: Rc::new(service),
            jwt_service: self.jwt_service.clone(),
        }))
    }
}

pub struct AuthMiddlewareService<S> {
    service: Rc<S>,
    jwt_service: Rc<JwtService>,
}

impl<S, B> Service<ServiceRequest> for AuthMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let jwt_service = self.jwt_service.clone();
        let service = self.service.clone();

        Box::pin(async move {
            // ── Token extraction ─────────────────────────────────────────────
            // Priority order:
            //   1. Authorization: Bearer <token>  (API clients, mobile)
            //   2. auth_token httpOnly cookie      (browser SPA)
            let token_opt: Option<String> = req
                .headers()
                .get("Authorization")
                .and_then(|h| h.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer ").map(str::to_owned))
                .or_else(|| {
                    req.cookie(crate::http::auth_handler::ACCESS_TOKEN_COOKIE)
                        .map(|c| c.value().to_owned())
                });

            let token = match token_opt {
                Some(t) => t,
                None => {
                    warn!("Missing authorization header and auth cookie");
                    return Err(ErrorUnauthorized("Authentication required"));
                }
            };

            // ── Token validation ─────────────────────────────────────────────
            match jwt_service.validate_token(&token).await {
                Ok(claims) => {
                    debug!(user_id = %claims.sub, "Request authenticated");
                    req.extensions_mut().insert(claims);
                    service.call(req).await
                }
                Err(error) => {
                    warn!(error = %error, "Token validation failed");
                    Err(api_error_for(error).into())
                }
            }
        })
    }
}

/// Translate a token-validation failure into the error the client should see.
///
/// Shared by this middleware and by handlers that validate tokens themselves,
/// so a suspended player is answered 403 `PLAYER_SUSPENDED` everywhere rather
/// than 403 here and a generic 401 there (#1531).
pub fn api_error_for(error: JwtError) -> ApiError {
    match error {
        JwtError::PlayerSuspended => ApiError::PlayerSuspended,
        JwtError::TokenExpired => ApiError::unauthorized("Token expired"),
        JwtError::TokenBlacklisted => ApiError::forbidden("Token has been revoked"),
        JwtError::SessionNotFound => ApiError::unauthorized("Session expired or invalid"),
        other => ApiError::unauthorized(format!("Invalid token: {}", other)),
    }
}

/// Extract claims from request (use in route handlers)
pub trait ClaimsExt {
    fn claims(&self) -> Option<Claims>;
    fn user_id(&self) -> Option<uuid::Uuid>;
}

impl ClaimsExt for actix_web::HttpRequest {
    fn claims(&self) -> Option<Claims> {
        let claims = self.extensions().get::<Claims>().cloned();
        // Attach the caller to the request's tracing span (#1084) so slow
        // database queries logged during this request carry `user_id` too.
        if let Some(ref c) = claims {
            tracing::Span::current().record("user_id", tracing::field::display(&c.sub));
        }
        claims
    }

    fn user_id(&self) -> Option<uuid::Uuid> {
        self.claims()
            .and_then(|c| uuid::Uuid::parse_str(&c.sub).ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claims_ext_interface() {
        // This test just ensures the trait compiles
        assert!(true);
    }
}
