#![allow(dead_code)]

use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::match_model::{Match, MatchResult};
use uuid::Uuid;

#[derive(Clone)]
pub struct MatchService {
    #[allow(dead_code)]
    pool: DbPool,
}

impl MatchService {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    pub async fn get_match(&self, _match_id: Uuid, _user_id: Option<Uuid>) -> Result<Match, ApiError> {
        // TODO: Implement match retrieval from database
        Err(ApiError::not_found("Match not found"))
    }

    pub async fn report_score(
        &self,
        _match_id: Uuid,
        _user_id: Uuid,
        _result: MatchResult,
    ) -> Result<MatchResult, ApiError> {
        // TODO: Implement score reporting with validation
        Err(ApiError::internal_error("Match service not yet implemented"))
    }

    pub async fn get_match_history(&self, _user_id: Uuid) -> Result<Vec<Match>, ApiError> {
        // TODO: Implement match history retrieval
        Ok(vec![])
    }

    pub async fn get_leaderboard(&self, _game_type: String) -> Result<Vec<(Uuid, i32)>, ApiError> {
        // TODO: Implement leaderboard with ELO calculations
        Ok(vec![])
    }
}