use crate::auth::jwt_service::{Claims, JwtError, JwtService};
use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    error::{ErrorForbidden, ErrorUnauthorized},
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
            // Extract Authorization header
            let auth_header = req
                .headers()
                .get("Authorization")
                .and_then(|h| h.to_str().ok());

            if let Some(auth_value) = auth_header {
                // Check for Bearer token
                if let Some(token) = auth_value.strip_prefix("Bearer ") {
                    // Validate token
                    match jwt_service.validate_token(token).await {
                        Ok(claims) => {
                            debug!(user_id = %claims.sub, "Request authenticated");

                            // Store claims in request extensions for later use
                            req.extensions_mut().insert(claims);

                            // Call the next service
                            service.call(req).await
                        }
                        Err(JwtError::TokenExpired) => {
                            warn!("Token expired");
                            Err(ErrorUnauthorized("Token expired"))
                        }
                        Err(JwtError::TokenBlacklisted) => {
                            warn!("Token blacklisted");
                            Err(ErrorForbidden("Token has been revoked"))
                        }
                        Err(JwtError::SessionNotFound) => {
                            warn!("Session not found");
                            Err(ErrorUnauthorized("Session expired or invalid"))
                        }
                        Err(e) => {
                            warn!(error = %e, "Token validation failed");
                            Err(ErrorUnauthorized(format!("Invalid token: {}", e)))
                        }
                    }
                } else {
                    warn!("Invalid authorization header format");
                    Err(ErrorUnauthorized("Invalid authorization header format"))
                }
            } else {
                warn!("Missing authorization header");
                Err(ErrorUnauthorized("Missing authorization header"))
            }
        })
    }
}

/// Extract claims from request (use in route handlers)
pub trait ClaimsExt {
    fn claims(&self) -> Option<Claims>;
    fn user_id(&self) -> Option<uuid::Uuid>;
}

impl ClaimsExt for actix_web::HttpRequest {
    fn claims(&self) -> Option<Claims> {
        self.extensions().get::<Claims>().cloned()
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
        // Real testing would require mocking HTTP request
        assert!(true);
    }
}
