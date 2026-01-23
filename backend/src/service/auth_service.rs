use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::user::{User, CreateUserRequest, LoginRequest, AuthResponse};
use uuid::Uuid;

#[derive(Clone)]
pub struct AuthService {
    pool: DbPool,
}

impl AuthService {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    pub async fn register(&self, _request: CreateUserRequest) -> Result<User, ApiError> {
        // TODO: Implement user registration with database and JWT
        Err(ApiError::internal_error("Auth service not yet implemented"))
    }

    pub async fn login(&self, _request: LoginRequest) -> Result<AuthResponse, ApiError> {
        // TODO: Implement user login with password verification
        Err(ApiError::internal_error("Auth service not yet implemented"))
    }

    pub fn verify_token(&self, _token: &str) -> Result<Uuid, ApiError> {
        // TODO: Implement JWT token verification
        Err(ApiError::internal_error("Token verification not yet implemented"))
    }
}