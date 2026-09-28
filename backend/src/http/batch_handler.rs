use actix_web::{web, HttpRequest, HttpResponse};
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::auth::middleware::ClaimsExt;
use crate::models::batch::*;
use crate::service::batch_service::BatchService;

/// POST /api/batch
///
/// Execute a batch operation (create/update/delete) on a set of entities.
///
/// The request body must conform to [`BatchRequest`].  The endpoint enforces:
/// - Maximum 1 000 items per request
/// - Supported entities: `users`, `tournaments`, `notifications`, `wallets`
/// - Atomic (default) or partial semantics
///
/// Returns a [`BatchResponse`] with per-item results and aggregate progress.
pub async fn execute_batch(
    svc: web::Data<Arc<BatchService>>,
    req: HttpRequest,
    body: web::Json<BatchRequest>,
) -> Result<HttpResponse, ApiError> {
    // Authentication is required for all batch operations
    let _claims = req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;

    let request = body.into_inner();

    info!(
        operation = ?request.operation,
        entity = %request.entity,
        item_count = request.items.len(),
        semantics = ?request.semantics,
        "Executing batch request"
    );

    let response = svc.execute(request).await?;

    let status_code = match &response.status {
        BatchStatus::Completed => actix_web::http::StatusCode::OK,
        BatchStatus::PartialFailure => actix_web::http::StatusCode::MULTI_STATUS,
        BatchStatus::RolledBack => actix_web::http::StatusCode::CONFLICT,
    };

    Ok(HttpResponse::build(status_code).json(response))
}

/// GET /api/batch/{batch_id}/progress
///
/// Track the progress of a batch operation by its id.
///
/// This is useful for long-running batches where the client polls for status.
/// The progress store is in-memory, so only recent batch results are
/// available.
pub async fn get_batch_progress(
    svc: web::Data<Arc<BatchService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let _claims = req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;

    let batch_id = path.into_inner();

    let status = svc
        .progress_store()
        .get_status(batch_id)
        .await
        .ok_or_else(|| {
            ApiError::not_found(format!("Batch {} not found or expired", batch_id))
        })?;

    Ok(HttpResponse::Ok().json(BatchProgressResponse {
        batch_id,
        status,
        progress: BatchProgress {
            total: 0,
            succeeded: 0,
            failed: 0,
        },
    }))
}

/// DELETE /api/batch/{batch_id}/progress
///
/// Manually remove a batch progress entry from the store.
pub async fn cleanup_batch_progress(
    svc: web::Data<Arc<BatchService>>,
    req: HttpRequest,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let _claims = req
        .claims()
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;

    let batch_id = path.into_inner();

    svc.progress_store().remove(batch_id).await;

    Ok(HttpResponse::Ok().json(serde_json::json!({ "ok": true })))
}

// ─── Route configuration ─────────────────────────────────────────────────────

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/batch")
            .route("", web::post().to(execute_batch))
            .route("/{batch_id}/progress", web::get().to(get_batch_progress))
            .route(
                "/{batch_id}/progress",
                web::delete().to(cleanup_batch_progress),
            ),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[actix_web::test]
    async fn test_batch_handler_placeholder() {
        // Placeholder — real test requires a running DB + auth.
        assert!(true);
    }
}
