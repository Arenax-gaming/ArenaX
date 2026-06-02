use crate::{
    api_error::ApiError,
    middleware::security::validate_uuid,
    service::tournament_service::TournamentService,
};
use actix_web::{web, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct TournamentStatisticsQuery {
    pub include_participants: Option<bool>,
    pub include_matches: Option<bool>,
}

pub async fn get_tournament_statistics(
    svc: web::Data<Arc<TournamentService>>,
    path: web::Path<Uuid>,
    query: web::Query<TournamentStatisticsQuery>,
) -> Result<HttpResponse, ApiError> {
    let tournament_id = path.into_inner();

    // Validate tournament ID
    validate_uuid(&tournament_id.to_string())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    // Get tournament statistics
    let stats = svc.get_tournament_statistics(tournament_id).await?;

    Ok(HttpResponse::Ok().json(stats))
}

// Additional tournament endpoints can be added here as needed

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::StatusCode;
    use std::sync::Arc;

    #[actix_web::test]
    async fn test_get_tournament_statistics() {
        // Test implementation would go here
        // For now, this is a placeholder
        assert!(true);
    }
}
