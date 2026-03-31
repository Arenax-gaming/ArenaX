use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::idempotency::*;
use actix_web::{dev, http::header::HeaderMap, web, HttpMessage, HttpRequest, HttpResponse};
use chrono::{Duration, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::future::Ready;
use std::pin::Pin;
use uuid::Uuid;

pub struct IdempotencyMiddleware {
    policy: IdempotencyPolicy,
    db_pool: DbPool,
}

impl IdempotencyMiddleware {
    pub fn new(db_pool: DbPool, policy: IdempotencyPolicy) -> Self {
        Self { policy, db_pool }
    }

    pub fn default(db_pool: DbPool) -> Self {
        Self::new(db_pool, IdempotencyPolicy::default())
    }

    fn extract_idempotency_key(&self, headers: &HeaderMap) -> Result<String, ApiError> {
        let key_header = headers
            .get(&self.policy.key_header_name)
            .ok_or_else(|| {
                ApiError::bad_request(&format!(
                    "Missing required header: {}",
                    self.policy.key_header_name
                ))
            })?;

        let key_str = key_header.to_str().map_err(|_| {
            ApiError::bad_request(&format!(
                "Invalid {} header format",
                self.policy.key_header_name
            ))
        })?;

        if key_str.trim().is_empty() {
            return Err(ApiError::bad_request(&format!(
                "{} header cannot be empty",
                self.policy.key_header_name
            )));
        }

        Ok(key_str.to_string())
    }

    fn generate_request_hash(&self, req: &HttpRequest, body: &[u8]) -> String {
        let mut hasher = Sha256::new();
        
        // Hash method
        hasher.update(req.method().as_str());
        
        // Hash path
        hasher.update(req.path());
        
        // Hash query parameters
        if let Some(query) = req.query_string() {
            hasher.update(query);
        }
        
        // Hash relevant headers (exclude idempotency key itself)
        for (name, value) in req.headers().iter() {
            if name.as_str() != self.policy.key_header_name {
                if let Ok(value_str) = value.to_str() {
                    hasher.update(name.as_str());
                    hasher.update(value_str);
                }
            }
        }
        
        // Hash body
        hasher.update(body);
        
        format!("{:x}", hasher.finalize())
    }

    fn is_route_enabled(&self, path: &str) -> bool {
        self.policy.enabled_routes.iter().any(|pattern| {
            // Simple pattern matching - could be enhanced with regex
            pattern == path || path.starts_with(pattern)
        })
    }

    async fn get_cached_response(&self, key: &str) -> Result<Option<IdempotencyKey>, ApiError> {
        let result = sqlx::query_as!(
            IdempotencyKey,
            r#"
            SELECT * FROM idempotency_keys 
            WHERE key = $1 
            AND expires_at > NOW()
            AND used_at IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            key
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(result)
    }

    async fn store_idempotency_key(
        &self,
        key: String,
        request_hash: String,
        response: CachedResponse,
    ) -> Result<(), ApiError> {
        // Check response size
        if response.size_kb() > self.policy.max_response_size_kb {
            return Err(ApiError::bad_request(&format!(
                "Response too large for idempotency caching (max {}KB)",
                self.policy.max_response_size_kb
            )));
        }

        let expires_at = Utc::now() + Duration::seconds(self.policy.default_ttl_seconds as i64);

        sqlx::query!(
            r#"
            INSERT INTO idempotency_keys (
                id, key, request_hash, response_status, 
                response_headers, response_body, created_at, expires_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8
            )
            "#,
            Uuid::new_v4(),
            key,
            request_hash,
            response.status as i16,
            response.headers,
            response.body,
            Utc::now(),
            expires_at
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    async fn check_conflict(
        &self,
        key: &str,
        new_hash: &str,
    ) -> Result<Option<IdempotencyConflict>, ApiError> {
        let result = sqlx::query!(
            r#"
            SELECT key, request_hash, created_at 
            FROM idempotency_keys 
            WHERE key = $1 
            AND expires_at > NOW()
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            key
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if let Some(existing) = result {
            if existing.request_hash != new_hash {
                return Ok(Some(IdempotencyConflict {
                    key: key.to_string(),
                    original_hash: existing.request_hash,
                    new_hash: new_hash.to_string(),
                    original_timestamp: existing.created_at,
                    conflict_type: ConflictType::PayloadMismatch,
                }));
            }
        }

        Ok(None)
    }

    async fn mark_key_used(&self, key: &str) -> Result<(), ApiError> {
        sqlx::query!(
            "UPDATE idempotency_keys SET used_at = NOW() WHERE key = $1",
            key
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    fn build_conflict_response(&self, conflict: IdempotencyConflict) -> HttpResponse {
        let error_body = serde_json::json!({
            "error": "IdempotencyKeyConflict",
            "message": "This idempotency key has already been used with a different request",
            "key": conflict.key,
            "original_hash": conflict.original_hash,
            "new_hash": conflict.new_hash,
            "original_timestamp": conflict.original_timestamp,
            "conflict_type": conflict.conflict_type,
            "resolution": "Use a new idempotency key for this request"
        });

        HttpResponse::Conflict().json(error_body)
    }

    fn build_cached_response(&self, cached: IdempotencyKey) -> HttpResponse {
        let mut response = HttpResponse::Ok();
        
        // Set status
        response.status(actix_web::http::StatusCode::from_u16(cached.response_status as u16).unwrap());
        
        // Set headers
        if let Some(headers) = cached.response_headers {
            if let Ok(headers_map) = serde_json::from_value::<HashMap<String, String>>(headers) {
                for (name, value) in headers_map {
                    if let Ok(header_name) = actix_web::http::header::HeaderName::from_bytes(name.as_bytes()) {
                        if let Ok(header_value) = actix_web::http::header::HeaderValue::from_str(&value) {
                            response.insert_header((header_name, header_value));
                        }
                    }
                }
            }
        }
        
        // Set idempotency headers
        response.insert_header(("X-Idempotency-Cached", "true"));
        response.insert_header(("X-Idempotency-Timestamp", cached.created_at.to_rfc3339()));
        
        // Set body
        if let Some(body) = cached.response_body {
            response.json(body)
        } else {
            response.finish()
        }
    }
}

impl<S, B> dev::Transform<S, dev::ServiceRequest> for IdempotencyMiddleware
where
    S: dev::Service<
        dev::ServiceRequest,
        Response = dev::ServiceResponse<B>,
        Error = actix_web::Error,
    >,
    S::Future: 'static,
    B: dev::MessageBody + 'static,
{
    type Response = dev::ServiceResponse<B>;
    type Error = actix_web::Error;
    type Transform = IdempotencyService<S>;
    type InitError = ();

    fn new_transform(&self, service: S) -> Result<Self::Transform, Self::InitError> {
        Ok(IdempotencyService {
            service,
            policy: self.policy.clone(),
            db_pool: self.db_pool.clone(),
        })
    }
}

pub struct IdempotencyService<S> {
    service: S,
    policy: IdempotencyPolicy,
    db_pool: DbPool,
}

impl<S, B> dev::Service<dev::ServiceRequest> for IdempotencyService<S>
where
    S: dev::Service<
        dev::ServiceRequest,
        Response = dev::ServiceResponse<B>,
        Error = actix_web::Error,
    >,
    S::Future: 'static,
    B: dev::MessageBody + 'static,
{
    type Response = dev::ServiceResponse<B>;
    type Error = actix_web::Error;
    type Future = Pin<Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>>>>;

    dev::forward_ready!(service);

    fn call(&self, mut req: dev::ServiceRequest) -> Self::Future {
        let policy = self.policy.clone();
        let db_pool = self.db_pool.clone();

        Box::pin(async move {
            // Only process enabled routes
            if !policy.enabled_routes.iter().any(|pattern| {
                req.path().starts_with(pattern) || req.path() == pattern
            }) {
                return self.service.call(req).await;
            }

            // Extract idempotency key
            let idempotency_key = match Self::extract_idempotency_key(&req.headers(), &policy) {
                Ok(key) => key,
                Err(e) => {
                    let error_response = HttpResponse::BadRequest().json(serde_json::json!({
                        "error": "InvalidIdempotencyKey",
                        "message": e.message
                    }));
                    return Ok(req.into_response(error_response));
                }
            };

            // Generate request hash
            let request_body = match req.extract_body().await {
                Ok(bytes) => bytes.to_vec(),
                Err(_) => Vec::new(),
            };
            
            let request_hash = Self::generate_request_hash(&req, &request_body);

            // Check for cached response
            let middleware = IdempotencyMiddleware::new(db_pool.clone(), policy.clone());
            
            if let Ok(Some(cached)) = middleware.get_cached_response(&idempotency_key).await {
                let cached_response = middleware.build_cached_response(cached);
                return Ok(req.into_response(cached_response));
            }

            // Check for conflicts
            if let Ok(Some(conflict)) = middleware.check_conflict(&idempotency_key, &request_hash).await {
                let conflict_response = middleware.build_conflict_response(conflict);
                return Ok(req.into_response(conflict_response));
            }

            // Process the request
            let response = self.service.call(req).await?;
            
            // Cache the response if it's successful
            if response.status().is_success() {
                let status = response.status().as_u16() as i16;
                
                // Extract headers
                let mut headers_map = HashMap::new();
                for (name, value) in response.headers().iter() {
                    if let Ok(value_str) = value.to_str() {
                        headers_map.insert(name.to_string(), value_str.to_string());
                    }
                }
                
                // Extract body (simplified - would need body extraction middleware)
                let body = Value::Null; // Placeholder - would extract actual body
                
                let cached_response = CachedResponse::new(
                    status,
                    serde_json::to_value(headers_map).unwrap_or_default(),
                    body,
                );
                
                // Store the cached response
                if let Err(_) = middleware.store_idempotency_key(
                    idempotency_key.clone(),
                    request_hash,
                    cached_response,
                ).await {
                    // Log error but don't fail the response
                    tracing::error!("Failed to cache idempotency response");
                }
                
                // Mark key as used
                if let Err(_) = middleware.mark_key_used(&idempotency_key).await {
                    // Log error but don't fail the response
                    tracing::error!("Failed to mark idempotency key as used");
                }
            }

            Ok(response)
        })
    }
}

// Extension methods for the middleware
impl<S, B> IdempotencyService<S>
where
    S: dev::Service<
        dev::ServiceRequest,
        Response = dev::ServiceResponse<B>,
        Error = actix_web::Error,
    >,
    S::Future: 'static,
    B: dev::MessageBody + 'static,
{
    fn extract_idempotency_key(headers: &HeaderMap, policy: &IdempotencyPolicy) -> Result<String, ApiError> {
        let key_header = headers
            .get(&policy.key_header_name)
            .ok_or_else(|| {
                ApiError::bad_request(&format!(
                    "Missing required header: {}",
                    policy.key_header_name
                ))
            })?;

        let key_str = key_header.to_str().map_err(|_| {
            ApiError::bad_request(&format!(
                "Invalid {} header format",
                policy.key_header_name
            ))
        })?;

        if key_str.trim().is_empty() {
            return Err(ApiError::bad_request(&format!(
                "{} header cannot be empty",
                policy.key_header_name
            )));
        }

        Ok(key_str.to_string())
    }

    fn generate_request_hash(req: &HttpRequest, body: &[u8]) -> String {
        let mut hasher = Sha256::new();
        
        // Hash method
        hasher.update(req.method().as_str());
        
        // Hash path
        hasher.update(req.path());
        
        // Hash query parameters
        if let Some(query) = req.query_string() {
            hasher.update(query);
        }
        
        // Hash relevant headers (exclude idempotency key itself)
        for (name, value) in req.headers().iter() {
            if name.as_str() != "Idempotency-Key" {
                if let Ok(value_str) = value.to_str() {
                    hasher.update(name.as_str());
                    hasher.update(value_str);
                }
            }
        }
        
        // Hash body
        hasher.update(body);
        
        format!("{:x}", hasher.finalize())
    }
}
