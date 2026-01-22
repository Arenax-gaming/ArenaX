#![allow(dead_code)]

use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::tournament::{Tournament, CreateTournamentRequest};
use uuid::Uuid;

#[derive(Clone)]
pub struct TournamentService {
    #[allow(dead_code)]
    pool: DbPool,
}

impl TournamentService {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    pub async fn create_tournament(
        &self,
        _creator_id: Uuid,
        _request: CreateTournamentRequest,
    ) -> Result<Tournament, ApiError> {
        // TODO: Implement tournament creation with database
        Err(ApiError::internal_error("Tournament service not yet implemented"))
    }

    pub async fn get_tournaments(
        &self,
        _user_id: Option<Uuid>,
        _page: i32,
        _per_page: i32,
        _status: Option<String>,
        _game_type: Option<String>,
    ) -> Result<Vec<Tournament>, ApiError> {
        // TODO: Implement tournament listing with filters
        Ok(vec![])
    }

    pub async fn get_tournament(&self, _id: Uuid) -> Result<Tournament, ApiError> {
        // TODO: Implement tournament retrieval
        Err(ApiError::not_found("Tournament not found"))
    }
}