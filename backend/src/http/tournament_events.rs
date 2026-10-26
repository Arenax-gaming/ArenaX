use crate::db::DbPool;
use actix_web::{error, web, Error, HttpResponse};
use arenax_tournament_realtime::{sse_response, HubError, TournamentHub};
use uuid::Uuid;

/// Public tournament state feed. Private tournaments are deliberately excluded
/// while the dev branch's HTTP authentication is still a placeholder.
pub async fn tournament_events(
    pool: web::Data<DbPool>,
    hub: web::Data<TournamentHub>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, Error> {
    let tournament_id = path.into_inner();
    let public: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM tournaments WHERE id = $1 AND visibility = 'public')",
    )
    .bind(tournament_id)
    .fetch_one(pool.get_ref())
    .await
    .map_err(|_| error::ErrorInternalServerError("Unable to check tournament access"))?;
    if !public {
        return Err(error::ErrorNotFound("Tournament not found"));
    }
    let subscription = hub
        .subscribe(tournament_id)
        .map_err(|failure| match failure {
            HubError::Capacity => {
                error::ErrorTooManyRequests("Tournament connection limit reached")
            }
            _ => error::ErrorServiceUnavailable("Tournament updates are temporarily unavailable"),
        })?;
    Ok(sse_response(subscription))
}
